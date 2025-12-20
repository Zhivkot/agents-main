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

# Define UX/UI specialist tools
@tool
def generate_color_palette(
    primary_color: str,
    style: str = "modern",
    include_neutrals: bool = True
) -> str:
    """Generate a harmonious color palette based on a primary color.
    
    Args:
        primary_color: The primary brand color in hex format (e.g., "#3B82F6")
        style: Design style - "modern", "minimal", "vibrant", or "corporate"
        include_neutrals: Whether to include neutral colors for text and backgrounds
    
    Returns:
        A color palette with CSS custom properties
    """
    result = f"""/* Color Palette - {style.title()} Style */
/* Primary: {primary_color} */

:root {{
  /* Primary Colors */
  --color-primary-50: {primary_color}10;
  --color-primary-100: {primary_color}20;
  --color-primary-200: {primary_color}40;
  --color-primary-300: {primary_color}60;
  --color-primary-400: {primary_color}80;
  --color-primary-500: {primary_color};
  --color-primary-600: {primary_color}E6;
  --color-primary-700: {primary_color}CC;
  --color-primary-800: {primary_color}B3;
  --color-primary-900: {primary_color}99;
"""
    
    if include_neutrals:
        result += """
  /* Neutral Colors */
  --color-gray-50: #F9FAFB;
  --color-gray-100: #F3F4F6;
  --color-gray-200: #E5E7EB;
  --color-gray-300: #D1D5DB;
  --color-gray-400: #9CA3AF;
  --color-gray-500: #6B7280;
  --color-gray-600: #4B5563;
  --color-gray-700: #374151;
  --color-gray-800: #1F2937;
  --color-gray-900: #111827;
  
  /* Semantic Colors */
  --color-success: #10B981;
  --color-warning: #F59E0B;
  --color-error: #EF4444;
  --color-info: #3B82F6;
"""
    
    result += "}"
    return result


@tool
def generate_typography_scale(
    base_size: int = 16,
    scale_ratio: str = "major-third",
    font_family: str = "Inter"
) -> str:
    """Generate a typographic scale for consistent text sizing.
    
    Args:
        base_size: Base font size in pixels (default: 16)
        scale_ratio: Scale ratio - "minor-second", "major-second", "minor-third", "major-third", "perfect-fourth"
        font_family: Primary font family name
    
    Returns:
        CSS custom properties for typography
    """
    ratios = {
        "minor-second": 1.067,
        "major-second": 1.125,
        "minor-third": 1.2,
        "major-third": 1.25,
        "perfect-fourth": 1.333
    }
    
    ratio = ratios.get(scale_ratio, 1.25)
    
    sizes = {
        "xs": base_size / (ratio ** 2),
        "sm": base_size / ratio,
        "base": base_size,
        "lg": base_size * ratio,
        "xl": base_size * (ratio ** 2),
        "2xl": base_size * (ratio ** 3),
        "3xl": base_size * (ratio ** 4),
        "4xl": base_size * (ratio ** 5),
    }
    
    return f"""/* Typography Scale - {scale_ratio} ({ratio}) */

:root {{
  /* Font Family */
  --font-sans: '{font_family}', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  
  /* Font Sizes */
  --text-xs: {sizes['xs'] / 16:.3f}rem;
  --text-sm: {sizes['sm'] / 16:.3f}rem;
  --text-base: {sizes['base'] / 16:.3f}rem;
  --text-lg: {sizes['lg'] / 16:.3f}rem;
  --text-xl: {sizes['xl'] / 16:.3f}rem;
  --text-2xl: {sizes['2xl'] / 16:.3f}rem;
  --text-3xl: {sizes['3xl'] / 16:.3f}rem;
  --text-4xl: {sizes['4xl'] / 16:.3f}rem;
  
  /* Line Heights */
  --leading-tight: 1.25;
  --leading-normal: 1.5;
  --leading-relaxed: 1.75;
  
  /* Font Weights */
  --font-normal: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;
}}"""


