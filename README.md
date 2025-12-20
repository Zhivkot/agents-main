# AgentCore Chat Application

A full-stack AI chat application built with AWS Amplify and Amazon Bedrock AgentCore. Features real-time streaming responses via WebSocket, conversation memory, MCP (Model Context Protocol) gateway integration, and support for multiple AI agents.

## Architecture

- **Frontend**: React + Vite with real-time WebSocket chat interface
- **Backend**: AWS Amplify Gen 2 with custom CDK constructs
- **AI Runtime**: Amazon Bedrock AgentCore with Strands Agent SDK
- **Auth**: Amazon Cognito for user authentication
- **Streaming**: WebSocket API Gateway for real-time responses
- **Memory**: AgentCore Memory for conversation persistence
- **Multi-Agent**: Registry-based agent management with shared or dedicated resources

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
│   │   ├── agentcore/           # AgentCore CDK constructs
│   │   │   ├── agents.config.ts # Multi-agent configuration
│   │   │   ├── AgentRegistry.ts # Registry that manages all agents
│   │   │   ├── SingleAgentResource.ts # Per-agent CDK resource
│   │   │   └── configValidator.ts # Configuration validation
│   │   ├── agents/              # Agent implementations
│   │   │   └── neoAmber/        # Default Strands agent
│   │   └── websocket/           # WebSocket API CDK construct
│   └── backend.ts               # Main backend definition
├── src/
│   ├── components/
│   │   ├── AgentChat.tsx        # Chat interface with agent selector
│   │   └── MessageContent.tsx   # Message rendering
│   └── App.tsx                  # Main application
└── package.json
```

## Multi-Agent Support

This application supports deploying and invoking multiple AI agents. Each agent runs in its own AgentCore Runtime with independent endpoints, while optionally sharing Gateway and Memory resources.

### Agent Configuration

Agents are configured in `amplify/custom/agentcore/agents.config.ts`:

```typescript
export const agentConfig: AgentRegistryConfig = {
  agents: [
    {
      name: 'neoAmber',
      folderPath: '../agents/neoAmber',
      description: 'React development assistant',
      isDefault: true,
    },
    // Add more agents here
  ],
  sharedGateway: true,   // All agents share one MCP gateway
  sharedMemory: true,    // All agents share conversation memory
};
```

### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `agents` | `AgentDefinition[]` | List of agent definitions (at least one required) |
| `sharedGateway` | `boolean` | `true` = single gateway for all agents, `false` = per-agent gateway |
| `sharedMemory` | `boolean` | `true` = single memory for all agents, `false` = per-agent memory |

### Agent Definition Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | `string` | Yes | Unique identifier (alphanumeric + hyphens, 1-64 chars) |
| `folderPath` | `string` | Yes | Relative path to agent folder from config directory |
| `description` | `string` | No | Human-readable description (max 256 chars) |
| `isDefault` | `boolean` | No | Whether this is the default agent (only one allowed) |

### Adding a New Agent

Follow these steps to add a new agent to your application:

**Step 1: Create the agent folder**

Copy an existing agent as a starting point:

```bash
cp -r amplify/custom/agents/neoAmber amplify/custom/agents/myNewAgent
```

**Step 2: Customize the agent**

Edit the following files in your new agent folder:

- `src/main.py` - Main agent logic and system prompt
- `mcp/lambda/handler.py` - MCP tools available to the agent
- `pyproject.toml` - Python dependencies and project metadata
- `README.md` - Agent documentation

**Step 3: Register the agent**

Add your agent to `amplify/custom/agentcore/agents.config.ts`:

```typescript
export const agentConfig: AgentRegistryConfig = {
  agents: [
    {
      name: 'neoAmber',
      folderPath: '../agents/neoAmber',
      description: 'React development assistant',
      isDefault: true,
    },
    {
      name: 'myNewAgent',
      folderPath: '../agents/myNewAgent',
      description: 'My custom AI assistant',
      isDefault: false,
    },
  ],
  sharedGateway: true,
  sharedMemory: true,
};
```

**Step 4: Deploy**

```bash
npx ampx sandbox
```

The new agent will be automatically deployed with its own runtime and endpoints.

### Required Agent Files

Each agent folder must contain:

| File | Description |
|------|-------------|
| `Dockerfile` | Container build instructions for AgentCore Runtime |
| `src/main.py` | Main entry point with agent logic |

Optional but recommended:

| File | Description |
|------|-------------|
| `pyproject.toml` | Python project configuration and dependencies |
| `mcp/lambda/handler.py` | MCP tools Lambda handler |
| `README.md` | Agent-specific documentation |

### Shared vs Dedicated Resources

**Shared Resources (Recommended for most cases)**
- Lower cost - single Gateway and Memory resource
- Simpler management
- All agents share the same MCP tools and conversation memory

```typescript
sharedGateway: true,
sharedMemory: true,
```

**Dedicated Resources**
- Agent isolation - each agent has its own Gateway and Memory
- Different MCP tools per agent
- Separate conversation histories
- Higher cost (N resources instead of 1)

```typescript
sharedGateway: false,
sharedMemory: false,
```

### Example: Creating a Code Review Agent

Here's a complete example of adding a second agent for code review:

**1. Create the agent folder:**

```bash
cp -r amplify/custom/agents/neoAmber amplify/custom/agents/codeReviewer
```

**2. Update `amplify/custom/agents/codeReviewer/src/main.py`:**

```python
from strands import Agent
from strands.models import BedrockModel

