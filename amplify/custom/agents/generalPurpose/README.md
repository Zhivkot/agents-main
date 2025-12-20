# General Purpose Agent

A versatile AI assistant deployed via Amazon Bedrock AgentCore, designed to handle a wide range of tasks including research, analysis, writing, problem-solving, and general knowledge queries.

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
- **MCP tools**: Add tools in `mcp/lambda/handler.py` and update the tool schema in `../../agentcore/resource.ts`
- **Model**: Configure in `src/model/load.py`

## Deployment

This agent is deployed automatically when running `npx ampx sandbox` from the project root. The Amplify CDK construct handles building the Docker image and creating all AgentCore resources.
