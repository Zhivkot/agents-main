import type { APIGatewayProxyHandler } from 'aws-lambda';

export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('WebSocket connect:', event.requestContext.connectionId);
  
  // You could store connection ID in DynamoDB here for tracking
  // For now, just accept the connection
  
  return {
    statusCode: 200,
    body: 'Connected',
  };
};
