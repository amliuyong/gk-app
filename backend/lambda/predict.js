import fetch from 'node-fetch';
import { BedrockRuntimeClient, InvokeModelWithResponseStreamCommand } from "@aws-sdk/client-bedrock-runtime";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import OpenAI from 'openai';

// Initialize SQS client
const sqsClient = new SQSClient({ region: process.env.AWS_REGION });

// Common method to send messages to the WebSocket client
async function sendMessageToSQS(connectionId, message) {
  try {
    // Send message directly to WebSocket
    // const command = new PostToConnectionCommand({
    //   ConnectionId: connectionId,
    //   Data: JSON.stringify(message)
    // });
    // await apiGatewayClient.send(command);

    // Also send to SQS queue

    const sqsMessage = {
      connectionId: connectionId,
      data: message
    };

    const sqsCommand = new SendMessageCommand({
      QueueUrl: process.env.WEBSOCKET_QUEUE_URL,
      MessageBody: JSON.stringify(sqsMessage),
      // Optional: Add message attributes if needed
      MessageAttributes: {
        messageType: {
          DataType: 'String',
          StringValue: message.type || 'unknown'
        }
      }
    });

    await sqsClient.send(sqsCommand);

  } catch (error) {
    console.error('Error sending message to client or SQS:', error);
    // Don't throw here to prevent cascading failures
  }
}

export const handler = async (event) => {
  console.log("event:", event);

  const connectionId = event.requestContext.connectionId;
  const domain = event.requestContext.domainName;
  const stage = event.requestContext.stage;
  const endpoint = `https://${domain}/${stage}`;
  const websocket_endpoint = process.env.WEBSOCKET_ENDPOINT;

  console.log("websocket_endpoint:", websocket_endpoint);
  console.log("endpoint:", endpoint);

  try {
    const body = JSON.parse(event.body);
    console.log("body:", body);

    const model = body.data.model;

    body.model = model;
    build_prompt(body);

    console.log("after build_prompt body:", body);

    if (model.startsWith('deepseek')) {
      // 使用 Ollama API
      return await handleOllamaStream(body, connectionId);
    } else if (model.startsWith('anthropic')) {
      // 使用 AWS Bedrock
      return await handleBedrockAnthropicStream(body, connectionId);
    } else if (model.startsWith('amazon.nova')) {
      // 使用 AWS Bedrock Nova
      return await handleNovaStream(body, connectionId);
    } else if (model.startsWith('openai')) {
      // 使用 OpenAI API
      return await handleOpenAIStream(body, connectionId);
    } else {
      throw new Error('Unsupported model');
    }

  } catch (error) {
    console.error('Error:', error);
    try {
      await sendMessageToSQS(connectionId, {
        type: 'error',
        message: error.message
      });
    } catch (e) {
      console.error('Error sending error message:', e);
    }
    return { statusCode: 500 };
  }
};


function build_prompt(body) {
  // body: '{"action":"predict","data":{"model":"deepseek-r1:14b","score":"5555","ranking":"555","province":"beijing","preferredCity":["no_preference"],"examSubjects":["physics","chemistry","biology"],"interests":["computer"]}}',
  const model = body.data.model;
  const score = body.data.score;
  const ranking = body.data.ranking;
  const province = body.data.province;
  const preferredCity = body.data.preferredCity;
  const examSubjects = body.data.examSubjects;
  const interests = body.data.interests;
  const prompt = `你是高考志愿专家，根据以下信息，给出志愿填报建议：

  1. 高考分数：${score}
  2. 省内排名：${ranking}
  3. 考试省份：${province}
  4. 大学意向城市：${preferredCity.join(',')}
  5. 高考试科目：数学,语文,英语,${examSubjects.join(',')}
  6. 兴趣方向：${interests.join(',')}

给出中国境内，冲刺院校5所，稳妥院校5所，保底院校5所，以及这些院校的近3年录取分数线和专业。
  `;

  body.prompt = prompt;

  return prompt;
}


