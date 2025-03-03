export const handler = async (event) => {
  console.log('Client disconnected:', event.requestContext.connectionId);
  return { statusCode: 200 };
}; 