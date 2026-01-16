import { describe, it, expect } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import WeavePlugin from "./index"

const makeMockCtx = (directory: string): PluginInput =>
  ({
    directory,
    client: {},
    project: { root: directory },
    serverUrl: "http://localhost:3000",
  }) as unknown as PluginInput

describe("WeavePlugin", () => {
  it("is a function", () => {
    expect(typeof WeavePlugin).toBe("function")
  })

  it("returns all 8 handlers when called with mock context", async () => {
    const result = await WeavePlugin(makeMockCtx(process.cwd()))
    const keys = Object.keys(result)
    expect(keys).toContain("tool")
    expect(keys).toContain("config")
    expect(keys).toContain("chat.message")
    expect(keys).toContain("chat.params")
    expect(keys).toContain("chat.headers")
    expect(keys).toContain("event")
    expect(keys).toContain("tool.execute.before")
    expect(keys).toContain("tool.execute.after")
  })

  it("handles missing config gracefully", async () => {
    const result = await WeavePlugin(makeMockCtx("/nonexistent/path"))
    expect(typeof result).toBe("object")
    expect(Object.keys(result)).toContain("config")
  })
})

