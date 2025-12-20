/**
 * SingleAgentResource - CDK Construct for a single AgentCore agent
 * 
 * This construct creates the runtime, endpoints, and SSM parameter for a single agent.
 * It accepts shared gateway and memory resources as constructor parameters to support
 * both shared and dedicated resource modes.
 */

import * as cdk from 'aws-cdk-lib';
import * as bedrockagentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Gateway configuration passed to SingleAgentResource
 */
export interface GatewayConfig {
  gateway: bedrockagentcore.CfnGateway;
  cognitoClientId: string;
  cognitoClientSecret: string;
  cognitoTokenUrl: string;
  cognitoScope: string;
}

/**
 * Props for creating a SingleAgentResource
 */
export interface SingleAgentResourceProps {
  /** Unique agent name (used in resource naming and SSM path) */
  agentName: string;
  /** Relative path to agent folder from the agentcore config directory */
  agentFolderPath: string;
  /** Application name prefix for resource naming */
  appName: string;
  /** Gateway configuration (shared or dedicated) */
  gatewayConfig: GatewayConfig;
  /** Memory resource (shared or dedicated) */
  memory: bedrockagentcore.CfnMemory;
  /** Cognito user pool for authentication */
  userPool: cognito.IUserPool;
  /** IAM role for authenticated users */
  authenticatedRole: iam.IRole;
}

/**
 * CDK Construct that creates AgentCore resources for a single agent.
 * 
 * Creates:
 * - Docker image asset for the agent container
 * - AgentCore Runtime with the agent's container
 * - DEV and PROD endpoints for the runtime
 * - SSM parameter storing the runtime ID at /amplify/agentcore/{agentName}/runtimeId
 */
export class SingleAgentResource extends Construct {
  readonly runtime: bedrockagentcore.CfnRuntime;
  readonly devEndpoint: bedrockagentcore.CfnRuntimeEndpoint;
  readonly prodEndpoint: bedrockagentcore.CfnRuntimeEndpoint;
  readonly ssmParameter: ssm.StringParameter;
  readonly imageUri: string;

  constructor(scope: Construct, id: string, props: SingleAgentResourceProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);
    const region = stack.region;
    const accountId = stack.account;


    /*****************************
     * Docker Image for AgentCore Runtime
     *****************************/
    const dockerAsset = new ecr_assets.DockerImageAsset(this, `${props.agentName}-AppImage`, {
      directory: path.join(__dirname, props.agentFolderPath),
      platform: ecr_assets.Platform.LINUX_ARM64,
    });
    this.imageUri = dockerAsset.imageUri;

