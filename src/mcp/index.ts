// MCP Exports

export * from './agent-defaults';
export * from './types';

import type { McpConfig } from '../config/schema';
import type { McpServerConfig } from './types';
import { BUILTIN_MCP_SERVERS, DEFAULT_MCPS } from './types';

/**
 * Get MCP servers based on config - built-in + custom
 */
export function getMcpServers(
  config?: McpConfig,
): Map<string, McpServerConfig> {
  const servers = new Map<string, McpServerConfig>();

  // Only add built-in MCPs if config.enabled is explicitly provided
  const enabled = config?.enabled;

  if (enabled?.websearch === true) {
    servers.set('websearch', BUILTIN_MCP_SERVERS.websearch);
  }
  if (enabled?.context7 === true) {
    servers.set('context7', BUILTIN_MCP_SERVERS.context7);
  }
  if (enabled?.grep_app === true) {
    servers.set('grep_app', BUILTIN_MCP_SERVERS.grep_app);
  }

  // Add custom MCPs from config
  if (config?.servers) {
    for (const [name, server] of Object.entries(config.servers)) {
      servers.set(name, server as McpServerConfig);
    }
  }

  return servers;
}

/**
 * Get list of available MCP names
 */
export function getAvailableMcps(): string[] {
  return [...DEFAULT_MCPS];
}

/**
 * Check if an MCP is available (built-in)
 */
export function isBuiltInMcp(name: string): boolean {
  return name in BUILTIN_MCP_SERVERS;
}
