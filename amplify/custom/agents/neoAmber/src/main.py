import os
from strands import Agent, tool
from strands_tools.code_interpreter import AgentCoreCodeInterpreter
from bedrock_agentcore import BedrockAgentCoreApp
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig, RetrievalConfig
from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager
from .mcp_client.client import get_streamable_http_mcp_client
from .model.load import load_model

MEMORY_ID = os.getenv("BEDROCK_AGENTCORE_MEMORY_ID")
REGION = os.getenv("AWS_REGION")
#
if os.getenv("LOCAL_DEV") == "1":
    # In local dev, instantiate dummy MCP client so the code runs without deploying
    from contextlib import nullcontext
    from types import SimpleNamespace
    strands_mcp_client = nullcontext(SimpleNamespace(list_tools_sync=lambda: []))
else:
    # Import AgentCore Gateway as Streamable HTTP MCP Client
    strands_mcp_client = get_streamable_http_mcp_client()

# Define React developer tools
@tool
def generate_component(
    name: str,
    props: list = None,
    styling: str = "none",
    with_ref: bool = False,
    children: bool = False
) -> str:
    """Generate a production-ready React component with TypeScript.
    
    Args:
        name: Component name in PascalCase
        props: List of prop definitions, each with keys: name, type, required (bool), default (optional)
        styling: One of "tailwind", "css-modules", or "none"
        with_ref: Whether to wrap component with forwardRef
        children: Whether component accepts children prop
    
    Returns:
        Complete TypeScript component code as string
    """
    if props is None:
        props = []
    
    # Build imports
    imports = []
    react_imports = ["React"]
    if with_ref:
        react_imports.append("forwardRef")
    imports.append(f"import {{ {', '.join(react_imports)} }} from 'react';")
    
    if styling == "css-modules":
        imports.append(f"import styles from './{name}.module.css';")
    
    # Build TypeScript interface for props
    interface_lines = []
    for prop in props:
        prop_name = prop.get("name", "")
        prop_type = prop.get("type", "string")
        required = prop.get("required", True)
        optional_marker = "" if required else "?"
        interface_lines.append(f"  {prop_name}{optional_marker}: {prop_type};")
    
    # Add className prop for Tailwind
    if styling == "tailwind":
        interface_lines.append("  className?: string;")
    
    # Add children prop if enabled
    if children:
        interface_lines.append("  children?: React.ReactNode;")
    
    interface_content = "\n".join(interface_lines) if interface_lines else "  // Add props here"
    
    # Build props destructuring
    destructured_props = []
    for prop in props:
        prop_name = prop.get("name", "")
        default_val = prop.get("default")
        if default_val is not None:
            destructured_props.append(f"{prop_name} = {default_val}")
        else:
            destructured_props.append(prop_name)
    
    if styling == "tailwind":
        destructured_props.append("className")
    if children:
        destructured_props.append("children")
    
    props_str = ", ".join(destructured_props) if destructured_props else ""
    
    # Build className attribute
    if styling == "tailwind":
        class_attr = 'className={className}'
    elif styling == "css-modules":
        class_attr = f'className={{styles.{name[0].lower() + name[1:]}}}'
    else:
        class_attr = f'className="{name[0].lower() + name[1:]}"'
    
    # Build component body
    children_jsx = "{children}" if children else "{/* Content */}"
    
    # Generate component based on with_ref flag
    if with_ref:
        ref_type = "HTMLDivElement"
        component_code = f'''const {name} = forwardRef<{ref_type}, {name}Props>(
  ({{ {props_str} }}, ref) => {{
    return (
      <div ref={{ref}} {class_attr} role="region" aria-label="{name}">
        {children_jsx}
      </div>
    );
  }}
);

{name}.displayName = '{name}';'''
    else:
        component_code = f'''const {name}: React.FC<{name}Props> = ({{ {props_str} }}) => {{
  return (
    <div {class_attr} role="region" aria-label="{name}">
      {children_jsx}
    </div>
  );
}};'''
    
    # Assemble full component
    full_code = f'''{chr(10).join(imports)}

interface {name}Props {{
{interface_content}
}}

{component_code}

export default {name};'''
    
    return full_code

@tool
def generate_hook(name: str, initial_value: str = "null") -> str:
    """Generate a custom React hook boilerplate"""
    hook_name = name if name.startswith("use") else f"use{name}"
    return f'''import {{ useState, useEffect }} from 'react';

export const {hook_name} = (initialValue = {initial_value}) => {{
  const [value, setValue] = useState(initialValue);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {{
    // Your effect logic here
  }}, []);

  return {{ value, setValue, loading, error }};
}};'''

