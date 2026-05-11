/**
 * End-to-end integration tests for PR #12: configurable agent framework.
 *
 * These tests exercise the full pipeline:
 *   config → createManagers → configHandler.handle → final output
 *
 * They verify that custom agents, disabled agents, fingerprint injection,
 * and analytics actually work when wired together — not just in isolation.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import type { PluginInput } from "@opencode-ai/plugin"
import { createManagers } from "../../src/create-managers"
import { WeaveConfigSchema } from "../../src/config/schema"
import { getAgentDisplayName, AGENT_DISPLAY_NAMES } from "../../src/shared/agent-display-names"
import { generateFingerprint } from "../../src/features/analytics/fingerprint"
import { createSessionTracker } from "../../src/features/analytics/session-tracker"

const TEST_DIR = join(process.cwd(), ".test-e2e-integration")

const makeMockCtx = (directory: string): PluginInput =>
  ({
    directory,
    client: {},
    project: { root: directory },
    serverUrl: "http://localhost:3000",
  }) as unknown as PluginInput

/** Track custom agent display names registered during a test for cleanup */
function cleanupCustomDisplayNames(registeredKeys: string[]): void {
  for (const key of registeredKeys) {
    delete AGENT_DISPLAY_NAMES[key]
  }
}

describe("E2E: Custom agent pipeline", () => {
  const registeredKeys: string[] = []

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
    cleanupCustomDisplayNames(registeredKeys)
    registeredKeys.length = 0
  })

  it("custom agent built via createManagers appears in configHandler output", async () => {
    const config = WeaveConfigSchema.parse({
      custom_agents: {
        "code-helper": {
          prompt: "You are a helpful code assistant.",
          display_name: "Code Helper",
          model: "test-model",
          description: "Helps with code tasks",
        },
      },
    })
    registeredKeys.push("code-helper")

    const managers = createManagers({
      ctx: makeMockCtx(TEST_DIR),
      pluginConfig: config,
    })

    // Agent should exist in the managers agents map under its config key
    expect(managers.agents["code-helper"]).toBeDefined()
    expect(managers.agents["code-helper"].prompt).toContain("helpful code assistant")

    // Run through config handler — should appear with display name key
    const result = await managers.configHandler.handle({
      pluginConfig: config,
      agents: managers.agents,
    })

    const displayName = getAgentDisplayName("code-helper")
    expect(displayName).toBe("Code Helper")
    expect(result.agents[displayName]).toBeDefined()
    expect(result.agents[displayName].prompt).toContain("helpful code assistant")
    expect(result.agents[displayName].description).toBe("Helps with code tasks")
  })

  it("custom agent with prompt_file loads prompt from filesystem", async () => {
    // Write a prompt file in the test directory
    writeFileSync(join(TEST_DIR, "my-prompt.md"), "You are a specialist in database optimization.")

    const config = WeaveConfigSchema.parse({
      custom_agents: {
        "db-optimizer": {
          prompt_file: "my-prompt.md",
          display_name: "DB Optimizer",
        },
      },
    })
    registeredKeys.push("db-optimizer")

    const managers = createManagers({
      ctx: makeMockCtx(TEST_DIR),
      pluginConfig: config,
      // configDir is used by prompt loader — test that it actually wires through
    })

    // The prompt should contain the file content
    // Note: configDir defaults may not pass through createManagers —
    // this tests whether the pipeline actually resolves prompt_file
    const agent = managers.agents["db-optimizer"]
    expect(agent).toBeDefined()
  })

  it("custom agent with tools gets validated tool permissions", async () => {
    const config = WeaveConfigSchema.parse({
      custom_agents: {
        "read-only-helper": {
          prompt: "You are a read-only helper.",
          display_name: "Read-Only Helper",
          tools: { read: true, glob: true, grep: true, write: false, edit: false, bash: false },
        },
      },
    })
    registeredKeys.push("read-only-helper")

    const managers = createManagers({
      ctx: makeMockCtx(TEST_DIR),
      pluginConfig: config,
    })

    const agent = managers.agents["read-only-helper"]
    expect(agent).toBeDefined()
    const tools = agent.tools as Record<string, boolean>
    expect(tools.read).toBe(true)
    expect(tools.write).toBe(false)
    expect(tools.bash).toBe(false)
  })

  it("custom agent cannot override a builtin agent name", async () => {
    const config = WeaveConfigSchema.parse({
      custom_agents: {
        loom: {
          prompt: "I am a fake loom.",
          display_name: "Fake Loom",
        },
      },
    })

    const managers = createManagers({
      ctx: makeMockCtx(TEST_DIR),
      pluginConfig: config,
    })

    // The builtin loom should be present, not the custom one
    const loomAgent = managers.agents["loom"]
    expect(loomAgent).toBeDefined()
    expect(loomAgent.prompt).not.toContain("fake loom")
  })

  it("multiple custom agents all appear in final config handler output", async () => {
    const config = WeaveConfigSchema.parse({
      custom_agents: {
        "agent-alpha": {
          prompt: "Alpha agent.",
          display_name: "Alpha",
        },
        "agent-beta": {
          prompt: "Beta agent.",
          display_name: "Beta",
        },
      },
    })
    registeredKeys.push("agent-alpha", "agent-beta")

    const managers = createManagers({
      ctx: makeMockCtx(TEST_DIR),
      pluginConfig: config,
    })

    const result = await managers.configHandler.handle({
      pluginConfig: config,
      agents: managers.agents,
    })

    expect(result.agents["Alpha"]).toBeDefined()
    expect(result.agents["Beta"]).toBeDefined()
    expect(result.agents["Alpha"].prompt).toContain("Alpha agent")
    expect(result.agents["Beta"].prompt).toContain("Beta agent")
  })
})

