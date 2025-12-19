import * as cdk from 'aws-cdk-lib';
import * as bedrockagentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import { Construct } from 'constructs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AgentCoreResourceProps {
  appName: string;
  userPool: cognito.IUserPool;
  authenticatedRole: iam.IRole;
}

export class AgentCoreResource extends Construct {
  readonly agentCoreRuntime: bedrockagentcore.CfnRuntime;
  readonly agentCoreGateway: bedrockagentcore.CfnGateway;
  readonly agentCoreMemory: bedrockagentcore.CfnMemory;
  readonly mcpLambda: lambda.Function;
  readonly imageUri: string;

  constructor(scope: Construct, id: string, props: AgentCoreResourceProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);
    const region = stack.region;
    const accountId = stack.account;

    /*****************************
     * Docker Image for AgentCore Runtime
     *****************************/
    const dockerAsset = new ecr_assets.DockerImageAsset(this, `${props.appName}-AppImage`, {
      directory: path.join(__dirname, '../agents/neoAmber'), // path to neoAmber project
      platform: ecr_assets.Platform.LINUX_ARM64,
    });
    this.imageUri = dockerAsset.imageUri;

    /*****************************
     * AgentCore Gateway
     *****************************/
    this.mcpLambda = new lambda.Function(this, `${props.appName}-McpLambda`, {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../agents/neoAmber/mcp/lambda')),
    });

    const agentCoreGatewayRole = new iam.Role(this, `${props.appName}-AgentCoreGatewayRole`, {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: 'IAM role for Bedrock AgentCore Gateway',
    });

    this.mcpLambda.grantInvoke(agentCoreGatewayRole);

    // Create Cognito resources for gateway auth
    const cognitoResourceServerScope = {
      scopeName: 'basic',
      scopeDescription: `Basic access to ${props.appName}`,
    };

    const cognitoResourceServer = (props.userPool as cognito.UserPool).addResourceServer(
      `${props.appName}-CognitoResourceServer`,
      {
        identifier: `${props.appName}-CognitoResourceServer`,
        scopes: [cognitoResourceServerScope],
      }
    );

