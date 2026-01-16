export interface McpClient {
  callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<{ content: unknown }>
  close(): Promise<void>
}

export interface McpServerConfig {
  type?: "stdio" | "http"
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
}

export interface SkillMcpClientInfo {
  sessionID: string
  skillName: string
  serverName: string
}

function createStdioClient(config: McpServerConfig, info: SkillMcpClientInfo): McpClient {
  const { command, args = [] } = config
  const { serverName, skillName } = info

  if (!command) {
    throw new Error(`missing 'command' field for stdio MCP server '${serverName}' in skill '${skillName}'`)
  }

  const env = { ...process.env, ...(config.env ?? {}) } as Record<string, string>

  let proc: ReturnType<typeof Bun.spawn> | null = null

  try {
    proc = Bun.spawn([command, ...args], {
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
  } catch (spawnError) {
    const msg = spawnError instanceof Error ? spawnError.message : String(spawnError)
    throw new Error(`stdio MCP server '${serverName}' in skill '${skillName}' failed to start: ${msg}`)
  }

  return {
    async callTool(_params) {
      throw new Error("not implemented in v1")
    },
    async close() {
      if (proc) {
        proc.kill()
        proc = null
      }
    },
  }
}

function getClientKey(info: SkillMcpClientInfo): string {
  return `${info.sessionID}:${info.skillName}:${info.serverName}`
}

export class SkillMcpManager {
  private clients: Map<string, McpClient> = new Map()

  async getOrCreateClient(info: SkillMcpClientInfo, config: McpServerConfig): Promise<McpClient> {
    const key = getClientKey(info)

    const existing = this.clients.get(key)
    if (existing) {
      return existing
    }

    const { serverName, skillName } = info

    if (config.type === "http") {
      throw new Error("HTTP MCP not supported in v1")
    }

    if (!config.command) {
      throw new Error(`missing 'command' field for stdio MCP server '${serverName}' in skill '${skillName}'`)
    }

    const client = createStdioClient(config, info)
    this.clients.set(key, client)
    return client
  }

  async disconnectSession(sessionID: string): Promise<void> {
    const prefix = `${sessionID}:`
    const keysToRemove: string[] = []

    for (const key of this.clients.keys()) {
      if (key.startsWith(prefix)) {
        keysToRemove.push(key)
      }
    }

    await Promise.all(
      keysToRemove.map(async (key) => {
        const client = this.clients.get(key)
        if (client) {
          await client.close()
          this.clients.delete(key)
        }
      })
    )
  }

  async disconnectAll(): Promise<void> {
    await Promise.all(
      Array.from(this.clients.entries()).map(async ([key, client]) => {
        await client.close()
        this.clients.delete(key)
      })
    )
    this.clients.clear()
  }

  getConnectedServers(): string[] {
    return Array.from(this.clients.keys())
  }

  isConnected(info: SkillMcpClientInfo): boolean {
    return this.clients.has(getClientKey(info))
  }

  async callTool(
    info: SkillMcpClientInfo,
    config: McpServerConfig,
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const maxAttempts = 3
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const client = await this.getOrCreateClient(info, config)
        const result = await client.callTool({ name, arguments: args })
        return result.content
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        if (!lastError.message.toLowerCase().includes("not connected")) {
          throw lastError
        }

        if (attempt === maxAttempts) {
          throw new Error(`Failed after 3 reconnection attempts: ${lastError.message}`)
        }
      }
    }

    throw lastError ?? new Error("Operation failed with unknown error")
  }
}
