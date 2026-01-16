import { describe, it, expect, beforeEach } from "bun:test"
import { SkillMcpManager } from "./skill-mcp-manager"
import type { McpClient, McpServerConfig, SkillMcpClientInfo } from "./skill-mcp-manager"

function makeMockClient(overrides?: Partial<McpClient>): McpClient {
  return {
    callTool: async () => ({ content: "ok" }),
    close: async () => {},
    ...overrides,
  }
}

function privateClients(mgr: SkillMcpManager): Map<string, McpClient> {
  return (mgr as unknown as { clients: Map<string, McpClient> }).clients
}

describe("SkillMcpManager", () => {
  let mgr: SkillMcpManager

  beforeEach(() => {
    mgr = new SkillMcpManager()
  })

  describe("getOrCreateClient", () => {
    it("returns the same client on second call (caching)", async () => {
      // given
      const info: SkillMcpClientInfo = { sessionID: "s1", skillName: "sk1", serverName: "srv1" }
      const mockClient = makeMockClient()
      privateClients(mgr).set("s1:sk1:srv1", mockClient)

      // when
      const first = await mgr.getOrCreateClient(info, { command: "echo" })
      const second = await mgr.getOrCreateClient(info, { command: "echo" })

      // then
      expect(first).toBe(mockClient)
      expect(second).toBe(mockClient)
      expect(first).toBe(second)
    })

    it("throws on HTTP type", async () => {
      // given
      const info: SkillMcpClientInfo = { sessionID: "s1", skillName: "sk1", serverName: "srv1" }
      const config: McpServerConfig = { type: "http", url: "https://example.com" }

      // when / then
      await expect(mgr.getOrCreateClient(info, config)).rejects.toThrow("HTTP MCP not supported in v1")
    })

    it("throws on stdio without command", async () => {
      // given
      const info: SkillMcpClientInfo = { sessionID: "s1", skillName: "my-skill", serverName: "my-server" }
      const config: McpServerConfig = { type: "stdio" }

      // when / then
      await expect(mgr.getOrCreateClient(info, config)).rejects.toThrow(
        "missing 'command' field for stdio MCP server 'my-server' in skill 'my-skill'"
      )
    })

    it("throws on missing command when type not specified", async () => {
      // given
      const info: SkillMcpClientInfo = { sessionID: "s1", skillName: "sk1", serverName: "srv1" }
      const config: McpServerConfig = {}

      // when / then
      await expect(mgr.getOrCreateClient(info, config)).rejects.toThrow(
        "missing 'command' field for stdio MCP server 'srv1' in skill 'sk1'"
      )
    })
  })

  describe("disconnectSession", () => {
    it("removes only that session's keys", async () => {
      // given
      const client1 = makeMockClient()
      const client2 = makeMockClient()
      const client3 = makeMockClient()
      const map = privateClients(mgr)
      map.set("s1:sk1:srv1", client1)
      map.set("s1:sk1:srv2", client2)
      map.set("s2:sk1:srv1", client3)

      // when
      await mgr.disconnectSession("s1")

      // then
      expect(map.has("s1:sk1:srv1")).toBe(false)
      expect(map.has("s1:sk1:srv2")).toBe(false)
      expect(map.has("s2:sk1:srv1")).toBe(true)
    })

    it("does not throw when session has no clients", async () => {
      // given / when / then
      await expect(mgr.disconnectSession("nonexistent")).resolves.toBeUndefined()
    })
  })

  describe("disconnectAll", () => {
    it("clears all connections", async () => {
      // given
      let closed1 = false
      let closed2 = false
      const client1 = makeMockClient({ close: async () => { closed1 = true } })
      const client2 = makeMockClient({ close: async () => { closed2 = true } })
      const map = privateClients(mgr)
      map.set("s1:sk1:srv1", client1)
      map.set("s2:sk2:srv2", client2)

      // when
      await mgr.disconnectAll()

      // then
      expect(mgr.getConnectedServers()).toEqual([])
      expect(closed1).toBe(true)
      expect(closed2).toBe(true)
    })
  })

  describe("isConnected", () => {
    it("returns true when key exists, false otherwise", () => {
      // given
      const info: SkillMcpClientInfo = { sessionID: "s1", skillName: "sk1", serverName: "srv1" }
      const other: SkillMcpClientInfo = { sessionID: "s9", skillName: "sk9", serverName: "srv9" }
      privateClients(mgr).set("s1:sk1:srv1", makeMockClient())

      // when / then
      expect(mgr.isConnected(info)).toBe(true)
      expect(mgr.isConnected(other)).toBe(false)
    })
  })

  describe("getConnectedServers", () => {
    it("returns all active connection keys", () => {
      // given
      const map = privateClients(mgr)
      map.set("s1:sk1:srv1", makeMockClient())
      map.set("s2:sk2:srv2", makeMockClient())

      // when
      const servers = mgr.getConnectedServers()

      // then
      expect(servers).toContain("s1:sk1:srv1")
      expect(servers).toContain("s2:sk2:srv2")
      expect(servers).toHaveLength(2)
    })

    it("returns empty array when no servers connected", () => {
      // given / when / then
      expect(mgr.getConnectedServers()).toEqual([])
    })
  })

  describe("callTool", () => {
    it("retries on 'not connected' error and succeeds on second attempt", async () => {
      // given
      const info: SkillMcpClientInfo = { sessionID: "s1", skillName: "sk1", serverName: "srv1" }
      const config: McpServerConfig = { command: "echo" }

      let attempts = 0
      const mockClient = makeMockClient({
        callTool: async () => {
          attempts++
          if (attempts === 1) throw new Error("not connected")
          return { content: "tool-result" }
        },
      })
      privateClients(mgr).set("s1:sk1:srv1", mockClient)

      // when
      const result = await mgr.callTool(info, config, "my-tool", { arg: 1 })

      // then
      expect(attempts).toBe(2)
      expect(result).toBe("tool-result")
    })

    it("throws after 3 failed reconnection attempts", async () => {
      // given
      const info: SkillMcpClientInfo = { sessionID: "s1", skillName: "sk1", serverName: "srv1" }
      const config: McpServerConfig = { command: "echo" }

      let attempts = 0
      const mockClient = makeMockClient({
        callTool: async () => {
          attempts++
          throw new Error("Not connected to server")
        },
      })
      privateClients(mgr).set("s1:sk1:srv1", mockClient)

      // when / then
      await expect(mgr.callTool(info, config, "my-tool", {})).rejects.toThrow(
        "Failed after 3 reconnection attempts: Not connected to server"
      )
      expect(attempts).toBe(3)
    })

    it("rethrows immediately on non-connection errors", async () => {
      // given
      const info: SkillMcpClientInfo = { sessionID: "s1", skillName: "sk1", serverName: "srv1" }
      const config: McpServerConfig = { command: "echo" }

      let attempts = 0
      const mockClient = makeMockClient({
        callTool: async () => {
          attempts++
          throw new Error("Tool execution failed: invalid arguments")
        },
      })
      privateClients(mgr).set("s1:sk1:srv1", mockClient)

      // when / then
      await expect(mgr.callTool(info, config, "my-tool", {})).rejects.toThrow(
        "Tool execution failed: invalid arguments"
      )
      expect(attempts).toBe(1)
    })
  })
})
