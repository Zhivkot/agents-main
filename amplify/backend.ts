import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { invokeAgent } from './functions/invokeAgent/resource';
import { AgentCoreResource } from './custom/agentcore/resource';
import { WebSocketApiResource } from './custom/websocket/resource';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';

const backend = defineBackend({
  auth,
  data,
  invokeAgent,
});
//
const stack = backend.createStack('AgentCoreStack');

// Add AgentCore custom resources using Amplify's auth
const agentCore = new AgentCoreResource(stack, 'AgentCore', {
  appName: 'neoAmber',
  userPool: backend.auth.resources.userPool,
  authenticatedRole: backend.auth.resources.authenticatedUserIamRole,
});

// Store runtime ID in SSM Parameter to break circular dependency
const runtimeIdParam = new ssm.StringParameter(stack, 'AgentRuntimeIdParam', {
  parameterName: '/amplify/agentcore/runtimeId',
  stringValue: agentCore.agentCoreRuntime.attrAgentRuntimeId,
});

// Add WebSocket API for streaming responses
const webSocketApi = new WebSocketApiResource(stack, 'WebSocketApi', {
  runtimeIdParamName: '/amplify/agentcore/runtimeId',
});

// Grant Lambda permission to read SSM parameter and invoke AgentCore
const invokeAgentFn = backend.invokeAgent.resources.lambda;
const invokeAgentCfn = invokeAgentFn.node.defaultChild as cdk.aws_lambda.CfnFunction;

// Add SSM parameter name and account ID as env vars
const existingEnv = (invokeAgentCfn.environment as { variables?: Record<string, string> })?.variables || {};
invokeAgentCfn.environment = {
  variables: {
    ...existingEnv,
    AGENT_RUNTIME_ID_PARAM: '/amplify/agentcore/runtimeId',
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

// Output AgentCore values to amplify_outputs.json
backend.addOutput({
  custom: {
    agentCoreRuntimeId: agentCore.agentCoreRuntime.attrAgentRuntimeId,
    agentCoreRuntimeArn: agentCore.agentCoreRuntime.attrAgentRuntimeArn,
    agentCoreGatewayUrl: agentCore.agentCoreGateway.attrGatewayUrl,
    agentCoreMemoryId: agentCore.agentCoreMemory.attrMemoryId,
    agentCoreRegion: cdk.Stack.of(stack).region,
    webSocketUrl: webSocketApi.webSocketUrl,
  },
});
