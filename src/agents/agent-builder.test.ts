import { describe, it, expect, mock } from "bun:test"
import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentFactory } from "./types"
import { buildAgent } from "./agent-builder"
import type { CategoriesConfig } from "../config/schema"

function makeFactory(baseConfig: Partial<AgentConfig> = {}): AgentFactory {
  const factory: AgentFactory = (model: string) => ({ ...baseConfig, model })
  factory.mode = "subagent"
  return factory
}

describe("buildAgent", () => {
  it("factory source is called with model string", () => {
    const factory = makeFactory({ temperature: 0.1 })
    const result = buildAgent(factory, "anthropic/claude-opus-4")
    expect(result.model).toBe("anthropic/claude-opus-4")
    expect(result.temperature).toBe(0.1)
  })

  it("static config source is cloned (original not mutated)", () => {
    const staticConfig: AgentConfig = { model: "openai/gpt-5", temperature: 0.2 }
    const result = buildAgent(staticConfig, "ignored-model")
    // Static config ignores model argument, preserves its own model
    expect(result.model).toBe("openai/gpt-5")
    // Mutate result, original should be unchanged
    result.temperature = 0.9
    expect(staticConfig.temperature).toBe(0.2)
  })

  it("category default model applies when base has no model", () => {
    const factory: AgentFactory = (model: string) => ({ category: "quick" } as AgentConfig)
    factory.mode = "subagent"
    const categories: CategoriesConfig = {
      quick: { model: "google/gemini-3-flash" },
    }
    const result = buildAgent(factory, "some-model", { categories })
    expect(result.model).toBe("google/gemini-3-flash")
  })

  it("category model does NOT apply when base already has a model", () => {
    const factory: AgentFactory = (model: string) => ({ model, category: "quick" } as AgentConfig)
    factory.mode = "subagent"
    const categories: CategoriesConfig = {
      quick: { model: "google/gemini-3-flash" },
    }
    const result = buildAgent(factory, "anthropic/claude-sonnet-4", { categories })
    expect(result.model).toBe("anthropic/claude-sonnet-4")
  })

  it("category temperature applies when base has no temperature", () => {
    const factory: AgentFactory = (model: string) => ({ category: "deep" } as AgentConfig)
    factory.mode = "subagent"
    const categories: CategoriesConfig = {
      deep: { temperature: 0.5 },
    }
    const result = buildAgent(factory, "model", { categories })
    expect(result.temperature).toBe(0.5)
  })

  it("category temperature does NOT apply when base already has temperature", () => {
    const factory: AgentFactory = (model: string) => ({ temperature: 0.1, category: "deep" } as AgentConfig)
    factory.mode = "subagent"
    const categories: CategoriesConfig = {
      deep: { temperature: 0.9 },
    }
    const result = buildAgent(factory, "model", { categories })
    expect(result.temperature).toBe(0.1)
  })

  it("resolveSkills is called with agent skills and result prepended to prompt", () => {
    const resolveSkills = mock((_names: string[]) => "## Skill Content\n\nDo things.")
    const factory: AgentFactory = (model: string) =>
      ({ model, skills: ["playwright"], prompt: "Base prompt." } as AgentConfig)
    factory.mode = "subagent"
    const result = buildAgent(factory, "model", { resolveSkills })
    expect(resolveSkills).toHaveBeenCalledWith(["playwright"], undefined)
    expect(result.prompt).toBe("## Skill Content\n\nDo things.\n\nBase prompt.")
  })

  it("skills are prepended even when base has no prompt", () => {
    const resolveSkills = mock((_names: string[]) => "## Skill Content")
    const factory: AgentFactory = (model: string) => ({ model, skills: ["git-master"] } as AgentConfig)
    factory.mode = "subagent"
    const result = buildAgent(factory, "model", { resolveSkills })
    expect(result.prompt).toBe("## Skill Content")
  })

  it("resolveSkills is NOT called when agent has no skills", () => {
    const resolveSkills = mock((_names: string[]) => "")
    const factory: AgentFactory = (model: string) => ({ model } as AgentConfig)
    factory.mode = "subagent"
    buildAgent(factory, "model", { resolveSkills })
    expect(resolveSkills).not.toHaveBeenCalled()
  })

  it("empty resolveSkills result does not modify prompt", () => {
    const resolveSkills = mock((_names: string[]) => "")
    const factory: AgentFactory = (model: string) => ({ model, skills: ["missing"], prompt: "Original." } as AgentConfig)
    factory.mode = "subagent"
    const result = buildAgent(factory, "model", { resolveSkills })
    expect(result.prompt).toBe("Original.")
  })

  it("no options provided: returns base config with model applied", () => {
    const factory = makeFactory({ temperature: 0.3 })
    const result = buildAgent(factory, "google/gemini-3-pro")
    expect(result.model).toBe("google/gemini-3-pro")
    expect(result.temperature).toBe(0.3)
  })
})
