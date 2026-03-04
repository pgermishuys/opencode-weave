import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { writeFileSync, mkdirSync, rmSync } from "fs"
import { join } from "path"
import { buildCustomAgent, buildCustomAgentMetadata } from "./custom-agent-factory"
import { AGENT_DISPLAY_NAMES, getAgentDisplayName } from "../shared/agent-display-names"
import type { CustomAgentConfig } from "../config/schema"

const TEST_DIR = join(process.cwd(), ".test-custom-agent")

describe("buildCustomAgent", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
    // Clean up any registered display names
    delete AGENT_DISPLAY_NAMES["test-agent"]
    delete AGENT_DISPLAY_NAMES["file-agent"]
    delete AGENT_DISPLAY_NAMES["skill-agent"]
  })

  it("builds a basic agent from inline prompt", () => {
    const config: CustomAgentConfig = {
      prompt: "You are a test agent.",
      model: "test-model/v1",
      description: "Test Agent",
    }
    const agent = buildCustomAgent("test-agent", config)
    expect(agent.model).toBe("test-model/v1")
    expect(agent.prompt).toBe("You are a test agent.")
    expect(agent.description).toBe("Test Agent")
    expect(agent.mode).toBe("subagent")
  })

  it("loads prompt from prompt_file", () => {
    writeFileSync(join(TEST_DIR, "agent.md"), "Loaded from file.")
    const config: CustomAgentConfig = {
      prompt_file: "agent.md",
      model: "test-model/v1",
    }
    const agent = buildCustomAgent("file-agent", config, { configDir: TEST_DIR })
    expect(agent.prompt).toBe("Loaded from file.")
  })

  it("prompt_file takes priority over inline prompt", () => {
    writeFileSync(join(TEST_DIR, "priority.md"), "File wins.")
    const config: CustomAgentConfig = {
      prompt: "Inline loses.",
      prompt_file: "priority.md",
      model: "test-model/v1",
    }
    const agent = buildCustomAgent("test-agent", config, { configDir: TEST_DIR })
    expect(agent.prompt).toBe("File wins.")
  })

  it("falls back to inline prompt when prompt_file not found", () => {
    const config: CustomAgentConfig = {
      prompt: "Fallback prompt.",
      prompt_file: "missing.md",
      model: "test-model/v1",
    }
    const agent = buildCustomAgent("test-agent", config, { configDir: TEST_DIR })
    expect(agent.prompt).toBe("Fallback prompt.")
  })

  it("registers display name", () => {
    const config: CustomAgentConfig = {
      prompt: "Test.",
      model: "test-model/v1",
      display_name: "Test Agent (Custom)",
    }
    buildCustomAgent("test-agent", config)
    expect(getAgentDisplayName("test-agent")).toBe("Test Agent (Custom)")
  })

  it("uses config key as display name when display_name not set", () => {
    const config: CustomAgentConfig = {
      prompt: "Test.",
      model: "test-model/v1",
    }
    buildCustomAgent("test-agent", config)
    expect(getAgentDisplayName("test-agent")).toBe("test-agent")
  })

  it("applies temperature and top_p settings", () => {
    const config: CustomAgentConfig = {
      prompt: "Test.",
      model: "test-model/v1",
      temperature: 0.7,
      top_p: 0.9,
    }
    const agent = buildCustomAgent("test-agent", config)
    expect(agent.temperature).toBe(0.7)
    expect(agent.top_p).toBe(0.9)
  })

  it("applies tool permissions", () => {
    const config: CustomAgentConfig = {
      prompt: "Test.",
      model: "test-model/v1",
      tools: { write: false, edit: false },
    }
    const agent = buildCustomAgent("test-agent", config)
    expect(agent.tools).toEqual({ write: false, edit: false })
  })

  it("throws on unknown tool names", () => {
    const config: CustomAgentConfig = {
      prompt: "Test.",
      model: "test-model/v1",
      tools: { write: true, "dangerous-tool": true },
    }
    expect(() => buildCustomAgent("test-agent", config)).toThrow(/unknown tool/)
  })

  it("accepts all known tool names", () => {
    const config: CustomAgentConfig = {
      prompt: "Test.",
      model: "test-model/v1",
      tools: { write: true, edit: true, bash: true, glob: true, grep: true, read: true, task: true, call_weave_agent: true, webfetch: true, todowrite: true, skill: true },
    }
    expect(() => buildCustomAgent("test-agent", config)).not.toThrow()
  })

  it("throws on invalid agent name with spaces", () => {
    const config: CustomAgentConfig = { prompt: "Test.", model: "test-model/v1" }
    expect(() => buildCustomAgent("My Agent", config)).toThrow(/Invalid custom agent name/)
  })

  it("throws on agent name with special characters", () => {
    const config: CustomAgentConfig = { prompt: "Test.", model: "test-model/v1" }
    expect(() => buildCustomAgent("agent!", config)).toThrow(/Invalid custom agent name/)
  })

  it("throws on agent name starting with number", () => {
    const config: CustomAgentConfig = { prompt: "Test.", model: "test-model/v1" }
    expect(() => buildCustomAgent("123agent", config)).toThrow(/Invalid custom agent name/)
  })

  it("accepts valid agent names with hyphens and underscores", () => {
    const config: CustomAgentConfig = { prompt: "Test.", model: "test-model/v1" }
    expect(() => buildCustomAgent("my-custom_agent", config)).not.toThrow()
    // Clean up
    delete AGENT_DISPLAY_NAMES["my-custom_agent"]
  })

  it("applies custom mode", () => {
    const config: CustomAgentConfig = {
      prompt: "Test.",
      model: "test-model/v1",
      mode: "primary",
    }
    const agent = buildCustomAgent("test-agent", config)
    expect(agent.mode).toBe("primary")
  })

  it("resolves skills and prepends to prompt", () => {
    const config: CustomAgentConfig = {
      prompt: "Base prompt.",
      model: "test-model/v1",
      skills: ["my-skill"],
    }
    const agent = buildCustomAgent("skill-agent", config, {
      resolveSkills: () => "SKILL_CONTENT",
    })
    expect(agent.prompt).toMatch(/^SKILL_CONTENT/)
    expect(agent.prompt).toContain("Base prompt.")
  })

  it("uses model override when provided", () => {
    const config: CustomAgentConfig = {
      prompt: "Test.",
      model: "explicit-model/v1",
    }
    const agent = buildCustomAgent("test-agent", config)
    expect(agent.model).toBe("explicit-model/v1")
  })

  it("falls through to system default when no model specified and no available models", () => {
    const config: CustomAgentConfig = {
      prompt: "Test.",
    }
    const agent = buildCustomAgent("test-agent", config, {
      systemDefaultModel: "fallback/model",
    })
    expect(agent.model).toBe("fallback/model")
  })
})