@tool
def audit_accessibility(component_html: str) -> str:
    """Audit a component's HTML for common accessibility issues.
    
    Args:
        component_html: HTML string of the component to audit
    
    Returns:
        Accessibility audit report with recommendations
    """
    issues = []
    recommendations = []
    
    html_lower = component_html.lower()
    
    if "<img" in html_lower and 'alt=' not in html_lower:
        issues.append("❌ Images missing alt attributes")
        recommendations.append("Add descriptive alt text to all images")
    
    if "<button" in html_lower and 'aria-label' not in html_lower:
        issues.append("⚠️ Button may lack accessible name")
        recommendations.append("Ensure buttons have visible text or aria-label")
    
    if "<input" in html_lower and '<label' not in html_lower and 'aria-label' not in html_lower:
        issues.append("❌ Form inputs missing associated labels")
        recommendations.append("Add <label> elements or aria-label to form inputs")
    
    if '<div' in html_lower and ('onclick' in html_lower or 'click' in html_lower):
        issues.append("⚠️ Div with click handler - consider using button")
        recommendations.append("Use semantic elements (button, a) for interactive content")
    
    recommendations.append("Verify color contrast meets WCAG 2.1 AA (4.5:1 for text)")
    recommendations.append("Ensure focus states are visible for keyboard navigation")
    
    report = "## Accessibility Audit Report\n\n"
    
    if issues:
        report += "### Issues Found\n"
        for issue in issues:
            report += f"- {issue}\n"
        report += "\n"
    else:
        report += "### ✅ No critical issues detected\n\n"
    
    report += "### Recommendations\n"
    for rec in recommendations:
        report += f"- {rec}\n"
    
    return report


@tool
def generate_spacing_system(base_unit: int = 4) -> str:
    """Generate a consistent spacing system based on a base unit.
    
    Args:
        base_unit: Base spacing unit in pixels (default: 4)
    
    Returns:
        CSS custom properties for spacing
    """
    return f"""/* Spacing System - Base Unit: {base_unit}px */

:root {{
  --space-0: 0;
  --space-px: 1px;
  --space-0-5: {base_unit * 0.5}px;
  --space-1: {base_unit}px;
  --space-2: {base_unit * 2}px;
  --space-3: {base_unit * 3}px;
  --space-4: {base_unit * 4}px;
  --space-5: {base_unit * 5}px;
  --space-6: {base_unit * 6}px;
  --space-8: {base_unit * 8}px;
  --space-10: {base_unit * 10}px;
  --space-12: {base_unit * 12}px;
  --space-16: {base_unit * 16}px;
  --space-20: {base_unit * 20}px;
  --space-24: {base_unit * 24}px;
  --space-32: {base_unit * 32}px;
  
  /* Component-specific spacing */
  --space-button-x: var(--space-4);
  --space-button-y: var(--space-2);
  --space-card: var(--space-6);
  --space-section: var(--space-16);
}}"""

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
You are an expert UX/UI design specialist with deep knowledge of user experience principles and interface design.

Your expertise includes:
- Design Systems: Creating and maintaining consistent design tokens, components, and patterns
- Color Theory: Color psychology, accessibility, palette generation, and brand alignment
- Typography: Font selection, typographic scales, readability, and hierarchy
- Layout & Spacing: Grid systems, whitespace, visual rhythm, and responsive design
- Accessibility (a11y): WCAG guidelines, screen readers, keyboard navigation, color contrast
- User Research: Personas, user journeys, usability testing, and heuristic evaluation
- Interaction Design: Micro-interactions, animations, feedback patterns, and affordances
- Mobile-First Design: Touch targets, responsive breakpoints, and progressive enhancement

When helping designers and developers:
- Provide actionable, specific recommendations
- Consider accessibility from the start
- Balance aesthetics with usability
- Reference established design principles (Gestalt, Fitts's Law, etc.)
- Use your tools to generate design tokens and audit accessibility
- Explain the reasoning behind design decisions
            """,
            tools=[code_interpreter.code_interpreter, generate_color_palette, generate_typography_scale, audit_accessibility, generate_spacing_system] + tools
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