SYSTEM_PROMPT = """You are an expert code reviewer. Your role is to:
- Review code for bugs, security issues, and best practices
- Suggest improvements and optimizations
- Explain your reasoning clearly
- Be constructive and helpful in your feedback
"""

def main():
    model = BedrockModel(model_id="anthropic.claude-sonnet-4-20250514-v1:0")
    agent = Agent(model=model, system_prompt=SYSTEM_PROMPT)
    return agent

if __name__ == "__main__":
    main()
```

**3. Update `amplify/custom/agentcore/agents.config.ts`:**

```typescript
export const agentConfig: AgentRegistryConfig = {
  agents: [
    {
      name: 'neoAmber',
      folderPath: '../agents/neoAmber',
      description: 'React development assistant',
      isDefault: true,
    },
    {
      name: 'codeReviewer',
      folderPath: '../agents/codeReviewer',
      description: 'Expert code review assistant',
      isDefault: false,
    },
  ],
  sharedGateway: true,
  sharedMemory: true,
};
```

**4. Deploy and test:**

```bash
npx ampx sandbox
npm run dev
```

The frontend will automatically show an agent selector with both agents available.

### SSM Parameter Structure

Agent runtime IDs are stored in SSM Parameters for runtime lookup:

```
/amplify/agentcore/
├── neoAmber/
│   └── runtimeId          # Runtime ID for neoAmber
├── codeReviewer/
│   └── runtimeId          # Runtime ID for codeReviewer
└── defaultAgent           # Name of default agent
```

### Troubleshooting

**Configuration validation errors**

The system validates your configuration during CDK synthesis. Common errors:

- `Agent name contains invalid characters` - Use only alphanumeric characters and hyphens
- `Agent folder does not exist` - Check the `folderPath` is correct relative to the config file
- `Missing required files` - Ensure `Dockerfile` and `src/main.py` exist in the agent folder
- `Duplicate agent name` - Each agent must have a unique name
- `Multiple agents marked as default` - Only one agent can have `isDefault: true`

**Agent not appearing in frontend**

1. Check `amplify_outputs.json` contains your agent in the `custom.agents` section
2. Verify the deployment completed successfully
3. Restart the development server

## Environment Variables

Copy `.env.example` to `.env` for local development. Lambda functions receive environment variables automatically from CDK during deployment.

## Deployment

### Sandbox 
```bash
npx ampx sandbox
```