describe("buildCustomAgentMetadata", () => {
  it("creates metadata with defaults", () => {
    const config: CustomAgentConfig = {}
    const meta = buildCustomAgentMetadata("test-agent", config)
    expect(meta.category).toBe("utility")
    expect(meta.cost).toBe("CHEAP")
    expect(meta.triggers).toHaveLength(1)
    expect(meta.triggers[0].domain).toBe("Custom")
  })

  it("uses custom category and cost", () => {
    const config: CustomAgentConfig = {
      category: "advisor",
      cost: "EXPENSIVE",
    }
    const meta = buildCustomAgentMetadata("test-agent", config)
    expect(meta.category).toBe("advisor")
    expect(meta.cost).toBe("EXPENSIVE")
  })

  it("uses custom triggers", () => {
    const config: CustomAgentConfig = {
      triggers: [{ domain: "Testing", trigger: "When tests need writing" }],
    }
    const meta = buildCustomAgentMetadata("test-agent", config)
    expect(meta.triggers).toHaveLength(1)
    expect(meta.triggers[0].domain).toBe("Testing")
    expect(meta.triggers[0].trigger).toBe("When tests need writing")
  })

  it("uses display_name in default trigger description", () => {
    const config: CustomAgentConfig = {
      display_name: "My Custom Agent",
    }
    const meta = buildCustomAgentMetadata("test-agent", config)
    expect(meta.triggers[0].trigger).toContain("My Custom Agent")
  })
})
