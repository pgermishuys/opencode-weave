import { describe, it, expect } from "bun:test"
import type { AgentConfig } from "@opencode-ai/sdk"
import { isGptModel, isFactory, type AgentFactory, type WeaveAgentName } from "./types"

describe("isGptModel", () => {
  it("returns true for openai/ prefix", () => {
    expect(isGptModel("openai/gpt-4o")).toBe(true)
  })

  it("returns true for github-copilot/gpt- prefix", () => {
    expect(isGptModel("github-copilot/gpt-4o")).toBe(true)
  })

  it("returns true for bare gpt- prefix", () => {
    expect(isGptModel("gpt-5")).toBe(true)
  })

  it("returns true for o3 prefix", () => {
    expect(isGptModel("o3-mini")).toBe(true)
  })

  it("returns true for o4 prefix", () => {
    expect(isGptModel("o4-preview")).toBe(true)
  })

  it("returns false for claude (non-GPT)", () => {
    expect(isGptModel("claude-opus-4")).toBe(false)
  })

  it("returns false for gemini (non-GPT)", () => {
    expect(isGptModel("gemini-3-pro")).toBe(false)
  })
})

describe("isFactory", () => {
  it("returns true when source is a function (AgentFactory)", () => {
    const factory: AgentFactory = ((model: string) => ({
      model,
    })) as AgentFactory
    factory.mode = "subagent"
    expect(isFactory(factory)).toBe(true)
  })

  it("returns false when source is a plain object (static AgentConfig)", () => {
    const staticConfig: AgentConfig = {
      model: "gpt-4o",
    }
    expect(isFactory(staticConfig)).toBe(false)
  })
})

describe("WeaveAgentName", () => {
  it("includes all 7 agent names", () => {
    const names: WeaveAgentName[] = [
      "loom",
      "tapestry",
      "shuttle",
      "pattern",
      "thread",
      "spindle",
      "weft",
    ]
    expect(names.length).toBe(7)
  })
})
