import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@smithy/protocol-http';
import type { APIGatewayProxyHandler } from 'aws-lambda';

const region = process.env.AWS_REGION || 'eu-central-1';
const ssmClient = new SSMClient({ region });

let cachedRuntimeId: string | null = null;

async function getAgentRuntimeId(): Promise<string> {
  if (cachedRuntimeId) return cachedRuntimeId;

  const paramName = process.env.AGENT_RUNTIME_ID_PARAM;
  if (!paramName) throw new Error('AGENT_RUNTIME_ID_PARAM not configured');

  const response = await ssmClient.send(new GetParameterCommand({ Name: paramName }));
  if (!response.Parameter?.Value) throw new Error('Agent runtime ID not found in SSM');

  cachedRuntimeId = response.Parameter.Value;
  return cachedRuntimeId;
}

async function sendToClient(
  apiClient: ApiGatewayManagementApiClient,
  connectionId: string,
  data: object
) {
  await apiClient.send(
    new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(data)),
    })
  );
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const connectionId = event.requestContext.connectionId!;
  const { domainName, stage } = event.requestContext;

  const apiClient = new ApiGatewayManagementApiClient({
    endpoint: `https://${domainName}/${stage}`,
    region,
  });

  let body: { message: string; sessionId: string; userId?: string };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    await sendToClient(apiClient, connectionId, { type: 'error', error: 'Invalid JSON' });
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { message, sessionId, userId } = body;
  if (!message) {
    await sendToClient(apiClient, connectionId, { type: 'error', error: 'Message required' });
    return { statusCode: 400, body: 'Message required' };
  }

  console.log(`Processing message for session ${sessionId}, user ${userId}: ${message.substring(0, 100)}...`);

  try {
    const runtimeId = await getAgentRuntimeId();
    const accountId = process.env.AWS_ACCOUNT_ID;
    if (!accountId) throw new Error('AWS_ACCOUNT_ID environment variable not configured');

    const runtimeArn = `arn:aws:bedrock-agentcore:${region}:${accountId}:runtime/${runtimeId}`;
    const encodedArn = encodeURIComponent(runtimeArn);
    const host = `bedrock-agentcore.${region}.amazonaws.com`;
    const path = `/runtimes/${encodedArn}/invocations`;

    const credentials = await defaultProvider()();
    // Pass sessionId and userId to the agent for memory
    const requestBody = JSON.stringify({ prompt: message, sessionId, userId });

    const request = new HttpRequest({
      method: 'POST',
      protocol: 'https:',
      hostname: host,
      path,
      headers: { 'Content-Type': 'application/json', host },
      body: requestBody,
    });

    const signer = new SignatureV4({
      credentials,
      region,
      service: 'bedrock-agentcore',
      sha256: Sha256,
    });

    const signedRequest = await signer.sign(request);

    // Send "thinking" status
    await sendToClient(apiClient, connectionId, { type: 'status', status: 'thinking' });

    const response = await fetch(`https://${host}${path}`, {
      method: 'POST',
      headers: signedRequest.headers as Record<string, string>,
      body: requestBody,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AgentCore error:', response.status, errorText);
      await sendToClient(apiClient, connectionId, {
        type: 'error',
        error: `AgentCore error: ${response.status}`,
        sessionId,
      });
      return { statusCode: 200, body: 'Error sent' };
    }

    const responseText = await response.text();
    console.log('Raw response length:', responseText.length);
    console.log('Raw response preview:', responseText.substring(0, 500));

    // Parse SSE and stream chunks to client
    if (responseText.includes('data:')) {
      const lines = responseText.split('\n');
      let fullResponse = '';
      let hasError = false;
      let errorMessage = '';

      for (const line of lines) {
        if (line.startsWith('data:')) {
          const content = line.slice(5).trim();
          if (!content) continue;

          let chunkText = content;
          try {
            const parsed = JSON.parse(content);
            if (typeof parsed === 'string') {
              chunkText = parsed;
            } else if (parsed && typeof parsed === 'object') {
              // Check if this is an error event from AgentCore
              if (parsed.error || parsed.error_type || parsed.message?.includes('error')) {
                hasError = true;
                errorMessage = parsed.error || parsed.message || 'Unknown streaming error';
                console.error('AgentCore streaming error:', parsed);
                break;
              }
              chunkText = parsed.text || parsed.content || parsed.message || JSON.stringify(parsed);
            }
          } catch {
            chunkText = content;
          }

          fullResponse += chunkText;

          await sendToClient(apiClient, connectionId, {
            type: 'chunk',
            chunk: chunkText,
            sessionId,
          });
        }
      }

      if (hasError) {
        await sendToClient(apiClient, connectionId, {
          type: 'error',
          error: errorMessage,
          sessionId,
        });
        return { statusCode: 200, body: 'Error sent' };
      }

      await sendToClient(apiClient, connectionId, {
        type: 'complete',
        response: fullResponse,
        sessionId,
      });
    } else {
      await sendToClient(apiClient, connectionId, {
        type: 'complete',
        response: responseText,
        sessionId,
      });
    }

    return { statusCode: 200, body: 'Message processed' };
  } catch (error) {
    console.error('Error:', error);
    await sendToClient(apiClient, connectionId, {
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      sessionId,
    });
    return { statusCode: 200, body: 'Error sent' };
  }
};
