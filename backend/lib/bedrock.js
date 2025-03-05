import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as opensearchserverless from 'aws-cdk-lib/aws-opensearchserverless';
import { CfnOutput } from 'aws-cdk-lib';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';

// Get the directory name using ES module approach
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class BedrockKnowledgeBaseConstruct extends Construct {
  // props: {
  //   roleArn: string
  //   stackName: string
  //   stackId: string
  // }
  constructor(scope, id, props) {
    super(scope, id);

    const stackId = props.stackId;

    // Create an S3 bucket for storing documents
    const documentBucket = new s3.Bucket(this, 'DocumentBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    const collectionName = props.stackName + stackId + '-collection';

    // Create IAM role for Bedrock to access OpenSearch and S3
    const bedrockServiceRole = new iam.Role(this, 'BedrockServiceRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      description: 'Role for Bedrock to access OpenSearch and S3'
    });

    // Grant permissions to the Bedrock service role
    documentBucket.grantReadWrite(bedrockServiceRole);

    // Add specific permissions for OpenSearch data access
    bedrockServiceRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'aoss:CreateIndex',
        'aoss:DeleteIndex',
        'aoss:UpdateIndex',
        'aoss:DescribeIndex',
        'aoss:ReadDocument',
        'aoss:WriteDocument'
      ],
      resources: [
        `arn:aws:aoss:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:collection/${collectionName}/*`
      ]
    }));

    // Create OpenSearch Serverless Collection
    const collection = new opensearchserverless.CfnCollection(this, 'BedrockKBCollection', {
      name: collectionName,
      type: 'VECTORSEARCH',
      description: 'Collection for Bedrock Knowledge Base',
    });

    // Create encryption policy for OpenSearch Serverless
    const encryptionPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'EncryptionPolicy', {
      name: `${props.stackName}${stackId}encryption`,
      type: 'encryption',
      description: 'Encryption policy for Bedrock Knowledge Base',
      policy: JSON.stringify({
        Rules: [
          {
            ResourceType: 'collection',
            Resource: [`collection/${collectionName}`]
          }
        ],
        AWSOwnedKey: true
      })
    });

    // Create network policy for OpenSearch Serverless
    const networkPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'NetworkPolicy', {
      name: `${props.stackName}${stackId}network`,
      type: 'network',
      description: 'Network policy for Bedrock Knowledge Base',
      policy: JSON.stringify([
        {
          Rules: [
            {
              ResourceType: 'collection',
              Resource: [`collection/${collectionName}`]
            },
            {
              ResourceType: 'dashboard',
              Resource: [`collection/${collectionName}`]
            }
          ],
          AllowFromPublic: true
        }
      ])
    });

    // Create data access policy for OpenSearch Serverless
    const dataAccessPolicy = new opensearchserverless.CfnAccessPolicy(this, 'DataAccessPolicy', {
      name: `${props.stackName}${stackId}access`,
      type: 'data',
      description: 'Data access policy for Bedrock Knowledge Base',
      policy: JSON.stringify([
        {
          Rules: [
            {
              ResourceType: 'index',
              Resource: [`index/${collectionName}/*`],
              Permission: [
                'aoss:ReadDocument', 
                'aoss:WriteDocument',
                'aoss:CreateIndex',
                'aoss:DeleteIndex',
                'aoss:UpdateIndex',
                'aoss:DescribeIndex'
              ]
            },
            {
              ResourceType: 'collection',
              Resource: [`collection/${collectionName}`],
              Permission: [
                'aoss:DescribeCollectionItems', 
                'aoss:CreateCollectionItems',
                'aoss:UpdateCollectionItems',
              ]
            }
          ],
          Principal: [
            bedrockServiceRole.roleArn,
            `arn:aws:iam::${cdk.Stack.of(this).account}:root`,
            `arn:aws:sts::${cdk.Stack.of(this).account}:assumed-role/Admin-OneClick/yonmzn-Isengard`,
          ]
        }
      ])
    });

    // Set dependencies
    collection.addDependency(encryptionPolicy);
    collection.addDependency(networkPolicy);
    collection.addDependency(dataAccessPolicy);

    // Add specific permissions for Bedrock service role
    bedrockServiceRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'aoss:APIAccessAll',
        'aoss:DashboardAccessAll',
        'aoss:BatchGetCollection',
        'aoss:CreateCollection',
        'aoss:DeleteCollection',
        'aoss:GetCollection',
        'aoss:ListCollections',
        'aoss:UpdateCollection',
        'aoss:CreateSecurityPolicy',
        'aoss:GetSecurityPolicy',
        'aoss:UpdateSecurityPolicy',
        'aoss:DeleteSecurityPolicy',
        'aoss:CreateAccessPolicy',
        'aoss:GetAccessPolicy',
        'aoss:UpdateAccessPolicy',
        'aoss:DeleteAccessPolicy',
        'aoss:ListAccessPolicies',
        'aoss:ListSecurityPolicies'
      ],
      resources: ['*']
    }));

    // Add specific permissions for Bedrock
    bedrockServiceRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:GetFoundationModel',
        'bedrock:ListFoundationModels',
        'bedrock:CreateKnowledgeBase',
        'bedrock:GetKnowledgeBase',
        'bedrock:UpdateKnowledgeBase',
        'bedrock:DeleteKnowledgeBase',
        'bedrock:ListKnowledgeBases',
        'bedrock:CreateDataSource',
        'bedrock:GetDataSource',
        'bedrock:UpdateDataSource',
        'bedrock:DeleteDataSource',
        'bedrock:ListDataSources',
        'bedrock:StartIngestionJob',
        'bedrock:GetIngestionJob',
        'bedrock:ListIngestionJobs',
        'bedrock:Retrieve',
        'bedrock:Query'
      ],
      resources: ['*']
    }));

    // Add policy to allow Bedrock to assume the role
    const bedrockTrustPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['sts:AssumeRole'],
      principals: [new iam.ServicePrincipal('bedrock.amazonaws.com')]
    });
    bedrockServiceRole.assumeRolePolicy.addStatements(bedrockTrustPolicy);

    // Outputs
    new CfnOutput(this, 'DocumentBucketName', {
      value: documentBucket.bucketName,
      description: 'Name of the S3 bucket for storing documents'
    });

    new CfnOutput(this, 'OpenSearchCollectionId', {
      value: collection.attrId,
      description: 'ID of the OpenSearch Serverless collection'
    });

    new CfnOutput(this, 'BedrockServiceRoleArn', {
      value: bedrockServiceRole.roleArn,
      description: 'ARN of the IAM role for Bedrock service'
    });

    // Create a Lambda function to create the OpenSearch index using NodejsFunction
    const createIndexLambda = new NodejsFunction(this, 'CreateIndexLambda', {
      entry: join(__dirname, '../lambda/create-aos-index.js'),
      handler: 'handler',
      runtime: cdk.aws_lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.minutes(5),
      bundling: {
        minify: true,
        sourceMap: true,
        nodeModules: [
          '@aws-sdk/client-opensearchserverless',
          '@aws-sdk/signature-v4',
          '@aws-sdk/credential-provider-node',
          '@aws-sdk/protocol-http',
          '@aws-sdk/node-http-handler',
          '@aws-crypto/sha256-js'
        ]
      }
    });
    
    // Add permissions for the Lambda to access OpenSearch
    createIndexLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'aoss:APIAccessAll',
        'aoss:CreateIndex',
        'aoss:UpdateIndex',
        'aoss:DeleteIndex',
        'aoss:DescribeIndex',
        'aoss:ReadDocument',
        'aoss:WriteDocument',
        'aoss:BatchGetCollection',
        'aoss:CreateCollection',
        'aoss:DeleteCollection',
        'aoss:GetCollection',
        'aoss:ListCollections',
        'aoss:UpdateCollection'
      ],
      resources: ['*']
    }));

    const vectorIndexName = 'gaokao-vector-index';
    
    // Create a custom resource to invoke the Lambda
    const createIndexCustomResource = new cdk.CustomResource(this, 'CreateIndexResource', {
      serviceToken: new cdk.custom_resources.Provider(this, 'CreateIndexProvider', {
        onEventHandler: createIndexLambda
      }).serviceToken,
      properties: {
        CollectionEndpoint: collection.attrCollectionEndpoint,
        IndexName: vectorIndexName,
        Region: cdk.Stack.of(this).region
      }
    });
    
    // Ensure the custom resource depends on the collection and policies
    createIndexCustomResource.node.addDependency(collection);
    createIndexCustomResource.node.addDependency(dataAccessPolicy);
    createIndexCustomResource.node.addDependency(networkPolicy);
    createIndexCustomResource.node.addDependency(encryptionPolicy);

    // Create the Bedrock Knowledge Base using CfnKnowledgeBase construct
    const knowledgeBase = new bedrock.CfnKnowledgeBase(this, 'GaokaoKnowledgeBase', {
      name: `${props.stackName}-${stackId}-KB`,
      description: 'Knowledge base for Gaokao college recommendations',
      roleArn: bedrockServiceRole.roleArn,
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: `arn:aws:bedrock:${cdk.Stack.of(this).region}::foundation-model/amazon.titan-embed-text-v2:0`,
          embeddingModelConfiguration: {
            bedrockEmbeddingModelConfiguration: {
              dimensions: 1024,
            }
          }
        }
      },
      storageConfiguration: {
        type: 'OPENSEARCH_SERVERLESS',
        opensearchServerlessConfiguration: {
          collectionArn: collection.attrArn,
          vectorIndexName: vectorIndexName,
          fieldMapping: {
            vectorField: 'embedding',
            textField: 'text',
            metadataField: 'metadata'
          }
        }
      }
    });

    // Add explicit dependency to ensure collection is fully created before knowledge base
    knowledgeBase.node.addDependency(collection);
    knowledgeBase.node.addDependency(encryptionPolicy);
    knowledgeBase.node.addDependency(networkPolicy);
    knowledgeBase.node.addDependency(dataAccessPolicy);
    knowledgeBase.node.addDependency(createIndexCustomResource);

    // Create CloudFormation outputs
    new CfnOutput(this, 'KnowledgeBaseId', {
      value: knowledgeBase.attrKnowledgeBaseId,
      description: 'ID of the Bedrock Knowledge Base'
    });

    new CfnOutput(this, 'KnowledgeBaseArn', {
      value: knowledgeBase.attrKnowledgeBaseArn,
      description: 'ARN of the Bedrock Knowledge Base'
    });

    // Store the knowledge base ID and ARN for reference in other constructs
    this.knowledgeBaseId = knowledgeBase.attrKnowledgeBaseId;
    this.knowledgeBaseArn = knowledgeBase.attrKnowledgeBaseArn;

    // Create a data source for the knowledge base
    const dataSource = new bedrock.CfnDataSource(this, 'DocumentDataSource', {
      name: `${props.stackName}-${stackId}-DataSource`,
      description: 'S3 data source for Gaokao college recommendations',
      knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
      dataSourceConfiguration: {
        type: 'S3',
        s3Configuration: {
          bucketArn: documentBucket.bucketArn,
          bucketOwner: cdk.Stack.of(this).account,
          inclusionPrefixes: ['documents/']
        }
      },
      vectorIngestionConfiguration: {
        chunkingConfiguration: {
          chunkingStrategy: 'FIXED_SIZE',
          fixedSizeChunkingConfiguration: {
            maxTokens: 300,
            overlapPercentage: 10
          }
        }
      }
    });
    
    // Add dependency to ensure knowledge base is created before data source
    dataSource.node.addDependency(knowledgeBase);
  }
} 