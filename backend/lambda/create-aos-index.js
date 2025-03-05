// Import AWS SDK v3 modules
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@aws-sdk/protocol-http';
import { NodeHttpHandler } from '@aws-sdk/node-http-handler';
import { Sha256 } from '@aws-crypto/sha256-js';
import https from 'https';
import { URL } from 'url';

// Response function for CloudFormation custom resource
async function sendResponse(event, context, responseStatus, responseData) {
  const responseBody = JSON.stringify({
    Status: responseStatus,
    Reason: responseData?.error || 'See CloudWatch logs',
    PhysicalResourceId: context.logStreamName,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: responseData
  });
  
  console.log('Response body:', responseBody);
  
  const parsedUrl = new URL(event.ResponseURL);
  const options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'PUT',
    headers: {
      'Content-Type': '',
      'Content-Length': responseBody.length
    }
  };
  
  return new Promise((resolve, reject) => {
    const request = https.request(options, (response) => {
      console.log(`Status code: ${response.statusCode}`);
      resolve();
    });
    
    request.on('error', (error) => {
      console.error('Error sending response:', error);
      reject(error);
    });
    
    request.write(responseBody);
    request.end();
  });
}

// Create OpenSearch index with AWS SDK v3
async function createIndex(collectionEndpoint, indexName, region) {
  // Create index mapping with vector field
  const indexMapping = {
    mappings: {
      properties: {
        embedding: {
          type: 'knn_vector',
          dimension: 1024,
          method: {
            name: 'hnsw',
            space_type: 'l2',
            engine: 'faiss',
            parameters: {
              m: 16,
              ef_construction: 512
            }
          }
        },
        text: { type: 'text' },
        metadata: { type: 'text', index: false }
      }
    }
  };
  
  try {
    // Parse the collection endpoint URL
    const url = new URL(collectionEndpoint);
    
    // Create a request object
    const request = new HttpRequest({
      hostname: url.hostname,
      method: 'PUT',
      path: '/' + indexName,
      headers: {
        'Content-Type': 'application/json',
        'host': url.hostname
      },
      body: JSON.stringify(indexMapping)
    });
    
    // Create a signer
    const signer = new SignatureV4({
      credentials: defaultProvider(),
      region: region,
      service: 'aoss',
      sha256: Sha256
    });
    
    // Sign the request
    const signedRequest = await signer.sign(request);
    
    // Send the request
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: url.hostname,
          method: signedRequest.method,
          path: signedRequest.path,
          headers: signedRequest.headers,
        },
        (res) => {
          let responseBody = '';
          res.on('data', (chunk) => {
            responseBody += chunk;
          });
          
          res.on('end', () => {
            console.log(`Response status: ${res.statusCode}`);
            console.log(`Response headers: ${JSON.stringify(res.headers)}`);
            console.log(`Response body: ${responseBody}`);
            
            resolve({
              statusCode: res.statusCode,
              body: responseBody
            });
          });
        }
      );
      
      req.on('error', (err) => {
        console.error('Request error:', err);
        reject(err);
      });
      
      if (signedRequest.body) {
        req.write(signedRequest.body);
      }
      
      req.end();
    });
  } catch (error) {
    console.error('Error in createIndex:', error);
    throw error;
  }
}

export const handler = async (event, context) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  try {
    // Handle delete event
    if (event.RequestType === 'Delete') {
      return await sendResponse(event, context, 'SUCCESS', {});
    }
    
    const collectionEndpoint = event.ResourceProperties.CollectionEndpoint;
    const indexName = event.ResourceProperties.IndexName;
    const region = event.ResourceProperties.Region;
    
    console.log(`Creating index ${indexName} in collection ${collectionEndpoint}`);
    
    // Create the index
    const result = await createIndex(collectionEndpoint, indexName, region);
    console.log('Index creation result:', JSON.stringify(result, null, 2));
    
    if (result.statusCode >= 200 && result.statusCode < 300) {
      await sendResponse(event, context, 'SUCCESS', { message: 'Index created successfully' });
    } else {
      await sendResponse(event, context, 'FAILED', { error: `Failed to create index: ${result.body}` });
    }
  } catch (error) {
    console.error('Error:', error);
    await sendResponse(event, context, 'FAILED', { error: error.message });
  }
}; 