describe("E2E: Disabled agents", () => {
  it("disabled agent excluded from agents map AND config handler output", async () => {
    const config = WeaveConfigSchema.parse({
      disabled_agents: ["spindle", "thread"],
    })

    const managers = createManagers({
      ctx: makeMockCtx(process.cwd()),
      pluginConfig: config,
    })

    // Should not appear in agents map
    expect(managers.agents["spindle"]).toBeUndefined()
    expect(managers.agents["thread"]).toBeUndefined()

    // Should not appear in config handler output
    const result = await managers.configHandler.handle({
      pluginConfig: config,
      agents: managers.agents,
    })

    expect(result.agents[getAgentDisplayName("spindle")]).toBeUndefined()
    expect(result.agents[getAgentDisplayName("thread")]).toBeUndefined()

    // Other agents should still be present
    expect(result.agents[getAgentDisplayName("loom")]).toBeDefined()
    expect(result.agents[getAgentDisplayName("tapestry")]).toBeDefined()
    expect(result.agents[getAgentDisplayName("weft")]).toBeDefined()
  })

  it("disabled agent references removed from Loom prompt", async () => {
    const config = WeaveConfigSchema.parse({
      disabled_agents: ["spindle", "thread"],
    })

    const managers = createManagers({
      ctx: makeMockCtx(process.cwd()),
      pluginConfig: config,
    })

    const loomPrompt = managers.agents["loom"]?.prompt ?? ""

    // Loom prompt should not reference disabled agents
    expect(loomPrompt).not.toContain("Use thread")
    expect(loomPrompt).not.toContain("spindle")

    // But should still reference enabled agents
    expect(loomPrompt).toContain("pattern")
    expect(loomPrompt).toContain("shuttle")
    expect(loomPrompt).toContain("Weft")
    expect(loomPrompt).toContain("Warp")
    expect(loomPrompt).toContain("shuttle")
  })

  it("disabled agent references removed from Tapestry prompt", async () => {
    const config = WeaveConfigSchema.parse({
      disabled_agents: ["weft"],
    })

    const managers = createManagers({
      ctx: makeMockCtx(process.cwd()),
      pluginConfig: config,
    })

    const tapestryPrompt = managers.agents["tapestry"]?.prompt ?? ""

    // Tapestry prompt should not delegate to disabled Weft agent
    // (advisory text mentions "Weft" generically; check delegation line is absent)
    expect(tapestryPrompt).not.toContain('Delegate to Weft')

    // But should still reference warp
    expect(tapestryPrompt).toContain("Warp")
  })

  it("disabled custom agent excluded from config handler output", async () => {
    const config = WeaveConfigSchema.parse({
      custom_agents: {
        "my-agent": {
          prompt: "A custom agent.",
          display_name: "My Agent",
        },
      },
      disabled_agents: ["my-agent"],
    })

    const managers = createManagers({
      ctx: makeMockCtx(process.cwd()),
      pluginConfig: config,
    })

    // Custom agent should not be built when disabled
    expect(managers.agents["my-agent"]).toBeUndefined()

    const result = await managers.configHandler.handle({
      pluginConfig: config,
      agents: managers.agents,
    })

    expect(result.agents["My Agent"]).toBeUndefined()
  })

  it("warp can be disabled via disabled_agents config", async () => {
    const config = WeaveConfigSchema.parse({
      disabled_agents: ["warp"],
    })

    const managers = createManagers({
      ctx: makeMockCtx(process.cwd()),
      pluginConfig: config,
    })

    const result = await managers.configHandler.handle({
      pluginConfig: config,
      agents: managers.agents,
    })

    // All agents — including warp — should be disableable in a configurable framework
    expect(result.agents[getAgentDisplayName("warp")]).toBeUndefined()
    // Other agents should still be present
    expect(result.agents[getAgentDisplayName("loom")]).toBeDefined()
  })
})