// Ollama 处理函数
async function handleOllamaStream(body, connectionId) {
  const ollamaUrl = process.env.OLLAMA_API_URL;

  // 将历史消息转换为文本格式
  let fullPrompt = '';
  if (body.context) {
    const history = body.context;  // 已经是对象数组
    for (const msg of history) {
      const role = msg.role === 'user' ? 'Human' : 'Assistant';
      fullPrompt += `${role}: ${msg.content}\n`;
    }
  }
  fullPrompt += `Human: ${body.prompt}`;

  console.log('fullPrompt:', fullPrompt);
  const response = await fetch(`${ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: body.model,
      prompt: fullPrompt,
      stream: true,
    }),
  });

  const reader = response.body;
  const decoder = new TextDecoder();
  let sequence = 0;

  for await (const chunk of reader) {
    const text = decoder.decode(chunk);
    const lines = text.split('\n').filter(line => line.trim());
   
    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        await sendMessageToSQS(connectionId, {
          type: 'response',
          sequence: sequence++,
          content: data.response,
          done: data.done
        });

        if (data.done) break;
      } catch (e) {
        console.error('Error parsing line:', e);
      }
    }
  }

  return { statusCode: 200 };
}

// Bedrock 处理函数
async function handleBedrockAnthropicStream(body, connectionId) {
  const bedrockClient = new BedrockRuntimeClient({
    region: process.env.AWS_REGION
  });

  const modelId = body.model;
  console.log('Using model:', modelId);

  // 将历史消息转换为 Anthropic 格式
  const messages = [];
  if (body.context) {
    const history = body.context;  // 已经是对象数组
    for (const msg of history) {
      messages.push({
        role: msg.role,
        content: [{ type: "text", text: msg.content }]
      });
    }
  }

  // 添加当前提示
  messages.push({
    role: "user",
    content: [{ type: "text", text: body.prompt }]
  });

  // log messages
  console.log('messages:', messages);

  const command = new InvokeModelWithResponseStreamCommand({
    modelId: modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 4096,
      messages: messages
    })
  });

  try {
    const response = await bedrockClient.send(command);
    const chunks = [];
    let sequence = 0;
    for await (const chunk of response.body) {
      const decoded = JSON.parse(new TextDecoder().decode(chunk.chunk.bytes));
      //console.log('decoded chunk:', decoded);

      if (decoded.type === 'content_block_delta') {
        await sendMessageToSQS(connectionId, {
          type: 'response',
          sequence: sequence++,
          content: decoded.delta.text,
          done: false
        });
        chunks.push(decoded.delta.text);
      }

      if (decoded.type === 'message_stop') {
        await sendMessageToSQS(connectionId, {
          type: 'response',
          content: '',
          sequence: sequence++,
          done: true
        });
        break;
      }
    }

    return { statusCode: 200 };
  } catch (error) {
    console.error('Bedrock Error:', error);
    await sendMessageToSQS(connectionId, {
      type: 'error',
      message: `Bedrock Error: ${error.message}`
    });
    return { statusCode: 500 };
  }
}

// Nova handler function
async function handleNovaStream(body, connectionId) {
  const bedrockClient = new BedrockRuntimeClient({
    region: process.env.AWS_REGION
  });

  // Extract the model ID from the body
  let modelId = body.model;

  if (modelId.startsWith('amazon.nova')) {
    modelId = "us." + modelId
  }
  console.log('Using Nova model:', modelId);
  
  // 将历史消息转换为 Nova 格式
  const messages = [];
  if (body.context) {
    const history = body.context;  // 已经是对象数组
    for (const msg of history) {
      messages.push({
        role: msg.role,
        content: [{ text: msg.content }]
      });
    }
  }

  // 添加当前提示
  messages.push({
    role: "user",
    content: [{ text: body.prompt }]
  });

  console.log('messages:', messages);

  const command = new InvokeModelWithResponseStreamCommand({
    modelId: modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      inferenceConfig: {
        max_new_tokens: 4096,
      },
      messages: messages
    })
  });

  try {
    const response = await bedrockClient.send(command);
    let isFirstChunk = true;
    let responseText = '';

    let messageStop = false;
    let sequence = 0;
    for await (const chunk of response.body) {
      const decoded = JSON.parse(new TextDecoder().decode(chunk.chunk.bytes));

      // Log first chunk for debugging
      if (isFirstChunk) {
        console.log('First chunk:', decoded);
        isFirstChunk = false;
      }

      // Nova returns chunks with delta.text field
      if (decoded.contentBlockDelta?.delta?.text) {
        responseText += decoded.contentBlockDelta.delta.text;
        await sendMessageToSQS(connectionId, {
          type: 'response',
          sequence: sequence++,
          content: decoded.contentBlockDelta.delta.text,
          done: false
        });
      }
    }

    // Send final response if we have accumulated text
    if (responseText && !messageStop) {
      await sendMessageToSQS(connectionId, {
        type: 'response',
        sequence: sequence++,
        content: '',
        done: true
      });
    } else {
      // If no response was generated, send an error
      await sendMessageToSQS(connectionId, {
        type: 'error',
        message: 'No response generated from Nova model'
      });
    }

    return { statusCode: 200 };
  } catch (error) {
    console.error('Nova Error:', error);
    await sendMessageToSQS(connectionId, {
      type: 'error',
      message: `Nova Error: ${error.message}`
    });
    return { statusCode: 500 };
  }
}

// 添加获取 OpenAI API Key 的函数
async function getOpenAIKey() {
  const ssmClient = new SSMClient({ region: process.env.AWS_REGION });
  const command = new GetParameterCommand({
    Name: '/openai/api-key',
    WithDecryption: true,
  });

  try {
    const response = await ssmClient.send(command);
    return response.Parameter.Value;
  } catch (error) {
    console.error('Error fetching OpenAI API Key:', error);
    throw new Error('Failed to fetch OpenAI API Key');
  }
}

// OpenAI 处理函数
async function handleOpenAIStream(body, connectionId) {
  const apiKey = await getOpenAIKey();
  const openai = new OpenAI({
    apiKey: apiKey
  });

  const model = body.model.replace('openai.', '');
  console.log("model:", model);

  // 将历史消息转换为 OpenAI 格式
  const messages = [];
  if (body.context) {
    messages.push(...body.context);  // OpenAI 可以直接使用相同格式
  }

  // 添加当前提示
  messages.push({ role: 'user', content: body.prompt });

  console.log('messages:', messages);
  const stream = await openai.chat.completions.create({
    model: model,
    messages: messages,
    stream: true,
  });

  let sequence = 0;

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || '';
    if (content) {
      await sendMessageToSQS(connectionId, {
        type: 'response',
        sequence: sequence++,
        content: content,
        done: false
      });
    }
  }

  // 发送完成信号
  await sendMessageToSQS(connectionId, {
    type: 'response',
    content: '',
    sequence: sequence++,
    done: true
  });

  return { statusCode: 200 };
} 