import type { APIGatewayProxyHandler } from 'aws-lambda';

export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('WebSocket disconnect:', event.requestContext.connectionId);
  
  // You could remove connection ID from DynamoDB here
  
  return {
    statusCode: 200,
    body: 'Disconnected',
  };
};
