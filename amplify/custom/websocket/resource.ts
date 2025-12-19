import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface WebSocketApiProps {
  runtimeIdParamName: string;
}

export class WebSocketApiResource extends Construct {
  readonly webSocketApi: apigatewayv2.CfnApi;
  readonly webSocketStage: apigatewayv2.CfnStage;
  readonly webSocketUrl: string;
  readonly sendMessageFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: WebSocketApiProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);
    const region = stack.region;
    const accountId = stack.account;

    // Create WebSocket API
    this.webSocketApi = new apigatewayv2.CfnApi(this, 'WebSocketApi', {
      name: 'AgentCoreWebSocket',
      protocolType: 'WEBSOCKET',
      routeSelectionExpression: '$request.body.action',
    });

    // Lambda execution role
    const lambdaRole = new iam.Role(this, 'WebSocketLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Add permissions for SSM, AgentCore, and API Gateway Management
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${region}:${accountId}:parameter/amplify/agentcore/*`],
    }));

    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock-agentcore:InvokeAgentRuntime', 'bedrock-agentcore:InvokeAgent'],
      resources: ['*'],
    }));

    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: [`arn:aws:execute-api:${region}:${accountId}:${this.webSocketApi.ref}/*`],
    }));

    // Connect handler
    const connectFunction = new NodejsFunction(this, 'ConnectFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../functions/websocket/connect.ts'),
      handler: 'handler',
      role: lambdaRole,
      timeout: cdk.Duration.seconds(10),
    });

    // Disconnect handler
    const disconnectFunction = new NodejsFunction(this, 'DisconnectFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../functions/websocket/disconnect.ts'),
      handler: 'handler',
      role: lambdaRole,
      timeout: cdk.Duration.seconds(10),
    });

    // SendMessage handler - longer timeout for AgentCore calls
    this.sendMessageFunction = new NodejsFunction(this, 'SendMessageFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../functions/websocket/sendMessage.ts'),
      handler: 'handler',
      role: lambdaRole,
      timeout: cdk.Duration.minutes(5), // 5 min timeout for long agent responses
      memorySize: 512,
      environment: {
        AGENT_RUNTIME_ID_PARAM: props.runtimeIdParamName,
        AWS_ACCOUNT_ID: accountId,
      },
      bundling: {
        // Include apigatewaymanagementapi, exclude other AWS SDK modules (provided by Lambda runtime)
        externalModules: [
          '@aws-sdk/client-ssm',
          '@aws-sdk/credential-provider-node',
        ],
        minify: false,
      },
    });

    // Create integrations
    const connectIntegration = new apigatewayv2.CfnIntegration(this, 'ConnectIntegration', {
      apiId: this.webSocketApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${connectFunction.functionArn}/invocations`,
    });

    const disconnectIntegration = new apigatewayv2.CfnIntegration(this, 'DisconnectIntegration', {
      apiId: this.webSocketApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${disconnectFunction.functionArn}/invocations`,
    });

    const sendMessageIntegration = new apigatewayv2.CfnIntegration(this, 'SendMessageIntegration', {
      apiId: this.webSocketApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${this.sendMessageFunction.functionArn}/invocations`,
    });

    // Create routes
    const connectRoute = new apigatewayv2.CfnRoute(this, 'ConnectRoute', {
      apiId: this.webSocketApi.ref,
      routeKey: '$connect',
      authorizationType: 'NONE',
      target: `integrations/${connectIntegration.ref}`,
    });

    const disconnectRoute = new apigatewayv2.CfnRoute(this, 'DisconnectRoute', {
      apiId: this.webSocketApi.ref,
      routeKey: '$disconnect',
      target: `integrations/${disconnectIntegration.ref}`,
    });

    const sendMessageRoute = new apigatewayv2.CfnRoute(this, 'SendMessageRoute', {
      apiId: this.webSocketApi.ref,
      routeKey: 'sendMessage',
      target: `integrations/${sendMessageIntegration.ref}`,
    });

    // Default route for any other action
    const defaultRoute = new apigatewayv2.CfnRoute(this, 'DefaultRoute', {
      apiId: this.webSocketApi.ref,
      routeKey: '$default',
      target: `integrations/${sendMessageIntegration.ref}`,
    });

    // Grant Lambda invoke permissions to API Gateway
    connectFunction.addPermission('ApiGatewayInvoke', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${region}:${accountId}:${this.webSocketApi.ref}/*`,
    });

    disconnectFunction.addPermission('ApiGatewayInvoke', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${region}:${accountId}:${this.webSocketApi.ref}/*`,
    });

    this.sendMessageFunction.addPermission('ApiGatewayInvoke', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${region}:${accountId}:${this.webSocketApi.ref}/*`,
    });

    // Create deployment
    const deployment = new apigatewayv2.CfnDeployment(this, 'WebSocketDeployment', {
      apiId: this.webSocketApi.ref,
    });

    // Ensure deployment happens after routes
    deployment.addDependency(connectRoute);
    deployment.addDependency(disconnectRoute);
    deployment.addDependency(sendMessageRoute);
    deployment.addDependency(defaultRoute);

    // Create stage
    this.webSocketStage = new apigatewayv2.CfnStage(this, 'WebSocketStage', {
      apiId: this.webSocketApi.ref,
      stageName: 'prod',
      deploymentId: deployment.ref,
      defaultRouteSettings: {
        throttlingBurstLimit: 500,
        throttlingRateLimit: 1000,
      },
    });

    // WebSocket URL
    this.webSocketUrl = `wss://${this.webSocketApi.ref}.execute-api.${region}.amazonaws.com/prod`;

    // Outputs
    new cdk.CfnOutput(this, 'WebSocketApiUrl', {
      value: this.webSocketUrl,
      description: 'WebSocket API URL for agent chat',
    });
  }
}
