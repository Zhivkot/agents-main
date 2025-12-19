import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@smithy/protocol-http';

const region = process.env.AWS_REGION || 'eu-central-1';
const ssmClient = new SSMClient({ region });

// Cache the runtime ID
let cachedRuntimeId: string | null = null;

async function getAgentRuntimeId(): Promise<string> {
  if (cachedRuntimeId) {
    return cachedRuntimeId;
  }

  const paramName = process.env.AGENT_RUNTIME_ID_PARAM;
  console.log('SSM Parameter name:', paramName);

  if (!paramName) {
    throw new Error('AGENT_RUNTIME_ID_PARAM not configured');
  }

  const response = await ssmClient.send(new GetParameterCommand({ Name: paramName }));

  if (!response.Parameter?.Value) {
    throw new Error('Agent runtime ID not found in SSM');
  }

  cachedRuntimeId = response.Parameter.Value;
  console.log('Retrieved Agent Runtime ID:', cachedRuntimeId);

  return cachedRuntimeId;
}

interface InvokeAgentEvent {
  arguments: {
    message: string;
    sessionId: string;
  };
}

export const handler = async (event: InvokeAgentEvent) => {
  console.log('Event received:', JSON.stringify(event, null, 2));

  const { message, sessionId } = event.arguments;

  let runtimeId: string;
  try {
    runtimeId = await getAgentRuntimeId();
  } catch (error) {
    console.error('Failed to get runtime ID:', error);
    return {
      success: false,
      error: `Failed to get runtime ID: ${error instanceof Error ? error.message : 'Unknown'}`,
      sessionId,
    };
  }

  // Build the full runtime ARN
  const accountId = process.env.AWS_ACCOUNT_ID || process.env.ACCOUNT_ID;
  
  // Extract account ID from Lambda execution context if not in env
  let resolvedAccountId = accountId;
  if (!resolvedAccountId) {
    throw new Error('AWS_ACCOUNT_ID environment variable not configured');
  }
  
  const runtimeArn = `arn:aws:bedrock-agentcore:${region}:${resolvedAccountId}:runtime/${runtimeId}`;
  const encodedArn = encodeURIComponent(runtimeArn);
  
  console.log('Runtime ARN:', runtimeArn);
  console.log('Encoded ARN:', encodedArn);

  const host = `bedrock-agentcore.${region}.amazonaws.com`;
  const paths = [
    `/runtimes/${encodedArn}/invocations`,
  ];

  const credentials = await defaultProvider()();
  const body = JSON.stringify({ prompt: message, sessionId });

  for (const path of paths) {
    console.log(`=== Trying path: ${path} ===`);

    try {
      const request = new HttpRequest({
        method: 'POST',
        protocol: 'https:',
        hostname: host,
        path,
        headers: {
          'Content-Type': 'application/json',
          host,
        },
        body,
      });

      const signer = new SignatureV4({
        credentials,
        region,
        service: 'bedrock-agentcore',
        sha256: Sha256,
      });

      const signedRequest = await signer.sign(request);

      console.log('Request URL:', `https://${host}${path}`);
      console.log('Request body:', body);

      const response = await fetch(`https://${host}${path}`, {
        method: 'POST',
        headers: signedRequest.headers as Record<string, string>,
        body,
      });

      console.log(`Response status: ${response.status}`);

      const responseText = await response.text();
      console.log(`Response body: ${responseText}`);

      if (response.ok) {
        // Parse SSE (Server-Sent Events) format response
        // Format: data: "chunk1"\ndata: "chunk2"\n...
        let fullResponse = '';
        
        if (responseText.includes('data:')) {
          // Parse SSE format - extract content from each "data:" line
          const lines = responseText.split('\n');
          for (const line of lines) {
            if (line.startsWith('data:')) {
              const content = line.slice(5).trim(); // Remove "data:" prefix
              try {
                // Try to parse as JSON string (e.g., data: "Hello")
                const parsed = JSON.parse(content);
                fullResponse += parsed;
              } catch {
                // If not JSON, use raw content
                fullResponse += content;
              }
            }
          }
        } else {
          // Try regular JSON parsing
          try {
            const data = JSON.parse(responseText);
            fullResponse = data.response || data.output || data.result || JSON.stringify(data);
          } catch {
            fullResponse = responseText;
          }
        }
        
        console.log('Parsed full response:', fullResponse);
        return {
          success: true,
          response: fullResponse,
          sessionId,
        };
      }

      // If we get a 404, try next path
      if (response.status === 404) {
        console.log(`Path ${path} returned 404, trying next...`);
        continue;
      }

      // For other errors, return the error
      return {
        success: false,
        error: `AgentCore error (${path}): ${response.status} - ${responseText}`,
        sessionId,
      };
    } catch (err) {
      console.error(`Exception for ${path}:`, err);
      continue;
    }
  }

  return {
    success: false,
    error: `All API paths failed. The AgentCore Runtime API endpoint format may have changed. Check CloudWatch logs for details.`,
    sessionId,
  };
};
