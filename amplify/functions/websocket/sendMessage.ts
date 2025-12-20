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

/**
 * WebSocket message interface with optional agent selection
 */
interface WebSocketMessage {
  action: string;
  message: string;
  sessionId: string;
  userId?: string;
  /** Target agent name - if not specified, uses default agent */
  agentName?: string;
}

// Cache for agent runtime IDs (keyed by agent name)
const runtimeIdCache: Map<string, string> = new Map();

/**
 * Get the SSM parameter name for a specific agent's runtime ID
 */
function getAgentParamName(agentName: string): string {
  const pattern = process.env.AGENT_RUNTIME_ID_PARAM_PATTERN;
  if (pattern) {
    return pattern.replace('{agentName}', agentName);
  }
  // Fallback to legacy single-agent param
  return process.env.AGENT_RUNTIME_ID_PARAM || '';
}

/**
 * Get the default agent name from environment
 */
function getDefaultAgentName(): string {
  return process.env.DEFAULT_AGENT_NAME || 'neoAmber';
}

/**
 * Get the runtime ID for a specific agent by looking up its SSM parameter.
 * Results are cached to avoid repeated SSM calls.
 * 
 * @param agentName - The name of the agent to look up
 * @returns The runtime ID for the agent
 * @throws Error if the SSM parameter is not found or not configured
 */
async function getAgentRuntimeId(agentName: string): Promise<string> {
  // Check cache first
  const cached = runtimeIdCache.get(agentName);
  if (cached) return cached;

  const paramName = getAgentParamName(agentName);
  if (!paramName) {
    throw new Error(`Agent runtime ID parameter not configured for agent: ${agentName}`);
  }

  try {
    const response = await ssmClient.send(new GetParameterCommand({ Name: paramName }));
    if (!response.Parameter?.Value) {
      throw new Error(`Agent runtime ID not found in SSM for agent: ${agentName}`);
    }

    // Cache the result
    runtimeIdCache.set(agentName, response.Parameter.Value);
    return response.Parameter.Value;
  } catch (error) {
    if (error instanceof Error && error.name === 'ParameterNotFound') {
      throw new Error(`Agent '${agentName}' not found. SSM parameter '${paramName}' does not exist.`);
    }
    throw error;
  }
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

  let body: WebSocketMessage;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    await sendToClient(apiClient, connectionId, { type: 'error', error: 'Invalid JSON' });
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { message, sessionId, userId, agentName } = body;
  if (!message) {
    await sendToClient(apiClient, connectionId, { type: 'error', error: 'Message required' });
    return { statusCode: 400, body: 'Message required' };
  }

  // Determine which agent to use - fall back to default if not specified
  const targetAgent = agentName || getDefaultAgentName();

  console.log(`Processing message for agent '${targetAgent}', session ${sessionId}, user ${userId}: ${message.substring(0, 100)}...`);

  try {
    const runtimeId = await getAgentRuntimeId(targetAgent);
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

    // Send "thinking" status with agent info
    await sendToClient(apiClient, connectionId, { 
      type: 'status', 
      status: 'thinking',
      agentName: targetAgent,
    });

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
        agentName: targetAgent,
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
            agentName: targetAgent,
          });
        }
      }

      if (hasError) {
        await sendToClient(apiClient, connectionId, {
          type: 'error',
          error: errorMessage,
          sessionId,
          agentName: targetAgent,
        });
        return { statusCode: 200, body: 'Error sent' };
      }

      await sendToClient(apiClient, connectionId, {
        type: 'complete',
        response: fullResponse,
        sessionId,
        agentName: targetAgent,
      });
    } else {
      await sendToClient(apiClient, connectionId, {
        type: 'complete',
        response: responseText,
        sessionId,
        agentName: targetAgent,
      });
    }

    return { statusCode: 200, body: 'Message processed' };
  } catch (error) {
    console.error('Error:', error);
    await sendToClient(apiClient, connectionId, {
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      sessionId,
      agentName: agentName || getDefaultAgentName(),
    });
    return { statusCode: 200, body: 'Error sent' };
  }
};
