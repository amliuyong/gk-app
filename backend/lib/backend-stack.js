import * as cdk from 'aws-cdk-lib';
import { Stack, Duration } from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { CfnOutput } from 'aws-cdk-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class BackendStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // Create SQS Queue for WebSocket messages
    const websocketQueue = new sqs.Queue(this, 'WebSocketMessageQueue', {
      visibilityTimeout: Duration.seconds(30),
      retentionPeriod: Duration.days(1),
    });

    // 创建 Docker 镜像
    const dockerAsset = new ecr_assets.DockerImageAsset(this, 'OllamaImage', {
      directory: join(__dirname, '../docker/ecs-ollama'),
    });

    // 创建 VPC
    const vpc = new ec2.Vpc(this, 'gkRecommendationVpc', {
      maxAzs: 2,
      natGateways: 1,
    });

    // 创建 ECS 集群
    const cluster = new ecs.Cluster(this, 'gkRecommendationBackendCluster', {
      vpc,
      containerInsights: true,
    });

    // 创建任务执行角色
    const taskExecutionRole = new iam.Role(this, 'ecsTaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Role that the ECS service will use to pull images and write logs',
    });

    // 添加 ECR 和 CloudWatch Logs 权限
    taskExecutionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
    );

    // 创建任务角色
    const taskRole = new iam.Role(this, 'OllamaTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Role that the Ollama container will use when running',
    });

    // 添加 CloudWatch Logs 权限
    taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: ['*'],
    }));

    // S3 权限
    taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject', 's3:PutObject'],
      resources: ['*'],
    }));

    // 添加 ECR 权限

    // 创建 ECS 任务定义
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'OllamaTask', {
      memoryLimitMiB: 32768,
      cpu: 8192,
      taskRole: taskRole,
      executionRole: taskExecutionRole,
    });

    // 添加 Ollama 容器
    taskDefinition.addContainer('OllamaContainer', {
      image: ecs.ContainerImage.fromDockerImageAsset(dockerAsset),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'ollama' }),
      portMappings: [
        {
          containerPort: 11434,
          protocol: ecs.Protocol.TCP,
        },
      ],
      environment: {
        // 添加环境变量（如果需要）
      },
    });

    // 创建 Ollama 服务安全组
    const ollamaSecurityGroup = new ec2.SecurityGroup(this, 'OllamaSecurityGroup', {
      vpc,
      description: 'Security group for Ollama service',
      allowAllOutbound: true
    });

    // 创建 Fargate 服务 (完全私有)
    const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'OllamaService', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      publicLoadBalancer: false,  // 设置为私有负载均衡器
      listenerPort: 11434,
      targetProtocol: ecs.Protocol.HTTP,
      assignPublicIp: false,  // 不分配公网IP
      healthCheckGracePeriod: Duration.seconds(600),
      taskSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS  // 使用私有子网
      },
      securityGroups: [ollamaSecurityGroup]
    });

    // 配置目标组 - 增加超时时间
    fargateService.targetGroup.setAttribute('deregistration_delay.timeout_seconds', '900');
    fargateService.targetGroup.setAttribute('load_balancing.algorithm.type', 'round_robin');

    // 配置负载均衡器 - 增加空闲超时时间
    const cfnLoadBalancer = fargateService.loadBalancer.node.defaultChild;
    cfnLoadBalancer.loadBalancerAttributes = [
      {
        key: 'idle_timeout.timeout_seconds',
        value: '900'
      }
    ];

    // 创建安全组
    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc,
      description: 'Security group for Lambda functions',
      allowAllOutbound: true
    });

    // 配置安全组规则 - 只允许来自 Lambda 的访问
    ollamaSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(11434),
      'Allow access from Lambda'
    );

    // 移除允许任何 IP 访问的规则
    // fargateService.service.connections.allowFromAnyIpv4(ec2.Port.tcp(11434), 'Allow Ollama API access');

    // 创建 Authorizer Lambda
    const authorizerFunction = new NodejsFunction(this, 'AuthorizerFunction', {
      runtime: Runtime.NODEJS_18_X,
      entry: join(__dirname, '../lambda/authorize.js'),
      handler: 'handler',
    });

    // 创建 Connect Lambda
    const connectFunction = new NodejsFunction(this, 'ConnectHandler', {
      runtime: Runtime.NODEJS_18_X,
      entry: join(__dirname, '../lambda/connect.js'),
      handler: 'handler',
    });

    // 创建 Disconnect Lambda
    const disconnectFunction = new NodejsFunction(this, 'DisconnectHandler', {
      runtime: Runtime.NODEJS_18_X,
      entry: join(__dirname, '../lambda/disconnect.js'),
      handler: 'handler',
    });

    // 创建 Predict Lambda
    const predictFunction = new NodejsFunction(this, 'PredictFunction', {
      runtime: Runtime.NODEJS_18_X,
      entry: join(__dirname, '../lambda/predict.js'),
      handler: 'handler',
      timeout: Duration.seconds(900),
      memorySize: 1024,
      vpc: vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      },
      securityGroups: [lambdaSecurityGroup],
      environment: {
        OLLAMA_API_URL: `http://${fargateService.loadBalancer.loadBalancerDnsName}:11434`,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['aws-sdk'],
      },
    });

    // Create WebSocket API
    const webSocketApi = new apigatewayv2.CfnApi(this, 'gkRecommendationWebSocketApi', {
      name: 'gkRecommendationWebSocketApi',
      protocolType: 'WEBSOCKET',
      routeSelectionExpression: '$request.body.action',
    });

    // Create authorizer
    const authorizer = new apigatewayv2.CfnAuthorizer(this, 'WebSocketAuthorizer', {
      apiId: webSocketApi.ref,
      authorizerType: 'REQUEST',
      authorizerUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${authorizerFunction.functionArn}/invocations`,
      identitySource: ['route.request.querystring.Authorization'],
      name: 'WebSocketAuthorizer',
    });

    // Grant invoke permission to API Gateway
    authorizerFunction.addPermission('InvokeByApiGateway', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.ref}/authorizers/${authorizer.ref}`,
    });

    // Create integrations
    const connectIntegration = new apigatewayv2.CfnIntegration(this, 'ConnectIntegration', {
      apiId: webSocketApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${connectFunction.functionArn}/invocations`,
    });

    const disconnectIntegration = new apigatewayv2.CfnIntegration(this, 'DisconnectIntegration', {
      apiId: webSocketApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${disconnectFunction.functionArn}/invocations`,
    });

    const predictIntegration = new apigatewayv2.CfnIntegration(this, 'PredictIntegration', {
      apiId: webSocketApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${predictFunction.functionArn}/invocations`,
    });

    // Create routes
    const connectRoute = new apigatewayv2.CfnRoute(this, 'ConnectRoute', {
      apiId: webSocketApi.ref,
      routeKey: '$connect',
      authorizationType: 'CUSTOM',
      authorizerId: authorizer.ref,
      target: `integrations/${connectIntegration.ref}`,
    });

    const disconnectRoute = new apigatewayv2.CfnRoute(this, 'DisconnectRoute', {
      apiId: webSocketApi.ref,
      routeKey: '$disconnect',
      authorizationType: 'NONE',
      target: `integrations/${disconnectIntegration.ref}`,
    });

    const predictRoute = new apigatewayv2.CfnRoute(this, 'PredictRoute', {
      apiId: webSocketApi.ref,
      routeKey: 'predict',
      authorizationType: 'NONE',
      target: `integrations/${predictIntegration.ref}`,
    });

    // Create stage
    const stage = new apigatewayv2.CfnStage(this, 'ProdStage', {
      apiId: webSocketApi.ref,
      stageName: 'prod',
      autoDeploy: true,
    });

    // Grant permissions to Lambda functions
    connectFunction.addPermission('InvokeByApiGateway', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.ref}/${stage.stageName}/$connect`,
    });

    disconnectFunction.addPermission('InvokeByApiGateway', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.ref}/${stage.stageName}/$disconnect`,
    });

    predictFunction.addPermission('InvokeByApiGateway', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.ref}/${stage.stageName}/predict`,
    });

    // Get the WebSocket URL
    const wsUrl = `wss://${webSocketApi.ref}.execute-api.${this.region}.amazonaws.com/${stage.stageName}`;

    // 给 Lambda 添加发送消息的权限
    predictFunction.addEnvironment('WEBSOCKET_ENDPOINT', wsUrl);
    predictFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: [`arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.ref}/${stage.stageName}/*`],
    }));

    // Add SQS URL to Lambda environment variables
    predictFunction.addEnvironment('WEBSOCKET_QUEUE_URL', websocketQueue.queueUrl);
    
    // Grant Lambda permission to send messages to SQS
    websocketQueue.grantSendMessages(predictFunction);
    
    // Create a Lambda function to process messages from SQS
    const messageProcessorFunction = new NodejsFunction(this, 'MessageProcessorFunction', {
      runtime: Runtime.NODEJS_18_X,
      entry: join(__dirname, '../lambda/process-messages.js'),
      handler: 'handler',
      timeout: Duration.seconds(30),
      environment: {
        WEBSOCKET_ENDPOINT: wsUrl,
      },
      vpc: vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [lambdaSecurityGroup],
    });
    
    // Add SQS as an event source for the Lambda function
    messageProcessorFunction.addEventSource(new SqsEventSource(websocketQueue, {
      batchSize: 3, // Process up to 10 messages at once
      maxBatchingWindow: Duration.seconds(2), // Wait up to 5 seconds to collect messages
    }));
    
    // Grant the processor Lambda permission to receive and delete messages from SQS
    websocketQueue.grantConsumeMessages(messageProcessorFunction);
    
    // Grant the processor Lambda permission to manage WebSocket connections
    messageProcessorFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: [`arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.ref}/${stage.stageName}/*`],
    }));

    // 输出 WebSocket URL
    new cdk.CfnOutput(this, 'WebSocketUrl', {
      value: wsUrl,
      description: 'WebSocket API endpoint URL',
    });

    // Output the SQS Queue URL
    new cdk.CfnOutput(this, 'WebSocketQueueUrl', {
      value: websocketQueue.queueUrl,
      description: 'URL of the SQS queue for WebSocket messages',
    });

    // 为前端创建 Docker 镜像 (without buildArgs)
    const frontendImage = new ecr_assets.DockerImageAsset(this, 'FrontendImage', {
      directory: join(__dirname, '../../frontend'),
      file: 'Dockerfile'
    });

    // 创建前端服务
    const frontendService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'FrontendService', {
      cluster,
      cpu: 512,
      memoryLimitMiB: 1024,
      desiredCount: 1,
      taskImageOptions: {
        image: ecs.ContainerImage.fromDockerImageAsset(frontendImage),
        containerPort: 3000,
        environment: {
          NEXT_PUBLIC_WS_URL: wsUrl,
        },
      },
      publicLoadBalancer: true,
    });

    // 配置健康检查
    frontendService.targetGroup.configureHealthCheck({
      path: '/',
      healthyHttpCodes: '200,301,302',
    });

    // 输出前端服务的 URL
    new CfnOutput(this, 'FrontendURL', {
      value: frontendService.loadBalancer.loadBalancerDnsName,
      description: 'Frontend Application URL',
    });

    // 输出 Ollama Service URL
    new cdk.CfnOutput(this, 'OllamaServiceUrl', {
      value: `http://${fargateService.loadBalancer.loadBalancerDnsName}:11434`,
      description: 'Ollama Service URL',
    });

    // Update the Bedrock permissions section in your stack
    predictFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
      ],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/*`,
      ]
    }));

    // Add a separate policy for listing and describing models
    predictFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:ListFoundationModels',
        'bedrock:GetFoundationModel'
      ],
      resources: ['*']
    }));
  }
} 