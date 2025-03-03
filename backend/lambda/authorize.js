export const handler = async (event) => {
  console.log('Auth event:', event);
  
  try {
    // Get the Authorization header from event.headers
    const authHeader = event.queryStringParameters.Authorization || event.headers.authorization;
    
    if (!authHeader) {
      return generatePolicy('user', 'Deny', event.methodArn);
    }

    // Check if it's a Bearer token and matches our test token
    console.log('authHeader:', authHeader);
    if (authHeader == 'Bearer test API') {
      return generatePolicy('user', 'Allow', event.methodArn);
    }

    return generatePolicy('user', 'Deny', event.methodArn);
  } catch (error) {
    console.error('Auth Error:', error);
    return generatePolicy('user', 'Deny', event.methodArn);
  }
};

// Helper function to generate IAM policy
const generatePolicy = (principalId, effect, resource) => {
  const authResponse = {
    principalId: principalId
  };
  
  if (effect && resource) {
    const policyDocument = {
      Version: '2012-10-17',
      Statement: [{
        Action: 'execute-api:Invoke',
        Effect: effect,
        Resource: resource
      }]
    };
    authResponse.policyDocument = policyDocument;
  }

  console.log('Auth response:', JSON.stringify(authResponse));
  
  return authResponse;
}; 