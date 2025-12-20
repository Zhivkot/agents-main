import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import outputs from '../../amplify_outputs.json';
import { MessageContent } from './MessageContent';

interface AgentInfo {
  runtimeId: string;
  runtimeArn: string;
  description?: string;
  isDefault?: boolean;
}

interface AmplifyOutputs {
  custom?: {
    webSocketUrl?: string;
    // Multi-agent support
    agents?: Record<string, AgentInfo>;
    defaultAgent?: string;
    sharedGatewayUrl?: string;
    sharedMemoryId?: string;
    agentCoreRegion?: string;
    // Legacy single-agent fields (backward compatibility)
    agentCoreRuntimeId?: string;
    agentCoreRuntimeArn?: string;
    agentCoreGatewayUrl?: string;
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
  
  // Get available agents from amplify_outputs.json
  const availableAgents = useMemo(() => {
    const agents = typedOutputs.custom?.agents;
    if (agents && Object.keys(agents).length > 0) {
      return Object.entries(agents).map(([name, info]) => ({
        name,
        description: info.description,
        isDefault: info.isDefault,
      }));
    }
    // Fallback for legacy single-agent config
    if (typedOutputs.custom?.agentCoreRuntimeId) {
      return [{ name: 'default', description: 'Default Agent', isDefault: true }];
    }
    return [];
  }, []);

  // Get default agent name
  const defaultAgentName = useMemo(() => {
    // First check explicit defaultAgent field
    if (typedOutputs.custom?.defaultAgent) {
      return typedOutputs.custom.defaultAgent;
    }
    // Then check for agent marked as default
    const defaultAgent = availableAgents.find(a => a.isDefault);
    if (defaultAgent) {
      return defaultAgent.name;
    }
    // Fall back to first agent
    return availableAgents[0]?.name || 'default';
  }, [availableAgents]);

  // Selected agent state
  const [selectedAgent, setSelectedAgent] = useState<string>(defaultAgentName);
  
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
            setThinkingStatus(data.status === 'thinking' ? 'Thinking...' : data.status || null);
            break;

          case 'chunk': {
            setThinkingStatus(null);
            
            const messageId = currentMessageIdRef.current;
            let chunk = data.chunk;
            
            if (chunk && typeof chunk !== 'string') {
              chunk = JSON.stringify(chunk);
            }
            
            if (messageId && chunk) {
              setMessages((prev) => {
                const existingMsg = prev.find((msg) => msg.id === messageId);
                if (existingMsg) {
                  return prev.map((msg) =>
                    msg.id === messageId
                      ? { ...msg, content: msg.content + chunk, isStreaming: true }
                      : msg
                  );
                } else {
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

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    currentMessageIdRef.current = crypto.randomUUID();

    // Send message via WebSocket with agentName for multi-agent routing
    wsRef.current.send(JSON.stringify({
      action: 'sendMessage',
      message: userMessage,
      sessionId,
      userId,
      agentName: selectedAgent,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    sendMessage(input.trim());
    setInput('');
  };

  const handleAgentChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedAgent(e.target.value);
  };

  // Get current agent info for display
  const currentAgentInfo = useMemo(() => {
    return availableAgents.find(a => a.name === selectedAgent);
  }, [availableAgents, selectedAgent]);

  return (
    <div className="agent-chat">
      <div className="chat-header">
        <div className="connection-status">
          <span className={`status-dot ${connectionStatus}`}></span>
          {connectionStatus === 'connected' ? 'Connected' : 
           connectionStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
        </div>
        
        {availableAgents.length > 1 && (
          <div className="agent-selector">
            <label htmlFor="agent-select">Agent:</label>
            <select
              id="agent-select"
              value={selectedAgent}
              onChange={handleAgentChange}
              disabled={isLoading}
            >
              {availableAgents.map((agent) => (
                <option key={agent.name} value={agent.name}>
                  {agent.name}{agent.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        
        {availableAgents.length === 1 && (
          <div className="current-agent">
            <span className="agent-label">Agent:</span>
            <span className="agent-name">{selectedAgent}</span>
          </div>
        )}
      </div>

      {currentAgentInfo?.description && (
        <div className="agent-description">
          {currentAgentInfo.description}
        </div>
      )}

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="empty-state">
            <p>Start a conversation with {selectedAgent}</p>
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
          placeholder={`Message ${selectedAgent}...`}
          disabled={isLoading || connectionStatus !== 'connected'}
        />
        <button type="submit" disabled={isLoading || !input.trim() || connectionStatus !== 'connected'}>
          Send
        </button>
      </form>
    </div>
  );
}