# Integrate with Bedrock AgentCore
app = BedrockAgentCoreApp()
log = app.logger

@app.entrypoint
async def invoke(payload, context):
    session_id = getattr(context, 'session_id', None) or payload.get('sessionId', 'default')
    # Use userId from payload if provided (from authenticated user), otherwise fall back to a default
    # For cross-session memory to work, actor_id must be consistent across sessions for the same user
    actor_id = payload.get('userId', 'default-user')
    log.info(f"Invoke called with session_id: {session_id}, actor_id: {actor_id}")

    # Configure memory if available
    session_manager = None
    if MEMORY_ID:
        try:
            # Configure memory with retrieval from strategy namespaces
            # These match the memoryStrategies defined in CDK
            session_manager = AgentCoreMemorySessionManager(
                AgentCoreMemoryConfig(
                    memory_id=MEMORY_ID,
                    session_id=session_id,
                    actor_id=actor_id,
                    retrieval_config={
                        # Facts extracted by semanticMemoryStrategy
                        f"/{actor_id}/facts": RetrievalConfig(top_k=10, relevance_score=0.3),
                        # Preferences extracted by userPreferenceMemoryStrategy
                        f"/{actor_id}/preferences": RetrievalConfig(top_k=5, relevance_score=0.3),
                    }
                ),
                REGION
            )
            log.info(f"Memory session manager initialized - memory_id: {MEMORY_ID}, actor_id: {actor_id}, session_id: {session_id}")
        except Exception as e:
            log.error(f"Failed to initialize memory session manager: {e}")
            import traceback
            log.error(traceback.format_exc())
            session_manager = None
    else:
        log.warning("MEMORY_ID is not set. Skipping memory session manager initialization.")


    # Create code interpreter
    code_interpreter = AgentCoreCodeInterpreter(
        region=REGION,
        session_name=session_id,
        auto_create=True,
        persist_sessions=True
    )

    with strands_mcp_client as client:
        # Get MCP Tools
        tools = client.list_tools_sync()

        # Create agent
        agent = Agent(
            model=load_model(),
            session_manager=session_manager,
            system_prompt="""
You are an expert React developer assistant specializing in modern React development.

Your expertise includes:
- React 18+ with hooks (useState, useEffect, useContext, useReducer, useMemo, useCallback, useRef)
- TypeScript with React (proper typing for props, state, events, refs)
- Next.js App Router and Pages Router
- State management (Redux Toolkit, Zustand, Jotai, React Query/TanStack Query)
- Styling (Tailwind CSS, CSS Modules, styled-components, Emotion)
- Testing (Jest, React Testing Library, Cypress, Playwright)
- Performance optimization (code splitting, lazy loading, memoization)
- Accessibility (ARIA, semantic HTML, keyboard navigation)

When helping developers:
- Write clean, maintainable TypeScript code
- Follow React best practices and patterns
- Explain the "why" behind recommendations
- Suggest modern alternatives to outdated patterns
- Consider performance and accessibility implications
- Use the code interpreter to demonstrate working examples when helpful

Use your tools to generate component boilerplates and custom hooks when asked.
            """,
            tools=[code_interpreter.code_interpreter, generate_component, generate_hook] + tools
        )

        # Execute and format response
        try:
            stream = agent.stream_async(payload.get("prompt"))

            async for event in stream:
                # Handle Text parts of the response
                if "data" in event and isinstance(event["data"], str):
                    yield event["data"]

                # Implement additional handling for other events
                # if "toolUse" in event:
                #   # Process toolUse

                # Handle end of stream
                # if "result" in event:
                #    yield(format_response(event["result"]))
        except Exception as e:
            log.error(f"Error during streaming: {e}")
            yield f"I encountered an error: {str(e)}"

def format_response(result) -> str:
    """Extract code from metrics and format with LLM response."""
    parts = []

    # Extract executed code from metrics
    try:
        tool_metrics = result.metrics.tool_metrics.get('code_interpreter')
        if tool_metrics and hasattr(tool_metrics, 'tool'):
            action = tool_metrics.tool['input']['code_interpreter_input']['action']
            if 'code' in action:
                parts.append(f"## Executed Code:\n```{action.get('language', 'python')}\n{action['code']}\n```\n---\n")
    except (AttributeError, KeyError):
        pass  # No code to extract

    # Add LLM response
    parts.append(f"## 📊 Result:\n{str(result)}")
    return "\n".join(parts)

if __name__ == "__main__":
    app.run()