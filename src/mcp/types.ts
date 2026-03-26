// MCP Type Definitions

export interface McpServerConfig {
  type?: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
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
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-websearch'],
  },
  context7: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'context7-mcp-server'],
  },
  grep_app: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'grep-app-mcp'],
  },
};

// Default MCPs to enable
export const DEFAULT_MCPS = ['websearch', 'context7', 'grep_app'] as const;
