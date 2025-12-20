/**
 * Agent Configuration Module
 * 
 * Defines the configuration for multiple AI agents deployed via Bedrock AgentCore.
 * Each agent has its own runtime, endpoints, and optionally shared or dedicated
 * memory/gateway resources.
 */

/**
 * Definition of a single agent in the registry.
 */
export interface AgentDefinition {
  /** Unique agent identifier (alphanumeric + hyphens, 1-64 chars) */
  name: string;
  /** Relative path to agent folder from the agentcore config directory */
  folderPath: string;
  /** Human-readable description (max 256 chars) */
  description?: string;
  /** Whether this is the default agent when none is specified */
  isDefault?: boolean;
}

/**
 * Configuration for the agent registry that controls how agents are deployed.
 */
export interface AgentRegistryConfig {
  /** List of agent definitions (at least one required) */
  agents: AgentDefinition[];
  /** true = single gateway shared by all agents, false = per-agent gateway */
  sharedGateway: boolean;
  /** true = single memory shared by all agents, false = per-agent memory */
  sharedMemory: boolean;
}

/**
 * Default agent configuration with neoAmber as the initial agent.
 */
export const agentConfig: AgentRegistryConfig = {
  agents: [
    {
      name: 'neoAmber',
      folderPath: '../agents/neoAmber',
      description: 'React development assistant',
    },
    {
      name: 'newAgent',
      folderPath: '../agents/newAgent',
      description: 'UX/UI design specialist for user experience and interface design',
    },
    {
      name: 'generalPurpose',
      folderPath: '../agents/generalPurpose',
      description: 'Versatile AI assistant for research, analysis, writing, and general problem-solving',
      isDefault: true,
    }
  ],
  sharedGateway: true,
  sharedMemory: true,
};
