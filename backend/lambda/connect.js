export const handler = async (event) => {
  console.log('Client connected:', event.requestContext.connectionId);
  return { statusCode: 200 };
}; 