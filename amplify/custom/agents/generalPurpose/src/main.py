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

# Define general-purpose tools
@tool
def analyze_text(
    text: str,
    analysis_type: str = "summary"
) -> str:
    """Analyze text content with various analysis types.
    
    Args:
        text: The text content to analyze
        analysis_type: Type of analysis - "summary", "sentiment", "keywords", "structure"
    
    Returns:
        Analysis results as formatted text
    """
    if analysis_type == "summary":
        # Simple extractive summary logic
        sentences = text.split('. ')
        if len(sentences) <= 3:
            return f"Summary: {text}"
        
        # Take first and last sentences as basic summary
        summary = f"{sentences[0]}. {sentences[-1]}"
        return f"Summary: {summary}"
    
    elif analysis_type == "sentiment":
        # Basic sentiment analysis
        positive_words = ["good", "great", "excellent", "amazing", "wonderful", "fantastic", "positive", "happy", "love"]
        negative_words = ["bad", "terrible", "awful", "horrible", "negative", "sad", "hate", "disappointing"]
        
        text_lower = text.lower()
        pos_count = sum(1 for word in positive_words if word in text_lower)
        neg_count = sum(1 for word in negative_words if word in text_lower)
        
        if pos_count > neg_count:
            sentiment = "Positive"
        elif neg_count > pos_count:
            sentiment = "Negative"
        else:
            sentiment = "Neutral"
        
        return f"Sentiment Analysis: {sentiment} (Positive indicators: {pos_count}, Negative indicators: {neg_count})"
    
    elif analysis_type == "keywords":
        # Extract potential keywords (words longer than 4 characters, excluding common words)
        common_words = {"this", "that", "with", "have", "will", "from", "they", "been", "were", "said", "each", "which", "their", "time", "about"}
        words = text.lower().split()
        keywords = [word.strip('.,!?;:"()[]') for word in words 
                   if len(word) > 4 and word.lower() not in common_words]
        unique_keywords = list(set(keywords))[:10]  # Top 10 unique keywords
        
        return f"Keywords: {', '.join(unique_keywords)}"
    
    elif analysis_type == "structure":
        sentences = text.split('. ')
        paragraphs = text.split('\n\n')
        words = len(text.split())
        
        return f"Structure Analysis:\n- Words: {words}\n- Sentences: {len(sentences)}\n- Paragraphs: {len(paragraphs)}"
    
    else:
        return f"Unknown analysis type: {analysis_type}. Available types: summary, sentiment, keywords, structure"

@tool
def calculate_basic_stats(numbers: str) -> str:
    """Calculate basic statistics for a list of numbers.
    
    Args:
        numbers: Comma-separated or space-separated numbers
    
    Returns:
        Statistical summary including mean, median, min, max, etc.
    """
    try:
        # Parse numbers from string
        if ',' in numbers:
            num_list = [float(x.strip()) for x in numbers.split(',') if x.strip()]
        else:
            num_list = [float(x.strip()) for x in numbers.split() if x.strip()]
        
        if not num_list:
            return "No valid numbers found in input"
        
        # Calculate statistics
        count = len(num_list)
        total = sum(num_list)
        mean = total / count
        sorted_nums = sorted(num_list)
        
        # Median
        if count % 2 == 0:
            median = (sorted_nums[count//2 - 1] + sorted_nums[count//2]) / 2
        else:
            median = sorted_nums[count//2]
        
        # Min/Max
        minimum = min(num_list)
        maximum = max(num_list)
        
        # Range
        range_val = maximum - minimum
        
        # Standard deviation (simple calculation)
        variance = sum((x - mean) ** 2 for x in num_list) / count
        std_dev = variance ** 0.5
        
        stats = f"""Basic Statistics:
- Count: {count}
- Sum: {total:.2f}
- Mean: {mean:.2f}
- Median: {median:.2f}
- Minimum: {minimum:.2f}
- Maximum: {maximum:.2f}
- Range: {range_val:.2f}
- Standard Deviation: {std_dev:.2f}"""
        
        return stats
        
    except ValueError as e:
        return f"Error parsing numbers: {str(e)}. Please provide comma-separated or space-separated numbers."
    except Exception as e:
        return f"Error calculating statistics: {str(e)}"

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
You are a versatile general-purpose AI assistant designed to help with a wide variety of tasks.

Your capabilities include:
- **Research & Analysis**: Analyzing information, summarizing content, extracting insights
- **Writing & Communication**: Creating content, editing text, improving clarity
- **Problem Solving**: Breaking down complex problems, logical reasoning, troubleshooting
- **Data Processing**: Basic statistics, analyzing numerical data, organizing information
- **Code Understanding**: Reading and explaining code in various programming languages
- **General Knowledge**: Answering questions across diverse topics and domains

When helping users:
- Be thorough but concise in your responses
- Ask clarifying questions when the request is ambiguous
- Provide step-by-step explanations for complex topics
- Use examples to illustrate concepts when helpful
- Suggest alternative approaches when appropriate
- Use the code interpreter for calculations, data analysis, or demonstrations
- Leverage your analysis tools for text processing and statistical analysis

Always aim to be helpful, accurate, and educational in your responses.
            """,
            tools=[code_interpreter.code_interpreter, analyze_text, calculate_basic_stats] + tools
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