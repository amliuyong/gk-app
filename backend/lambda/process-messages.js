import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";

export const handler = async (event) => {
  console.log('Processing SQS messages:', JSON.stringify(event));
  
  // Extract the WebSocket endpoint from environment variable and format it correctly
  const wsEndpoint = process.env.WEBSOCKET_ENDPOINT;
  if (!wsEndpoint) {
    console.error('WEBSOCKET_ENDPOINT environment variable is not set');
    throw new Error('WEBSOCKET_ENDPOINT environment variable is not set');
  }
  
  // Convert wss:// to https:// for the API client
  const endpoint = wsEndpoint.replace('wss://', 'https://');
  console.log('Using API Gateway endpoint:', endpoint);
  
  const apiGatewayClient = new ApiGatewayManagementApiClient({
    endpoint: endpoint,
  });
  
  // Group messages by connectionId for parallel processing by connection
  const connectionGroups = {};
  
  // Parse and organize messages by connection
  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body);
      const { connectionId, data } = message;
      
      if (!connectionId) {
        throw new Error('Missing connectionId in message');
      }
      
      // Initialize array for this connection if it doesn't exist
      if (!connectionGroups[connectionId]) {
        connectionGroups[connectionId] = [];
      }
      
      // Add message to the connection group
      connectionGroups[connectionId].push({
        data,
        recordId: record.messageId
      });
      
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  }
  
  // Process each connection's messages in parallel
  const connectionPromises = Object.entries(connectionGroups).map(async ([connectionId, messages]) => {
    console.log(`Processing ${messages.length} messages for connection ${connectionId}`);
    
    // Sort messages by sequence number
    messages.sort((a, b) => a.sequence - b.sequence);
    
    // Process all messages for this connection in parallel
    const messagePromises = messages.map(async (message) => {
      try {
        // Send message to WebSocket client
        const command = new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: JSON.stringify(message.data)
        });
        
        await apiGatewayClient.send(command);
        console.log(`Successfully sent message sequence ${message.data.sequence || 'unknown'} to connection ${connectionId}`);
        return {
          recordId: message.recordId,
          result: 'SUCCESS'
        };
      } catch (error) {
        // Handle specific WebSocket errors
        if (error.name === 'GoneException') {
          // Connection is no longer available
          console.log(`Connection ${connectionId} is gone, client disconnected`);
          return {
            recordId: message.recordId,
            result: 'SUCCESS' // Mark as success to remove from queue
          };
        }
        
        console.error(`Error sending message to connection ${connectionId}:`, error);
        return {
          recordId: message.recordId,
          result: 'FAILED'
        };
      }
    });
    
    // Wait for all messages to be processed
    return await Promise.all(messagePromises);
  });
  
  // Wait for all connections to be processed
  const connectionResults = await Promise.all(connectionPromises);
  
  // Flatten the results
  const results = connectionResults.flat();
  
  console.log('Processing results:', results);
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      processed: results.length,
      successful: results.filter(r => r.result === 'SUCCESS').length,
      failed: results.filter(r => r.result === 'FAILED').length
    })
  };
}; 