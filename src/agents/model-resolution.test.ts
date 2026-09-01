import { describe, it, expect } from "bun:test"
import { resolveAgentModel, AGENT_MODEL_REQUIREMENTS } from "./model-resolution"

describe("AGENT_MODEL_REQUIREMENTS", () => {
  it("has entries for all 6 agents", () => {
    const agents = ["loom", "tapestry", "shuttle", "pattern", "thread", "spindle", "weft"] as const
    for (const a of agents) {
      expect(AGENT_MODEL_REQUIREMENTS[a]).toBeDefined()
      expect(AGENT_MODEL_REQUIREMENTS[a].fallbackChain.length).toBeGreaterThan(0)
    }
  })

  it("each entry has providers and model", () => {
    for (const req of Object.values(AGENT_MODEL_REQUIREMENTS)) {
      for (const entry of req.fallbackChain) {
        expect(entry.providers.length).toBeGreaterThan(0)
        expect(entry.model).toBeTruthy()
      }
    }
  })
})

describe("resolveAgentModel", () => {
  const available = new Set([
    "github-copilot/claude-opus-4.8",
    "github-copilot/claude-sonnet-5",
    "github-copilot/claude-haiku-4.5",
    "anthropic/claude-opus-4",
    "anthropic/claude-sonnet-4",
    "openai/gpt-5",
  ])

  it("explicit override takes precedence over everything", () => {
    const result = resolveAgentModel("loom", {
      availableModels: available,
      agentMode: "primary",
      uiSelectedModel: "openai/gpt-5",
      overrideModel: "anthropic/claude-opus-4",
    })
    expect(result).toBe("anthropic/claude-opus-4")
  })

  it("UI-selected model applies for primary agents", () => {
    const result = resolveAgentModel("loom", {
      availableModels: new Set(),
      agentMode: "primary",
      uiSelectedModel: "openai/gpt-5",
    })
    expect(result).toBe("openai/gpt-5")
  })

  it("UI-selected model applies for 'all' mode agents", () => {
    const result = resolveAgentModel("shuttle", {
      availableModels: new Set(),
      agentMode: "all",
      uiSelectedModel: "openai/gpt-5",
    })
    expect(result).toBe("openai/gpt-5")
  })

  it("subagent ignores UI-selected model", () => {
    const result = resolveAgentModel("pattern", {
      availableModels: available,
      agentMode: "subagent",
      uiSelectedModel: "openai/gpt-5",
    })
    // Should use fallback chain, not the UI model — pattern's first is github-copilot/claude-opus-4.8
    expect(result).toBe("github-copilot/claude-opus-4.8")
  })

  it("category model applies when available and no higher priority", () => {
    const result = resolveAgentModel("thread", {
      availableModels: new Set(["anthropic/claude-sonnet-4"]),
      agentMode: "subagent",
      categoryModel: "anthropic/claude-sonnet-4",
    })
    expect(result).toBe("anthropic/claude-sonnet-4")
  })

  it("category model is skipped when not in availableModels", () => {
    const result = resolveAgentModel("loom", {
      availableModels: available,
      agentMode: "subagent",
      categoryModel: "some/unavailable-model",
    })
    // Falls through to fallback chain
    expect(result).toBe("github-copilot/claude-opus-4.8")
  })

  it("falls through fallback chain to first available", () => {
    const result = resolveAgentModel("loom", {
      availableModels: new Set(["anthropic/claude-opus-4"]),
      agentMode: "subagent",
    })
    expect(result).toBe("anthropic/claude-opus-4")
  })

  it("uses system default when nothing else available", () => {
    const result = resolveAgentModel("loom", {
      availableModels: new Set(),
      agentMode: "subagent",
      systemDefaultModel: "openai/gpt-4o",
    })
    expect(result).toBe("openai/gpt-4o")
  })

  it("returns best-guess offline model when availableModels empty and no systemDefault", () => {
    const result = resolveAgentModel("loom", {
      availableModels: new Set(),
      agentMode: "subagent",
    })
    // Should be the first in loom's fallback chain
    expect(result).toBe("github-copilot/claude-opus-4.8")
  })

  it("override beats UI model for primary agent", () => {
    const result = resolveAgentModel("tapestry", {
      availableModels: new Set(),
      agentMode: "primary",
      uiSelectedModel: "google/gemini-3-pro",
      overrideModel: "anthropic/claude-sonnet-4",
    })
    expect(result).toBe("anthropic/claude-sonnet-4")
  })

  it("resolves custom agent with explicit override model", () => {
    const result = resolveAgentModel("my-custom-agent", {
      availableModels: new Set(),
      agentMode: "subagent",
      overrideModel: "custom/model-v1",
    })
    expect(result).toBe("custom/model-v1")
  })

  it("resolves custom agent with customFallbackChain", () => {
    const result = resolveAgentModel("my-custom-agent", {
      availableModels: new Set(["anthropic/claude-sonnet-4"]),
      agentMode: "subagent",
      customFallbackChain: [
        { providers: ["anthropic"], model: "claude-sonnet-4" },
      ],
    })
    expect(result).toBe("anthropic/claude-sonnet-4")
  })

  it("custom agent falls to system default when no fallback chain matches", () => {
    const result = resolveAgentModel("my-custom-agent", {
      availableModels: new Set(),
      agentMode: "subagent",
      systemDefaultModel: "fallback/model",
    })
    expect(result).toBe("fallback/model")
  })

  it("custom agent uses hardcoded default when nothing matches", () => {
    const result = resolveAgentModel("my-custom-agent", {
      availableModels: new Set(),
      agentMode: "subagent",
    })
    expect(result).toBe("github-copilot/claude-opus-4.8")
  })

  it("custom agent best-guess uses first fallback entry when offline", () => {
    const result = resolveAgentModel("my-custom-agent", {
      availableModels: new Set(),
      agentMode: "subagent",
      customFallbackChain: [
        { providers: ["google"], model: "gemini-3-pro" },
      ],
    })
    expect(result).toBe("google/gemini-3-pro")
  })
})