    /*****************************
     * AgentCore Runtime
     *****************************/
    const runtimePolicy = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          sid: 'ECRImageAccess',
          effect: iam.Effect.ALLOW,
          actions: ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'],
          resources: [`arn:aws:ecr:${region}:${accountId}:repository/*`],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['logs:DescribeLogStreams', 'logs:CreateLogGroup'],
          resources: [`arn:aws:logs:${region}:${accountId}:log-group:/aws/bedrock-agentcore/runtimes/*`],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['logs:DescribeLogGroups'],
          resources: [`arn:aws:logs:${region}:${accountId}:log-group:*`],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: [`arn:aws:logs:${region}:${accountId}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*`],
        }),
        new iam.PolicyStatement({
          sid: 'ECRTokenAccess',
          effect: iam.Effect.ALLOW,
          actions: ['ecr:GetAuthorizationToken'],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords', 'xray:GetSamplingRules', 'xray:GetSamplingTargets'],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['cloudwatch:PutMetricData'],
          resources: ['*'],
          conditions: { StringEquals: { 'cloudwatch:namespace': 'bedrock-agentcore' } },
        }),
        new iam.PolicyStatement({
          sid: 'GetAgentAccessToken',
          effect: iam.Effect.ALLOW,
          actions: [
            'bedrock-agentcore:GetWorkloadAccessToken',
            'bedrock-agentcore:GetWorkloadAccessTokenForJWT',
            'bedrock-agentcore:GetWorkloadAccessTokenForUserId',
          ],
          resources: [
            `arn:aws:bedrock-agentcore:${region}:${accountId}:workload-identity-directory/default`,
            `arn:aws:bedrock-agentcore:${region}:${accountId}:workload-identity-directory/default/workload-identity/agentName-*`,
          ],
        }),
        new iam.PolicyStatement({
          sid: 'BedrockModelInvocation',
          effect: iam.Effect.ALLOW,
          actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
          resources: [`arn:aws:bedrock:*::foundation-model/*`, `arn:aws:bedrock:${region}:${accountId}:*`],
        }),
        new iam.PolicyStatement({
          sid: 'CodeInterpreterAccess',
          effect: iam.Effect.ALLOW,
          actions: [
            'bedrock-agentcore:StartCodeInterpreterSession',
            'bedrock-agentcore:StopCodeInterpreterSession',
            'bedrock-agentcore:ExecuteCode',
            'bedrock-agentcore:InvokeCodeInterpreter',
          ],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          sid: 'MemoryAccess',
          effect: iam.Effect.ALLOW,
          actions: [
            'bedrock-agentcore:CreateEvent',
            'bedrock-agentcore:ListEvents',
            'bedrock-agentcore:GetMemory',
            'bedrock-agentcore:RetrieveMemory',
            'bedrock-agentcore:RetrieveMemoryRecords',
            'bedrock-agentcore:CreateMemoryRecord',
            'bedrock-agentcore:UpdateMemoryRecord',
            'bedrock-agentcore:DeleteMemoryRecord',
          ],
          resources: [
            `arn:aws:bedrock-agentcore:${region}:${accountId}:memory/*`,
          ],
        }),
      ],
    });

    const runtimeRole = new iam.Role(this, `${props.agentName}-RuntimeRole`, {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: `IAM role for Bedrock AgentCore Runtime - ${props.agentName}`,
      inlinePolicies: { RuntimeAccessPolicy: runtimePolicy },
    });


    // Create the runtime with agent name in the identifier
    this.runtime = new bedrockagentcore.CfnRuntime(this, `${props.agentName}-Runtime`, {
      agentRuntimeArtifact: {
        containerConfiguration: { containerUri: this.imageUri },
      },
      agentRuntimeName: `${props.appName}_${props.agentName}`,
      protocolConfiguration: 'HTTP',
      networkConfiguration: { networkMode: 'PUBLIC' },
      roleArn: runtimeRole.roleArn,
      environmentVariables: {
        AWS_REGION: region,
        GATEWAY_URL: props.gatewayConfig.gateway.attrGatewayUrl,
        BEDROCK_AGENTCORE_MEMORY_ID: props.memory.attrMemoryId,
        COGNITO_CLIENT_ID: props.gatewayConfig.cognitoClientId,
        COGNITO_CLIENT_SECRET: props.gatewayConfig.cognitoClientSecret,
        COGNITO_TOKEN_URL: props.gatewayConfig.cognitoTokenUrl,
        COGNITO_SCOPE: props.gatewayConfig.cognitoScope,
      },
    });

    /*****************************
     * Runtime Endpoints (DEV and PROD)
     *****************************/
    this.prodEndpoint = new bedrockagentcore.CfnRuntimeEndpoint(this, `${props.agentName}-ProdEndpoint`, {
      agentRuntimeId: this.runtime.attrAgentRuntimeId,
      agentRuntimeVersion: '1',
      name: 'PROD',
    });

    this.devEndpoint = new bedrockagentcore.CfnRuntimeEndpoint(this, `${props.agentName}-DevEndpoint`, {
      agentRuntimeId: this.runtime.attrAgentRuntimeId,
      agentRuntimeVersion: '1',
      name: 'DEV',
    });

    /*****************************
     * SSM Parameter for Runtime ID lookup
     *****************************/
    this.ssmParameter = new ssm.StringParameter(this, `${props.agentName}-RuntimeIdParam`, {
      parameterName: `/amplify/agentcore/${props.agentName}/runtimeId`,
      stringValue: this.runtime.attrAgentRuntimeId,
      description: `Runtime ID for agent: ${props.agentName}`,
    });

    /*****************************
     * Grant authenticated users permission to invoke this agent's runtime
     *****************************/
    new iam.Policy(this, `${props.agentName}-InvokePolicy`, {
      roles: [props.authenticatedRole],
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'bedrock-agentcore:InvokeAgent',
            'bedrock-agentcore:InvokeAgentWithResponseStream',
          ],
          resources: [this.runtime.attrAgentRuntimeArn],
        }),
      ],
    });

    /*****************************
     * Outputs
     *****************************/
    new cdk.CfnOutput(this, `${props.agentName}-RuntimeArn`, {
      value: this.runtime.attrAgentRuntimeArn,
      description: `AgentCore Runtime ARN for ${props.agentName}`,
    });

    new cdk.CfnOutput(this, `${props.agentName}-RuntimeId`, {
      value: this.runtime.attrAgentRuntimeId,
      description: `AgentCore Runtime ID for ${props.agentName}`,
    });
  }
}
