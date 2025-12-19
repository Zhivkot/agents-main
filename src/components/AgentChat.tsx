import { useState, useRef, useEffect, useCallback } from 'react';
import outputs from '../../amplify_outputs.json';
import { MessageContent } from './MessageContent';

interface AmplifyOutputs {
  custom?: {
    webSocketUrl?: string;
    agentCoreRuntimeId?: string;
    agentCoreRuntimeArn?: string;
    agentCoreGatewayUrl?: string;
    agentCoreRegion?: string;
  };
}

const typedOutputs = outputs as AmplifyOutputs;

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'status';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

interface WebSocketMessage {
  type: 'status' | 'chunk' | 'complete' | 'error';
  status?: string;
  chunk?: string;
  response?: string;
  error?: string;
  sessionId?: string;
}

interface AgentChatProps {
  userId?: string;
}

export function AgentChat({ userId }: AgentChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [sessionId] = useState(() => crypto.randomUUID());
  
  const [thinkingStatus, setThinkingStatus] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const currentMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const connectWebSocket = useCallback(() => {
    const wsUrl = typedOutputs.custom?.webSocketUrl;
    if (!wsUrl) {
      console.error('WebSocket URL not found in amplify_outputs.json');
      return;
    }

    setConnectionStatus('connecting');
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('WebSocket connected');
      setConnectionStatus('connected');
    };

    ws.onmessage = (event) => {
      try {
        const data: WebSocketMessage = JSON.parse(event.data);
        console.log('WebSocket message:', data);

        switch (data.type) {
          case 'status':
            // Show thinking status
            setThinkingStatus(data.status === 'thinking' ? 'Thinking...' : data.status || null);
            break;

          case 'chunk': {
            // Clear thinking status when chunks start arriving
            setThinkingStatus(null);
            
            const messageId = currentMessageIdRef.current;
            let chunk = data.chunk;
            
            // Ensure chunk is a string
            if (chunk && typeof chunk !== 'string') {
              chunk = JSON.stringify(chunk);
            }
            
            // Streaming chunk - append to current message or create it
            if (messageId && chunk) {
              setMessages((prev) => {
                const existingMsg = prev.find((msg) => msg.id === messageId);
                if (existingMsg) {
                  // Append to existing message
                  return prev.map((msg) =>
                    msg.id === messageId
                      ? { ...msg, content: msg.content + chunk, isStreaming: true }
                      : msg
                  );
                } else {
                  // Create new assistant message on first chunk
                  return [...prev, {
                    id: messageId,
                    role: 'assistant' as const,
                    content: chunk,
                    timestamp: new Date(),
                    isStreaming: true,
                  }];
                }
              });
            }
            break;
          }

          case 'complete': {
            // Response complete - clear status and stop streaming
            setThinkingStatus(null);
            const messageId = currentMessageIdRef.current;
            if (messageId) {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === messageId
                    ? { ...msg, isStreaming: false }
                    : msg
                )
              );
            }
            currentMessageIdRef.current = null;
            setIsLoading(false);
            break;
          }

          case 'error': {
            // Error occurred
            setThinkingStatus(null);
            const messageId = currentMessageIdRef.current;
            if (messageId) {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === messageId
                    ? { ...msg, content: `Error: ${data.error}`, isStreaming: false }
                    : msg
                )
              );
            }
            currentMessageIdRef.current = null;
            setIsLoading(false);
            break;
          }
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setConnectionStatus('disconnected');
      wsRef.current = null;
      
      // Auto-reconnect after 3 seconds
      setTimeout(() => {
        if (!wsRef.current) {
          connectWebSocket();
        }
      }, 3000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connectWebSocket();
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connectWebSocket]);

  const sendMessage = (userMessage: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected');
      return;
    }

    setIsLoading(true);

    // Add user message
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);

    // Prepare assistant message ID but don't add to messages yet
    // It will be added when the first chunk arrives
    currentMessageIdRef.current = crypto.randomUUID();

    // Send message via WebSocket - agent handles memory/context internally
    wsRef.current.send(JSON.stringify({
      action: 'sendMessage',
      message: userMessage,
      sessionId,
      userId,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    sendMessage(input.trim());
    setInput('');
  };

  return (
    <div className="agent-chat">
      <div className="connection-status">
        <span className={`status-dot ${connectionStatus}`}></span>
        {connectionStatus === 'connected' ? 'Connected' : 
         connectionStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="empty-state">
            <p>Start a conversation with the AI agent</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            {msg.role === 'assistant' ? (
              <MessageContent content={msg.content} isStreaming={msg.isStreaming} />
            ) : (
              <div className="message-content">
                {msg.content || 'No response'}
              </div>
            )}
            <div className="message-time">{msg.timestamp.toLocaleTimeString()}</div>
          </div>
        ))}
        {thinkingStatus && (
          <div className="message status">
            <div className="thinking-status">
              <span className="thinking-icon">🤔</span>
              {thinkingStatus}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="chat-input-form">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message..."
          disabled={isLoading || connectionStatus !== 'connected'}
        />
        <button type="submit" disabled={isLoading || !input.trim() || connectionStatus !== 'connected'}>
          Send
        </button>
      </form>
    </div>
  );
}