    const cognitoAppClient = new cognito.UserPoolClient(this, `${props.appName}-AgentCoreClient`, {
      userPool: props.userPool,
      generateSecret: true,
      oAuth: {
        flows: { clientCredentials: true },
        scopes: [cognito.OAuthScope.resourceServer(cognitoResourceServer, cognitoResourceServerScope)],
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
    });

    const cognitoDomain = (props.userPool as cognito.UserPool).addDomain(`${props.appName}-CognitoDomain`, {
      cognitoDomain: {
        domainPrefix: `${props.appName.toLowerCase()}-${region}`,
      },
    });
    const cognitoTokenUrl = cognitoDomain.baseUrl() + '/oauth2/token';

    this.agentCoreGateway = new bedrockagentcore.CfnGateway(this, `${props.appName}-AgentCoreGateway`, {
      name: `${props.appName}-Gateway`,
      protocolType: 'MCP',
      roleArn: agentCoreGatewayRole.roleArn,
      authorizerType: 'CUSTOM_JWT',
      authorizerConfiguration: {
        customJwtAuthorizer: {
          discoveryUrl: `https://cognito-idp.${region}.amazonaws.com/${props.userPool.userPoolId}/.well-known/openid-configuration`,
          allowedClients: [cognitoAppClient.userPoolClientId],
        },
      },
    });

    new bedrockagentcore.CfnGatewayTarget(this, `${props.appName}-AgentCoreGatewayTarget`, {
      name: `${props.appName}-Target`,
      gatewayIdentifier: this.agentCoreGateway.attrGatewayIdentifier,
      credentialProviderConfigurations: [{ credentialProviderType: 'GATEWAY_IAM_ROLE' }],
      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: this.mcpLambda.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'placeholder_tool',
                  description: 'No-op tool that demonstrates passing arguments',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      string_param: { type: 'string', description: 'Example string parameter' },
                      int_param: { type: 'integer', description: 'Example integer parameter' },
                    },
                    required: [],
                  },
                },
              ],
            },
          },
        },
      },
    });

    /*****************************
     * AgentCore Memory
     *****************************/
    this.agentCoreMemory = new bedrockagentcore.CfnMemory(this, `${props.appName}-AgentCoreMemory`, {
      name: `${props.appName}_Memory`,
      eventExpiryDuration: 30,
      description: 'Memory resource for conversation persistence',
      memoryStrategies: [
        {
          semanticMemoryStrategy: {
            name: 'FactExtractor',
            namespaces: ['/{actorId}/facts'],
          },
        },
        {
          userPreferenceMemoryStrategy: {
            name: 'PreferenceLearner',
            namespaces: ['/{actorId}/preferences'],
          },
        },
        {
          summaryMemoryStrategy: {
            name: 'SessionSummarizer',
            namespaces: ['/{actorId}/{sessionId}/summaries'],
          },
        },
      ],
    });

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

    const runtimeRole = new iam.Role(this, `${props.appName}-AgentCoreRuntimeRole`, {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: 'IAM role for Bedrock AgentCore Runtime',
      inlinePolicies: { RuntimeAccessPolicy: runtimePolicy },
    });

    this.agentCoreRuntime = new bedrockagentcore.CfnRuntime(this, `${props.appName}-AgentCoreRuntime`, {
      agentRuntimeArtifact: {
        containerConfiguration: { containerUri: this.imageUri },
      },
      agentRuntimeName: `${props.appName}_Agent`,
      protocolConfiguration: 'HTTP',
      networkConfiguration: { networkMode: 'PUBLIC' },
      roleArn: runtimeRole.roleArn,
      environmentVariables: {
        AWS_REGION: region,
        GATEWAY_URL: this.agentCoreGateway.attrGatewayUrl,
        BEDROCK_AGENTCORE_MEMORY_ID: this.agentCoreMemory.attrMemoryId,
        COGNITO_CLIENT_ID: cognitoAppClient.userPoolClientId,
        COGNITO_CLIENT_SECRET: cognitoAppClient.userPoolClientSecret.unsafeUnwrap(),
        COGNITO_TOKEN_URL: cognitoTokenUrl,
        COGNITO_SCOPE: `${cognitoResourceServer.userPoolResourceServerId}/${cognitoResourceServerScope.scopeName}`,
      },
    });

    // Create versioned endpoints
    new bedrockagentcore.CfnRuntimeEndpoint(this, `${props.appName}-ProdEndpoint`, {
      agentRuntimeId: this.agentCoreRuntime.attrAgentRuntimeId,
      agentRuntimeVersion: '1',
      name: 'PROD',
    });

    new bedrockagentcore.CfnRuntimeEndpoint(this, `${props.appName}-DevEndpoint`, {
      agentRuntimeId: this.agentCoreRuntime.attrAgentRuntimeId,
      agentRuntimeVersion: '1',
      name: 'DEV',
    });

    // Grant authenticated users permission to invoke the AgentCore runtime
    // Done here to avoid circular dependency between auth and AgentCoreStack
    new iam.Policy(this, `${props.appName}-InvokeAgentPolicy`, {
      roles: [props.authenticatedRole],
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'bedrock-agentcore:InvokeAgent',
            'bedrock-agentcore:InvokeAgentWithResponseStream',
          ],
          resources: [this.agentCoreRuntime.attrAgentRuntimeArn],
        }),
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, 'AgentRuntimeArn', {
      value: this.agentCoreRuntime.attrAgentRuntimeArn,
      description: 'AgentCore Runtime ARN',
    });

    new cdk.CfnOutput(this, 'AgentRuntimeId', {
      value: this.agentCoreRuntime.attrAgentRuntimeId,
      description: 'AgentCore Runtime ID for SDK invocation',
    });

    new cdk.CfnOutput(this, 'GatewayUrl', {
      value: this.agentCoreGateway.attrGatewayUrl,
      description: 'AgentCore Gateway URL',
    });

    new cdk.CfnOutput(this, 'MemoryId', {
      value: this.agentCoreMemory.attrMemoryId,
      description: 'AgentCore Memory ID',
    });
  }
}
