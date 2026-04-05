/**
 * CLI-level end-to-end tests for Weave plugin loading.
 *
 * These tests verify that opencode actually loads the Weave plugin
 * and produces the expected agent configurations by running
 * `opencode debug agent <name>` and inspecting the JSON output.
 *
 * Prerequisites:
 *   - opencode CLI installed and on PATH
 *   - Plugin built (`bun run build` → dist/ exists)
 *   - opencode configured to load the plugin (global or project config)
 *
 * In CI, the workflow installs opencode, builds the plugin, and
 * creates a project-level .opencode/config.json before running these tests.
 *
 * Locally, these tests use your existing opencode config.
 * Tests are skipped gracefully if opencode is not available.
 */
import { describe, it, expect, beforeAll } from "bun:test"
import { existsSync } from "fs"
import { join } from "path"
import { getAgentDisplayName } from "./shared/agent-display-names"

// ── Helpers ────────────────────────────────────────────────────────

let opencodeAvailable = false
let pluginBuilt = false

async function checkOpencode(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["opencode", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    await proc.exited
    return proc.exitCode === 0
  } catch {
    return false
  }
}

function checkPluginBuilt(): boolean {
  return existsSync(join(process.cwd(), "dist", "index.js"))
}

/**
 * Run `opencode debug agent <name>` and parse the JSON output.
 * Returns the parsed agent config object, or null if the command fails.
 */
async function debugAgent(displayName: string): Promise<Record<string, unknown> | null> {
  const proc = Bun.spawn(["opencode", "debug", "agent", displayName], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    console.error(`opencode debug agent "${displayName}" failed (exit ${exitCode}): ${stderr}`)
    return null
  }

  const stdout = await new Response(proc.stdout).text()
  try {
    return JSON.parse(stdout) as Record<string, unknown>
  } catch {
    console.error(`Failed to parse JSON from opencode debug agent "${displayName}": ${stdout}`)
    return null
  }
}

/**
 * Run `opencode debug config` and parse the JSON output.
 */
async function debugConfig(): Promise<Record<string, unknown> | null> {
  const proc = Bun.spawn(["opencode", "debug", "config"], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) return null

  const stdout = await new Response(proc.stdout).text()
  try {
    return JSON.parse(stdout) as Record<string, unknown>
  } catch {
    return null
  }
}

// ── Setup ──────────────────────────────────────────────────────────

beforeAll(async () => {
  opencodeAvailable = await checkOpencode()
  pluginBuilt = checkPluginBuilt()

  if (!opencodeAvailable) {
    console.warn("⚠ opencode CLI not found — CLI e2e tests will be skipped")
  }
  if (!pluginBuilt) {
    console.warn("⚠ Plugin not built (dist/index.js missing) — CLI e2e tests will be skipped")
  }
})

// ── Tests ──────────────────────────────────────────────────────────

