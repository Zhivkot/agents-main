/**
 * Configuration Validator Module
 * 
 * Validates agent registry configurations to ensure they meet all requirements
 * before CDK synthesis.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { AgentDefinition, AgentRegistryConfig } from './agents.config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Validation error with specific details about what failed */
export interface ValidationError {
  /** The field or agent that has the error */
  field: string;
  /** Description of what is invalid */
  message: string;
}

/** Result of configuration validation */
export interface ValidationResult {
  /** Whether the configuration is valid */
  valid: boolean;
  /** List of validation errors (empty if valid) */
  errors: ValidationError[];
}

/** Required files that must exist in an agent folder */
const REQUIRED_AGENT_FILES = ['Dockerfile', 'src/main.py'];

/** Pattern for valid agent names: alphanumeric and hyphens, 1-64 chars */
const AGENT_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/;

/**
 * Validates an agent name follows the required format.
 * Must be alphanumeric with hyphens, 1-64 characters, starting with alphanumeric.
 */
export function validateAgentName(name: string): ValidationError | null {
  if (!name || typeof name !== 'string') {
    return { field: 'name', message: 'Agent name is required and must be a string' };
  }
  if (name.length === 0) {
    return { field: 'name', message: 'Agent name cannot be empty' };
  }
  if (name.length > 64) {
    return { field: 'name', message: `Agent name "${name}" exceeds maximum length of 64 characters` };
  }
  if (!AGENT_NAME_PATTERN.test(name)) {
    return { 
      field: 'name', 
      message: `Agent name "${name}" contains invalid characters. Must be alphanumeric with hyphens, starting with alphanumeric` 
    };
  }
  return null;
}


/**
 * Validates an agent description if provided.
 * Must be max 256 characters.
 */
export function validateAgentDescription(description: string | undefined, agentName: string): ValidationError | null {
  if (description !== undefined && description.length > 256) {
    return { 
      field: `agents[${agentName}].description`, 
      message: `Description for agent "${agentName}" exceeds maximum length of 256 characters` 
    };
  }
  return null;
}

/**
 * Validates that an agent folder exists and contains required files.
 * @param folderPath - Relative path to the agent folder from the config directory
 * @param agentName - Name of the agent for error reporting
 * @param basePath - Optional base path for testing (defaults to __dirname)
 */
export function validateAgentFolder(
  folderPath: string, 
  agentName: string,
  basePath: string = __dirname
): ValidationError[] {
  const errors: ValidationError[] = [];
  
  if (!folderPath || typeof folderPath !== 'string') {
    errors.push({ 
      field: `agents[${agentName}].folderPath`, 
      message: `Folder path is required for agent "${agentName}"` 
    });
    return errors;
  }

  const absolutePath = path.resolve(basePath, folderPath);
  
  if (!fs.existsSync(absolutePath)) {
    errors.push({ 
      field: `agents[${agentName}].folderPath`, 
      message: `Agent folder does not exist: ${absolutePath}` 
    });
    return errors;
  }

  // Check for required files
  const missingFiles: string[] = [];
  for (const requiredFile of REQUIRED_AGENT_FILES) {
    const filePath = path.join(absolutePath, requiredFile);
    if (!fs.existsSync(filePath)) {
      missingFiles.push(requiredFile);
    }
  }

  if (missingFiles.length > 0) {
    errors.push({ 
      field: `agents[${agentName}].folderPath`, 
      message: `Agent folder "${agentName}" is missing required files: ${missingFiles.join(', ')}` 
    });
  }

  return errors;
}

/**
 * Validates a single agent definition.
 */
export function validateAgentDefinition(
  agent: AgentDefinition, 
  index: number,
  basePath?: string
): ValidationError[] {
  const errors: ValidationError[] = [];
  
  // Validate name
  const nameError = validateAgentName(agent.name);
  if (nameError) {
    nameError.field = `agents[${index}].${nameError.field}`;
    errors.push(nameError);
  }

  // Validate description if provided
  const descError = validateAgentDescription(agent.description, agent.name || `index ${index}`);
  if (descError) {
    errors.push(descError);
  }

  // Validate folder path and contents
  const folderErrors = validateAgentFolder(agent.folderPath, agent.name || `index ${index}`, basePath);
  errors.push(...folderErrors);

  return errors;
}


/**
 * Validates the complete agent registry configuration.
 * Checks for:
 * - At least one agent defined
 * - Valid agent definitions (names, paths, descriptions)
 * - Unique agent names
 * - At most one default agent
 * - Valid folder paths with required files
 * 
 * @param config - The agent registry configuration to validate
 * @param basePath - Optional base path for folder validation (defaults to __dirname)
 */
export function validateConfig(config: AgentRegistryConfig, basePath?: string): ValidationResult {
  const errors: ValidationError[] = [];

  // Check that config exists and has agents array
  if (!config) {
    errors.push({ field: 'config', message: 'Configuration is required' });
    return { valid: false, errors };
  }

  if (!config.agents || !Array.isArray(config.agents)) {
    errors.push({ field: 'agents', message: 'Agents array is required' });
    return { valid: false, errors };
  }

  // Check at least one agent is defined
  if (config.agents.length === 0) {
    errors.push({ field: 'agents', message: 'At least one agent must be defined' });
    return { valid: false, errors };
  }

  // Validate sharedGateway and sharedMemory are booleans
  if (typeof config.sharedGateway !== 'boolean') {
    errors.push({ field: 'sharedGateway', message: 'sharedGateway must be a boolean' });
  }
  if (typeof config.sharedMemory !== 'boolean') {
    errors.push({ field: 'sharedMemory', message: 'sharedMemory must be a boolean' });
  }

  // Track agent names for uniqueness check
  const seenNames = new Set<string>();
  const defaultAgents: string[] = [];

  // Validate each agent
  for (let i = 0; i < config.agents.length; i++) {
    const agent = config.agents[i];
    
    // Validate individual agent definition
    const agentErrors = validateAgentDefinition(agent, i, basePath);
    errors.push(...agentErrors);

    // Check for duplicate names
    if (agent.name) {
      if (seenNames.has(agent.name)) {
        errors.push({ 
          field: `agents[${i}].name`, 
          message: `Duplicate agent name: "${agent.name}"` 
        });
      }
      seenNames.add(agent.name);
    }

    // Track default agents
    if (agent.isDefault) {
      defaultAgents.push(agent.name || `index ${i}`);
    }
  }

  // Check for multiple default agents
  if (defaultAgents.length > 1) {
    errors.push({ 
      field: 'agents', 
      message: `Multiple agents marked as default: ${defaultAgents.join(', ')}. Only one agent can be the default.` 
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates configuration and throws an error if invalid.
 * Useful for CDK synthesis where we want to fail fast.
 * 
 * @param config - The agent registry configuration to validate
 * @param basePath - Optional base path for folder validation
 * @throws Error with detailed validation messages if configuration is invalid
 */
export function assertValidConfig(config: AgentRegistryConfig, basePath?: string): void {
  const result = validateConfig(config, basePath);
  if (!result.valid) {
    const errorMessages = result.errors.map(e => `  - ${e.field}: ${e.message}`).join('\n');
    throw new Error(`Invalid agent configuration:\n${errorMessages}`);
  }
}

/**
 * Gets the default agent from the configuration.
 * If no agent is marked as default, returns the first agent.
 * 
 * @param config - The agent registry configuration
 * @returns The default agent definition
 */
export function getDefaultAgent(config: AgentRegistryConfig): AgentDefinition {
  const defaultAgent = config.agents.find(a => a.isDefault);
  return defaultAgent || config.agents[0];
}
