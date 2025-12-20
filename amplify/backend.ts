import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { invokeAgent } from './functions/invokeAgent/resource';
import { AgentRegistry } from './custom/agentcore/AgentRegistry';
import { agentConfig } from './custom/agentcore/agents.config';
import { WebSocketApiResource } from './custom/websocket/resource';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';

const backend = defineBackend({
  auth,
  data,
  invokeAgent,
});

const stack = backend.createStack('AgentCoreStack');

// Create AgentRegistry with all configured agents
const agentRegistry = new AgentRegistry(stack, 'AgentRegistry', {
  appName: 'neoAmber',
  userPool: backend.auth.resources.userPool,
  authenticatedRole: backend.auth.resources.authenticatedUserIamRole,
  config: agentConfig,
});

// Add WebSocket API for streaming responses
// Use default agent's SSM parameter path for backward compatibility
const webSocketApi = new WebSocketApiResource(stack, 'WebSocketApi', {
  runtimeIdParamName: `/amplify/agentcore/${agentRegistry.defaultAgentName}/runtimeId`,
  defaultAgentName: agentRegistry.defaultAgentName,
});

// Grant Lambda permission to read SSM parameters and invoke AgentCore
const invokeAgentFn = backend.invokeAgent.resources.lambda;
const invokeAgentCfn = invokeAgentFn.node.defaultChild as cdk.aws_lambda.CfnFunction;

// Add SSM parameter pattern and account ID as env vars for multi-agent support
const existingEnv = (invokeAgentCfn.environment as { variables?: Record<string, string> })?.variables || {};
invokeAgentCfn.environment = {
  variables: {
    ...existingEnv,
    // Pattern for looking up agent runtime IDs by name
    AGENT_RUNTIME_ID_PARAM_PATTERN: '/amplify/agentcore/{agentName}/runtimeId',
    // Default agent name for backward compatibility
    DEFAULT_AGENT_NAME: agentRegistry.defaultAgentName,
    AWS_ACCOUNT_ID: cdk.Stack.of(stack).account,
  },
};

// Grant permissions via inline policy on the function stack
const functionStack = cdk.Stack.of(invokeAgentFn);
new iam.Policy(functionStack, 'InvokeAgentPermissions', {
  roles: [iam.Role.fromRoleArn(functionStack, 'InvokeAgentRole', invokeAgentFn.role!.roleArn)],
  statements: [
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:*:*:parameter/amplify/agentcore/*`],
    }),
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock-agentcore:InvokeAgentRuntime',
        'bedrock-agentcore:InvokeAgent',
      ],
      resources: ['*'],
    }),
  ],
});

// Build agents output object with all deployed agents
const agentsOutput: Record<string, {
  runtimeId: string;
  runtimeArn: string;
  description?: string;
  isDefault?: boolean;
}> = {};

for (const agentDef of agentConfig.agents) {
  const agentResources = agentRegistry.getAgent(agentDef.name);
  if (agentResources) {
    agentsOutput[agentDef.name] = {
      runtimeId: agentResources.runtime.attrAgentRuntimeId,
      runtimeArn: agentResources.runtime.attrAgentRuntimeArn,
      description: agentDef.description,
      isDefault: agentDef.isDefault,
    };
  }
}

// Output AgentCore values to amplify_outputs.json with multi-agent support
backend.addOutput({
  custom: {
    // Multi-agent support: all agents with their details
    agents: agentsOutput,
    // Default agent name for backward compatibility
    defaultAgent: agentRegistry.defaultAgentName,
    // Shared resources (if configured)
    sharedGatewayUrl: agentRegistry.sharedGateway?.attrGatewayUrl,
    sharedMemoryId: agentRegistry.sharedMemory?.attrMemoryId,
    // Region and WebSocket URL
    agentCoreRegion: cdk.Stack.of(stack).region,
    webSocketUrl: webSocketApi.webSocketUrl,
  },
});