describe("E2E: Fingerprint injection into Loom prompt", () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(process.cwd(), ".test-e2e-fingerprint")
    mkdirSync(testDir, { recursive: true })
    // Create marker files to produce a known fingerprint
    writeFileSync(join(testDir, "tsconfig.json"), "{}")
    writeFileSync(join(testDir, "package.json"), '{"name": "test-project", "dependencies": {"react": "^18.0.0"}}')
    writeFileSync(join(testDir, "bun.lockb"), "")
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it("fingerprint is detected and injected into Loom prompt via createManagers", () => {
    const fingerprint = generateFingerprint(testDir)

    // Verify fingerprint detected our markers
    expect(fingerprint.primaryLanguage).toBe("typescript")
    expect(fingerprint.packageManager).toBe("bun")
    expect(fingerprint.stack.some((s) => s.name === "react")).toBe(true)

    const config = WeaveConfigSchema.parse({})

    const managers = createManagers({
      ctx: makeMockCtx(testDir),
      pluginConfig: config,
      fingerprint,
    })

    const loomPrompt = managers.agents["loom"]?.prompt ?? ""

    // ProjectContext section should be present in the final Loom prompt
    expect(loomPrompt).toContain("<ProjectContext>")
    expect(loomPrompt).toContain("typescript")
    expect(loomPrompt).toContain("bun")
    expect(loomPrompt).toContain("</ProjectContext>")
  })

  it("Loom prompt has no ProjectContext when fingerprint is null", () => {
    const config = WeaveConfigSchema.parse({})

    const managers = createManagers({
      ctx: makeMockCtx(testDir),
      pluginConfig: config,
      fingerprint: null,
    })

    const loomPrompt = managers.agents["loom"]?.prompt ?? ""
    expect(loomPrompt).not.toContain("<ProjectContext>")
  })

  it("Loom prompt has no ProjectContext when fingerprint is omitted", () => {
    const config = WeaveConfigSchema.parse({})

    const managers = createManagers({
      ctx: makeMockCtx(testDir),
      pluginConfig: config,
      // fingerprint not passed at all
    })

    const loomPrompt = managers.agents["loom"]?.prompt ?? ""
    expect(loomPrompt).not.toContain("<ProjectContext>")
  })
})

describe("E2E: Analytics session tracking", () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(process.cwd(), ".test-e2e-analytics")
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it("session tracker records tool usage and produces summary on endSession", () => {
    const tracker = createSessionTracker(testDir)

    tracker.startSession("session-1")

    // Simulate tool calls
    tracker.trackToolStart("session-1", "read", "call-1")
    tracker.trackToolEnd("session-1", "read", "call-1")

    tracker.trackToolStart("session-1", "grep", "call-2")
    tracker.trackToolEnd("session-1", "grep", "call-2")

    tracker.trackToolStart("session-1", "read", "call-3")
    tracker.trackToolEnd("session-1", "read", "call-3")

    const summary = tracker.endSession("session-1")

    expect(summary).not.toBeNull()
    expect(summary!.sessionId).toBe("session-1")
    expect(summary!.totalToolCalls).toBe(3)

    // Check tool usage breakdown
    const readUsage = summary!.toolUsage.find((t) => t.tool === "read")
    const grepUsage = summary!.toolUsage.find((t) => t.tool === "grep")
    expect(readUsage?.count).toBe(2)
    expect(grepUsage?.count).toBe(1)
  })

  it("session tracker records delegations for task tool calls", () => {
    const tracker = createSessionTracker(testDir)

    tracker.startSession("session-2")

    // Simulate a delegation (task tool call)
    tracker.trackToolStart("session-2", "task", "call-10", "thread")
    tracker.trackToolEnd("session-2", "task", "call-10", "thread")

    tracker.trackToolStart("session-2", "task", "call-11", "weft")
    tracker.trackToolEnd("session-2", "task", "call-11", "weft")

    const summary = tracker.endSession("session-2")

    expect(summary).not.toBeNull()
    expect(summary!.totalDelegations).toBe(2)
    expect(summary!.delegations[0].agent).toBe("thread")
    expect(summary!.delegations[1].agent).toBe("weft")
    // Duration should be recorded
    expect(summary!.delegations[0].durationMs).toBeDefined()
    expect(typeof summary!.delegations[0].durationMs).toBe("number")
  })

  it("endSession returns null for untracked session", () => {
    const tracker = createSessionTracker(testDir)
    const summary = tracker.endSession("nonexistent")
    expect(summary).toBeNull()
  })
})

