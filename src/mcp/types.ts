// MCP Type Definitions

export interface McpServerConfig {
  type?: 'local' | 'remote';
  command?: string[]; // Full command array (not separate command + args)
  url?: string;
  environment?: Record<string, string>;
  enabled?: boolean;
  timeout?: number;
  headers?: Record<string, string>;
  oauth?: Record<string, unknown> | false;
}

export interface McpClient {
  callTool(params: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<{ content: unknown }>;
  close(): Promise<void>;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// Built-in MCP server definitions
export const BUILTIN_MCP_SERVERS: Record<string, McpServerConfig> = {
  websearch: {
    type: 'remote',
    url: 'https://mcp.exa.ai/mcp?tools=web_search_exa',
    enabled: true,
    headers: undefined, // Set via EXA_API_KEY environment variable if available
    oauth: false, // Disable OAuth auto-detection - Exa uses API key header, not OAuth
  },
  context7: {
    type: 'remote',
    url: 'https://mcp.context7.com/mcp',
    enabled: true,
  },
  grep_app: {
    type: 'remote',
    url: 'https://mcp.grep.app',
    enabled: true,
  },
};

// Default MCPs to enable
export const DEFAULT_MCPS = ['websearch', 'context7', 'grep_app'] as const;
