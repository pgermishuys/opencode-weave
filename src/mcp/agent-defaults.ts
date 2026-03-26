import { DEFAULT_MCPS } from './types';

/**
 * Default MCP assignments per agent based on their domain.
 * These can be overridden by the user's agent configuration.
 */
export const AGENT_MCP_DEFAULTS: Record<string, string[]> = {
  // Exploration agents - code/docs focused
  thread: ['grep_app'],
  spindle: ['context7', 'grep_app'],

  // Advisor agents - research/validation focused
  weft: ['websearch'],
  warp: ['websearch', 'grep_app'],

  // Orchestrator agents - full access
  loom: [...DEFAULT_MCPS],
  tapestry: [...DEFAULT_MCPS],
  shuttle: ['grep_app'],

  // Default for unknown/custom agents
  default: ['websearch'],
};

/**
 * Get the MCPs to enable for an agent.
 * User config overrides defaults.
 * If userConfigMcps is provided (even as empty array), it takes precedence.
 * Otherwise, falls back to defaults.
 */
export function getAgentMcps(
  agentName: string,
  userConfigMcps?: string[],
): string[] {
  if (userConfigMcps !== undefined) {
    return userConfigMcps;
  }
  return AGENT_MCP_DEFAULTS[agentName] ?? AGENT_MCP_DEFAULTS.default;
}
