# neoAmber Agent

A Strands-based AI agent deployed as part of the Amplify application via Amazon Bedrock AgentCore.

## Structure

```
├── src/
│   ├── main.py              # Agent entrypoint with Strands SDK
│   ├── mcp_client/          # MCP gateway client
│   └── model/               # Model configuration
├── mcp/
│   └── lambda/              # MCP Lambda tool handler
├── test/                    # Unit tests
├── Dockerfile               # Container image for AgentCore Runtime
└── pyproject.toml           # Python dependencies (managed by uv)
```

## Local Development

```bash
# Install dependencies
uv sync

# Run tests
uv run pytest
```

## Customization

- **Agent behavior**: Edit `src/main.py`
- **MCP tools**: Add tools in `mcp/lambda/handler.py` and update the tool schema in `../agentcore/resource.ts`
- **Model**: Configure in `src/model/load.py`

## Deployment

This agent is deployed automatically when running `npx ampx sandbox` from the project root. The Amplify CDK construct in `amplify/custom/agentcore/resource.ts` handles:

- Building the Docker image
- Creating the AgentCore Runtime
- Setting up the MCP Gateway
- Configuring AgentCore Memory