describe("CLI E2E: Weave plugin loading", () => {
  it("opencode loads Weave and exposes Loom agent", async () => {
    if (!opencodeAvailable || !pluginBuilt) return

    const loomName = getAgentDisplayName("loom")
    const agent = await debugAgent(loomName)

    expect(agent).not.toBeNull()
    expect(agent!.name).toBe(loomName)
    expect(agent!.mode).toBe("primary")
    expect(typeof agent!.prompt).toBe("string")

    // Verify key prompt sections are present
    const prompt = agent!.prompt as string
    expect(prompt).toContain("<Role>")
    expect(prompt).toContain("Loom")
    expect(prompt).toContain("<Delegation>")
    expect(prompt).toContain("<PlanWorkflow>")
    expect(prompt).toContain("<Style>")
  })

  it("opencode loads Weave and exposes Tapestry agent", async () => {
    if (!opencodeAvailable || !pluginBuilt) return

    const tapestryName = getAgentDisplayName("tapestry")
    const agent = await debugAgent(tapestryName)

    expect(agent).not.toBeNull()
    expect(agent!.name).toBe(tapestryName)
    expect(typeof agent!.prompt).toBe("string")

    const prompt = agent!.prompt as string
    expect(prompt).toContain("Tapestry")
    expect(prompt).toContain("<PlanExecution>")
    expect(prompt).toContain("<PostExecutionReview>")
  })

  it(
    "opencode loads all 8 builtin Weave agents",
    async () => {
      if (!opencodeAvailable || !pluginBuilt) return

      const builtinKeys = ["loom", "tapestry", "shuttle", "pattern", "thread", "spindle", "warp", "weft"]

      for (const key of builtinKeys) {
        const displayName = getAgentDisplayName(key)
        const agent = await debugAgent(displayName)

        expect(agent).not.toBeNull()
        expect(agent!.name).toBe(displayName)
        expect(typeof agent!.prompt).toBe("string")
        expect((agent!.prompt as string).length).toBeGreaterThan(0)
      }
    },
    30_000,
  )

  it("Loom agent has correct tool permissions", async () => {
    if (!opencodeAvailable || !pluginBuilt) return

    const loomName = getAgentDisplayName("loom")
    const agent = await debugAgent(loomName)

    expect(agent).not.toBeNull()
    const tools = agent!.tools as Record<string, boolean>
    expect(tools).toBeDefined()

    // Loom should have access to coordination tools
    expect(tools.task).toBe(true)
    expect(tools.todowrite).toBe(true)
    expect(tools.read).toBe(true)
    expect(tools.bash).toBe(true)
    expect(tools.edit).toBe(true)
    expect(tools.write).toBe(true)
    expect(tools.glob).toBe(true)
    expect(tools.grep).toBe(true)
    expect(tools.webfetch).toBe(true)
    expect(tools.skill).toBe(true)
  })

  it("Weave plugin appears in opencode config", async () => {
    if (!opencodeAvailable || !pluginBuilt) return

    const config = await debugConfig()
    expect(config).not.toBeNull()

    // Plugin should be loaded
    const plugins = config!.plugin as string[]
    expect(plugins).toBeDefined()
    expect(plugins.length).toBeGreaterThan(0)

    // At least one plugin should reference weave
    const hasWeave = plugins.some((p: string) => p.toLowerCase().includes("weave"))
    expect(hasWeave).toBe(true)

    // Agents should be configured
    const agents = config!.agent as Record<string, unknown>
    expect(agents).toBeDefined()

    const loomName = getAgentDisplayName("loom")
    expect(agents[loomName]).toBeDefined()
  })

  it("Loom is configured as default agent", async () => {
    if (!opencodeAvailable || !pluginBuilt) return

    const config = await debugConfig()
    expect(config).not.toBeNull()

    const loomName = getAgentDisplayName("loom")
    expect(config!.default_agent).toBe(loomName)
  })

  it("Loom prompt references all delegation targets", async () => {
    if (!opencodeAvailable || !pluginBuilt) return

    const loomName = getAgentDisplayName("loom")
    const agent = await debugAgent(loomName)

    expect(agent).not.toBeNull()
    const prompt = agent!.prompt as string

    // Loom should reference all agents it can delegate to
    expect(prompt).toContain("thread")
    expect(prompt).toContain("spindle")
    expect(prompt).toContain("pattern")
    expect(prompt).toContain("shuttle")
    expect(prompt).toContain("Weft")
    expect(prompt).toContain("Warp")
  })

  it(
    "agent prompts are non-trivial (not empty stubs)",
    async () => {
      if (!opencodeAvailable || !pluginBuilt) return

      const builtinKeys = ["loom", "tapestry", "shuttle", "pattern", "thread", "spindle", "warp", "weft"]

      for (const key of builtinKeys) {
        const displayName = getAgentDisplayName(key)
        const agent = await debugAgent(displayName)

        expect(agent).not.toBeNull()
        const prompt = agent!.prompt as string

        // Each agent prompt should be substantial (not just a few words)
        expect(prompt.length).toBeGreaterThan(100)
      }
    },
    30_000,
  )

  it(
    "custom agents from config are accessible via debug agent (#30)",
    async () => {
      if (!opencodeAvailable || !pluginBuilt) return

      const config = await debugConfig()
      expect(config).not.toBeNull()

      const agents = config!.agent as Record<string, unknown> | undefined
      if (!agents) return

      // Identify custom agents: they are in config.agent but NOT builtin display names
      const builtinKeys = ["loom", "tapestry", "shuttle", "pattern", "thread", "spindle", "warp", "weft"]
      const builtinDisplayNames = new Set(builtinKeys.map((k) => getAgentDisplayName(k)))

      const customAgentNames = Object.keys(agents).filter((name) => !builtinDisplayNames.has(name))

      if (customAgentNames.length === 0) {
        console.info("ℹ No custom agents configured — skipping custom agent verification")
        return
      }

      for (const customName of customAgentNames) {
        const agent = await debugAgent(customName)
        expect(agent).not.toBeNull()
        expect(agent!.name).toBe(customName)
      }
    },
    30_000,
  )

  it("builtin agent overrides survive alongside custom_agents in config (#30)", async () => {
    if (!opencodeAvailable || !pluginBuilt) return

    const config = await debugConfig()
    expect(config).not.toBeNull()

    // Verify that when Weave plugin is loaded, builtins are still present
    // (they should not be wiped out by custom_agents validation)
    const agents = config!.agent as Record<string, unknown>
    expect(agents).toBeDefined()

    const loomName = getAgentDisplayName("loom")
    expect(agents[loomName]).toBeDefined()

    // Loom should still have a non-trivial prompt (not reset to empty default)
    const loom = await debugAgent(loomName)
    expect(loom).not.toBeNull()
    expect((loom!.prompt as string).length).toBeGreaterThan(100)
  })
})
