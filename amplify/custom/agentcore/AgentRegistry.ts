/**
 * AgentRegistry - CDK Construct for managing multiple AgentCore agents
 * 
 * This construct creates and manages multiple agents based on configuration,
 * supporting both shared and dedicated gateway/memory resources.
 */

import * as cdk from 'aws-cdk-lib';
import * as bedrockagentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { AgentRegistryConfig } from './agents.config';
import { SingleAgentResource, GatewayConfig } from './SingleAgentResource';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resources created for a single agent
 */
export interface AgentResources {
  runtime: bedrockagentcore.CfnRuntime;
  devEndpoint: bedrockagentcore.CfnRuntimeEndpoint;
  prodEndpoint: bedrockagentcore.CfnRuntimeEndpoint;
  ssmParameter: ssm.StringParameter;
  gateway?: bedrockagentcore.CfnGateway;    // Only if dedicated
  memory?: bedrockagentcore.CfnMemory;      // Only if dedicated
}

/**
 * Props for creating an AgentRegistry
 */
export interface AgentRegistryProps {
  /** Application name prefix for resource naming */
  appName: string;
  /** Cognito user pool for authentication */
  userPool: cognito.IUserPool;
  /** IAM role for authenticated users */
  authenticatedRole: iam.IRole;
  /** Agent registry configuration */
  config: AgentRegistryConfig;
}

/**
 * Gateway resources created by the registry
 */
interface GatewayResources {
  gateway: bedrockagentcore.CfnGateway;
  mcpLambda: lambda.Function;
  cognitoClientId: string;
  cognitoClientSecret: string;
  cognitoTokenUrl: string;
  cognitoScope: string;
}


/**
 * CDK Construct that creates and manages multiple AgentCore agents.
 * 
 * Creates:
 * - Shared or dedicated gateway resources based on config
 * - Shared or dedicated memory resources based on config
 * - SingleAgentResource for each agent in the configuration
 * - SSM parameter for default agent name
 */
export class AgentRegistry extends Construct {
  /** Map of agent name to agent resources */
  readonly agents: Map<string, AgentResources>;
  /** Shared gateway (only if sharedGateway=true) */
  readonly sharedGateway?: bedrockagentcore.CfnGateway;
  /** Shared memory (only if sharedMemory=true) */
  readonly sharedMemory?: bedrockagentcore.CfnMemory;
  /** MCP Lambda function (shared or first agent's) */
  readonly mcpLambda: lambda.Function;
  /** Default agent name */
  readonly defaultAgentName: string;

  constructor(scope: Construct, id: string, props: AgentRegistryProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);
    const region = stack.region;

    this.agents = new Map<string, AgentResources>();

    // Determine default agent
    const defaultAgent = props.config.agents.find(a => a.isDefault) || props.config.agents[0];
    this.defaultAgentName = defaultAgent.name;

    // Create shared or dedicated gateway resources
    let sharedGatewayResources: GatewayResources | undefined;
    if (props.config.sharedGateway) {
      sharedGatewayResources = this.createGatewayResources(
        props.appName,
        'Shared',
        props.userPool,
        region
      );
      this.sharedGateway = sharedGatewayResources.gateway;
    }

    // Create shared memory if configured
    if (props.config.sharedMemory) {
      this.sharedMemory = this.createMemory(props.appName, 'Shared');
    }

    // Create resources for each agent
    for (const agentDef of props.config.agents) {
      let gatewayConfig: GatewayConfig;
      let memory: bedrockagentcore.CfnMemory;
      let dedicatedGateway: bedrockagentcore.CfnGateway | undefined;
      let dedicatedMemory: bedrockagentcore.CfnMemory | undefined;

      // Use shared or create dedicated gateway
      if (props.config.sharedGateway && sharedGatewayResources) {
        gatewayConfig = {
          gateway: sharedGatewayResources.gateway,
          cognitoClientId: sharedGatewayResources.cognitoClientId,
          cognitoClientSecret: sharedGatewayResources.cognitoClientSecret,
          cognitoTokenUrl: sharedGatewayResources.cognitoTokenUrl,
          cognitoScope: sharedGatewayResources.cognitoScope,
        };
      } else {
        const dedicatedGatewayResources = this.createGatewayResources(
          props.appName,
          agentDef.name,
          props.userPool,
          region
        );
        dedicatedGateway = dedicatedGatewayResources.gateway;
        gatewayConfig = {
          gateway: dedicatedGatewayResources.gateway,
          cognitoClientId: dedicatedGatewayResources.cognitoClientId,
          cognitoClientSecret: dedicatedGatewayResources.cognitoClientSecret,
          cognitoTokenUrl: dedicatedGatewayResources.cognitoTokenUrl,
          cognitoScope: dedicatedGatewayResources.cognitoScope,
        };
      }

      // Use shared or create dedicated memory
      if (props.config.sharedMemory && this.sharedMemory) {
        memory = this.sharedMemory;
      } else {
        dedicatedMemory = this.createMemory(props.appName, agentDef.name);
        memory = dedicatedMemory;
      }

      // Create the agent resource
      const agentResource = new SingleAgentResource(this, `Agent-${agentDef.name}`, {
        agentName: agentDef.name,
        agentFolderPath: agentDef.folderPath,
        appName: props.appName,
        gatewayConfig,
        memory,
        userPool: props.userPool,
        authenticatedRole: props.authenticatedRole,
      });

      // Store agent resources
      this.agents.set(agentDef.name, {
        runtime: agentResource.runtime,
        devEndpoint: agentResource.devEndpoint,
        prodEndpoint: agentResource.prodEndpoint,
        ssmParameter: agentResource.ssmParameter,
        gateway: dedicatedGateway,
        memory: dedicatedMemory,
      });
    }

