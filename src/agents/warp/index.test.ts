import { describe, it, expect } from "bun:test"
import { createWarpAgent } from "./index"

describe("createWarpAgent", () => {
  it("is a callable factory", () => {
    expect(typeof createWarpAgent).toBe("function")
  })

  it("has mode subagent", () => {
    expect(createWarpAgent.mode).toBe("subagent")
  })

  it("sets model from argument", () => {
    const config = createWarpAgent("claude-sonnet-4")
    expect(config.model).toBe("claude-sonnet-4")
  })

  it("has a non-empty prompt", () => {
    const config = createWarpAgent("claude-sonnet-4")
    expect(typeof config.prompt).toBe("string")
    expect(config.prompt!.length).toBeGreaterThan(0)
  })

  it("denies write tool", () => {
    const config = createWarpAgent("claude-sonnet-4")
    expect(config.tools?.["write"]).toBe(false)
  })

  it("denies edit tool", () => {
    const config = createWarpAgent("claude-sonnet-4")
    expect(config.tools?.["edit"]).toBe(false)
  })

  it("denies task tool", () => {
    const config = createWarpAgent("claude-sonnet-4")
    expect(config.tools?.["task"]).toBe(false)
  })

  it("denies call_weave_agent tool", () => {
    const config = createWarpAgent("claude-sonnet-4")
    expect(config.tools?.["call_weave_agent"]).toBe(false)
  })

  it("description contains Security or Auditor", () => {
    const config = createWarpAgent("claude-sonnet-4")
    const desc = config.description ?? ""
    expect(desc.toLowerCase()).toMatch(/security|auditor/)
  })

  it("prompt contains security review sections", () => {
    const config = createWarpAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).toContain("<SecurityReview>")
    expect(prompt).toContain("<SpecificationCompliance>")
    expect(prompt).toContain("<Triage>")
  })

  it("prompt has skeptical bias (opposite of Weft)", () => {
    const config = createWarpAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).toContain("REJECT by default")
  })

  it("prompt contains spec reference table", () => {
    const config = createWarpAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).toContain("RFC 6749")
    expect(prompt).toContain("RFC 7636")
    expect(prompt).toContain("RFC 7519")
    expect(prompt).toContain("OIDC Core")
    expect(prompt).toContain("WebAuthn")
  })

  it("prompt contains verdict structure with APPROVE and REJECT", () => {
    const config = createWarpAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).toContain("[APPROVE]")
    expect(prompt).toContain("[REJECT]")
    expect(prompt).toContain("blocking issues")
  })

  it("prompt references webfetch for RFC verification", () => {
    const config = createWarpAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).toContain("webfetch")
  })

  it("prompt references .weave/specs.json", () => {
    const config = createWarpAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).toContain(".weave/specs.json")
  })
})
