# AgentCore Chat Application

A full-stack AI chat application built with AWS Amplify and Amazon Bedrock AgentCore. Features real-time streaming responses via WebSocket, conversation memory, and MCP (Model Context Protocol) gateway integration.

## Architecture

- **Frontend**: React + Vite with real-time WebSocket chat interface
- **Backend**: AWS Amplify Gen 2 with custom CDK constructs
- **AI Runtime**: Amazon Bedrock AgentCore with Strands Agent SDK
- **Auth**: Amazon Cognito for user authentication
- **Streaming**: WebSocket API Gateway for real-time responses
- **Memory**: AgentCore Memory for conversation persistence

## Prerequisites

- Node.js 18+
- Python 3.12+
- AWS CLI configured with appropriate credentials
- [uv](https://docs.astral.sh/uv/) (Python package manager)

## Quick Start

1. **Install dependencies**
   ```bash
   npm install
   cd amplify && npm install && cd ..
   ```

2. **Deploy to AWS sandbox**
   ```bash
   npx ampx sandbox
   ```

3. **Start the development server**
   ```bash
   npm run dev
   ```

## Project Structure

```
├── amplify/
│   ├── auth/                    # Cognito authentication
│   ├── data/                    # GraphQL API schema
│   ├── functions/               # Lambda functions
│   │   ├── invokeAgent/         # GraphQL resolver for agent
│   │   └── websocket/           # WebSocket handlers
│   ├── custom/
│   │   ├── agentcore/           # AgentCore CDK construct
│   │   ├── agents/neoAmber/     # Strands agent implementation
│   │   └── websocket/           # WebSocket API CDK construct
│   └── backend.ts               # Main backend definition
├── src/
│   ├── components/
│   │   ├── AgentChat.tsx        # Chat interface component
│   │   └── MessageContent.tsx   # Message rendering
│   └── App.tsx                  # Main application
└── package.json
```

## Agent Configuration

The agent is located in `amplify/custom/agents/neoAmber/` and uses the Strands Agent SDK. To customize:

1. Edit `src/main.py` to modify agent behavior
2. Add MCP tools in `mcp/lambda/handler.py`
3. Update `pyproject.toml` for Python dependencies

## Environment Variables

Copy `.env.example` to `.env` for local development. Lambda functions receive environment variables automatically from CDK during deployment.

## Deployment

### Sandbox (Development)
```bash
npx ampx sandbox
```

### Production
Deploy via AWS Amplify Console or:
```bash
npx ampx pipeline-deploy --branch main
```

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.