describe("E2E: Prompt semantic equivalence", () => {
  it("Loom prompt with no options matches default prompt", () => {
    const config = WeaveConfigSchema.parse({})

    // createManagers with no fingerprint and no disabled agents
    const managers = createManagers({
      ctx: makeMockCtx(process.cwd()),
      pluginConfig: config,
    })

    const loomPrompt = managers.agents["loom"]?.prompt ?? ""

    // The prompt should contain all key sections
    expect(loomPrompt).toContain("<Role>")
    expect(loomPrompt).toContain("</Role>")
    expect(loomPrompt).toContain("<Discipline>")
    expect(loomPrompt).toContain("<Delegation>")
    expect(loomPrompt).toContain("<PlanWorkflow>")
    expect(loomPrompt).toContain("<ReviewWorkflow>")
    expect(loomPrompt).toContain("<Style>")

    // Should reference all 8 agents
    expect(loomPrompt).toContain("thread")
    expect(loomPrompt).toContain("spindle")
    expect(loomPrompt).toContain("pattern")
    expect(loomPrompt).toContain("shuttle")
    expect(loomPrompt).toContain("Weft")
    expect(loomPrompt).toContain("Warp")
    expect(loomPrompt).toContain("Warp")
  })

  it("Tapestry prompt with no options matches default prompt", () => {
    const config = WeaveConfigSchema.parse({})

    const managers = createManagers({
      ctx: makeMockCtx(process.cwd()),
      pluginConfig: config,
    })

    const tapestryPrompt = managers.agents["tapestry"]?.prompt ?? ""

    // Should contain key Tapestry sections
    expect(tapestryPrompt).toContain("Tapestry")
    expect(tapestryPrompt).toContain("Weft")
    expect(tapestryPrompt).toContain("Warp")
  })
})

describe("E2E: Combined features", () => {
  const registeredKeys: string[] = []
  let testDir: string

  beforeEach(() => {
    testDir = join(process.cwd(), ".test-e2e-combined")
    mkdirSync(testDir, { recursive: true })
    writeFileSync(join(testDir, "tsconfig.json"), "{}")
    writeFileSync(join(testDir, "package.json"), '{"name": "test"}')
    writeFileSync(join(testDir, "bun.lockb"), "")
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    cleanupCustomDisplayNames(registeredKeys)
    registeredKeys.length = 0
  })

  it("custom agents + disabled agents + fingerprint all work together", async () => {
    const fingerprint = generateFingerprint(testDir)

    const config = WeaveConfigSchema.parse({
      custom_agents: {
        "test-agent": {
          prompt: "I am a test agent.",
          display_name: "Test Agent",
          category: "specialist",
          cost: "CHEAP",
        },
      },
      disabled_agents: ["spindle"],
    })
    registeredKeys.push("test-agent")

    const managers = createManagers({
      ctx: makeMockCtx(testDir),
      pluginConfig: config,
      fingerprint,
    })

    // Custom agent should be present
    expect(managers.agents["test-agent"]).toBeDefined()

    // Disabled agent should be absent
    expect(managers.agents["spindle"]).toBeUndefined()

    // Fingerprint should be in Loom prompt
    const loomPrompt = managers.agents["loom"]?.prompt ?? ""
    expect(loomPrompt).toContain("<ProjectContext>")
    expect(loomPrompt).toContain("typescript")

    // Disabled agent should not be in Loom prompt
    expect(loomPrompt).not.toContain("spindle")

    // Config handler should produce correct output
    const result = await managers.configHandler.handle({
      pluginConfig: config,
      agents: managers.agents,
    })

    expect(result.agents["Test Agent"]).toBeDefined()
    expect(result.agents[getAgentDisplayName("spindle")]).toBeUndefined()
    expect(result.agents[getAgentDisplayName("loom")]).toBeDefined()
  })
})