    // Store MCP Lambda reference (use shared or first agent's)
    if (sharedGatewayResources) {
      this.mcpLambda = sharedGatewayResources.mcpLambda;
    } else {
      // For dedicated gateways, we need to track the first one
      // This is handled in createGatewayResources
      this.mcpLambda = this.createMcpLambda(props.appName, 'Primary');
    }

    // Create SSM parameter for default agent
    new ssm.StringParameter(this, 'DefaultAgentParam', {
      parameterName: '/amplify/agentcore/defaultAgent',
      stringValue: this.defaultAgentName,
      description: 'Name of the default agent',
    });

    // Outputs
    new cdk.CfnOutput(this, 'DefaultAgent', {
      value: this.defaultAgentName,
      description: 'Default agent name',
    });

    new cdk.CfnOutput(this, 'AgentCount', {
      value: String(props.config.agents.length),
      description: 'Number of deployed agents',
    });
  }


  /**
   * Creates gateway resources including MCP Lambda, Cognito client, and gateway
   */
  private createGatewayResources(
    appName: string,
    identifier: string,
    userPool: cognito.IUserPool,
    region: string
  ): GatewayResources {
    // Create MCP Lambda
    const mcpLambda = this.createMcpLambda(appName, identifier);

    // Create gateway role
    const gatewayRole = new iam.Role(this, `${identifier}-GatewayRole`, {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: `IAM role for Bedrock AgentCore Gateway - ${identifier}`,
    });
    mcpLambda.grantInvoke(gatewayRole);

    // Create Cognito resources for gateway auth
    const cognitoResourceServerScope = {
      scopeName: 'basic',
      scopeDescription: `Basic access to ${appName} - ${identifier}`,
    };

    const cognitoResourceServer = (userPool as cognito.UserPool).addResourceServer(
      `${identifier}-ResourceServer`,
      {
        identifier: `${appName}-${identifier}-ResourceServer`,
        scopes: [cognitoResourceServerScope],
      }
    );

    const cognitoAppClient = new cognito.UserPoolClient(this, `${identifier}-AppClient`, {
      userPool: userPool,
      generateSecret: true,
      oAuth: {
        flows: { clientCredentials: true },
        scopes: [cognito.OAuthScope.resourceServer(cognitoResourceServer, cognitoResourceServerScope)],
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
    });

    const cognitoDomain = (userPool as cognito.UserPool).addDomain(`${identifier}-Domain`, {
      cognitoDomain: {
        domainPrefix: `${appName.toLowerCase()}-${identifier.toLowerCase()}-${region}`,
      },
    });
    const cognitoTokenUrl = cognitoDomain.baseUrl() + '/oauth2/token';

    // Create gateway
    const gateway = new bedrockagentcore.CfnGateway(this, `${identifier}-Gateway`, {
      name: `${appName}-${identifier}-Gateway`,
      protocolType: 'MCP',
      roleArn: gatewayRole.roleArn,
      authorizerType: 'CUSTOM_JWT',
      authorizerConfiguration: {
        customJwtAuthorizer: {
          discoveryUrl: `https://cognito-idp.${region}.amazonaws.com/${userPool.userPoolId}/.well-known/openid-configuration`,
          allowedClients: [cognitoAppClient.userPoolClientId],
        },
      },
    });

    // Create gateway target
    new bedrockagentcore.CfnGatewayTarget(this, `${identifier}-GatewayTarget`, {
      name: `${appName}-${identifier}-Target`,
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      credentialProviderConfigurations: [{ credentialProviderType: 'GATEWAY_IAM_ROLE' }],
      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: mcpLambda.functionArn,
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

    return {
      gateway,
      mcpLambda,
      cognitoClientId: cognitoAppClient.userPoolClientId,
      cognitoClientSecret: cognitoAppClient.userPoolClientSecret.unsafeUnwrap(),
      cognitoTokenUrl,
      cognitoScope: `${cognitoResourceServer.userPoolResourceServerId}/${cognitoResourceServerScope.scopeName}`,
    };
  }

  /**
   * Creates an MCP Lambda function
   */
  private createMcpLambda(appName: string, identifier: string): lambda.Function {
    return new lambda.Function(this, `${identifier}-McpLambda`, {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../agents/neoAmber/mcp/lambda')),
      functionName: `${appName}-${identifier}-McpLambda`,
    });
  }

  /**
   * Creates an AgentCore Memory resource
   */
  private createMemory(appName: string, identifier: string): bedrockagentcore.CfnMemory {
    return new bedrockagentcore.CfnMemory(this, `${identifier}-Memory`, {
      name: `${appName}_${identifier}_Memory`,
      eventExpiryDuration: 30,
      description: `Memory resource for ${identifier}`,
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
  }

  /**
   * Gets agent resources by name
   */
  getAgent(name: string): AgentResources | undefined {
    return this.agents.get(name);
  }

  /**
   * Gets the default agent resources
   */
  getDefaultAgent(): AgentResources {
    const agent = this.agents.get(this.defaultAgentName);
    if (!agent) {
      throw new Error(`Default agent '${this.defaultAgentName}' not found`);
    }
    return agent;
  }

  /**
   * Gets all agent names
   */
  getAgentNames(): string[] {
    return Array.from(this.agents.keys());
  }
}
