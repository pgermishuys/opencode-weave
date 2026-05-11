import { describe, expect, it } from "bun:test"
import { resolveReviewers } from "./review-resolver"

describe("resolveReviewers", () => {
  it("(a) direct + Weft + two review_models => fan-out with config-order variants and batch size 3", () => {
    const plan = resolveReviewers({
      scope: "direct",
      baseAgent: "weft",
      agentOverrides: {
        weft: {
          model: "openai/gpt-4o",
          review_models: ["anthropic/claude-sonnet-4", "openai/gpt-5"],
        },
      },
      disabledAgents: new Set(),
      primaryModel: "openai/gpt-4o",
    })

    expect(plan.kind).toBe("fan-out")
    if (plan.kind !== "fan-out") throw new Error("Expected fan-out")

    expect(plan.variants.map((v) => v.key)).toEqual([
      "weft-review-anthropic-claude-sonnet-4",
      "weft-review-openai-gpt-5",
    ])
    expect(plan.batch).toEqual({ mode: "parallel", size: 3 })
  })

  it("(b) direct + Warp + one review_models => fan-out with only warp-* keys", () => {
    const plan = resolveReviewers({
      scope: "direct",
      baseAgent: "warp",
      agentOverrides: {
        warp: {
          model: "openai/gpt-4o",
          review_models: ["anthropic/claude-sonnet-4"],
        },
      },
      disabledAgents: new Set(),
      primaryModel: "openai/gpt-4o",
    })

    expect(plan.kind).toBe("fan-out")
    if (plan.kind !== "fan-out") throw new Error("Expected fan-out")

    expect(plan.variants).toHaveLength(1)
    expect(plan.variants.every((v) => v.key.startsWith("warp-"))).toBe(true)
    expect(plan.variants.map((v) => v.key)).toEqual(["warp-review-anthropic-claude-sonnet-4"])
  })

  it("(c) direct + Weft + disabledAgents includes weft => disabled", () => {
    const plan = resolveReviewers({
      scope: "direct",
      baseAgent: "weft",
      agentOverrides: {
        weft: {
          model: "openai/gpt-4o",
          review_models: ["anthropic/claude-sonnet-4"],
        },
      },
      disabledAgents: new Set(["weft"]),
      primaryModel: "openai/gpt-4o",
    })

    expect(plan).toEqual({
      kind: "disabled",
      scope: "direct",
      baseAgent: "weft",
      reason: "agent-disabled",
    })
  })

  it("(d) direct + Weft + empty review_models => primary-only (no-variants)", () => {
    const plan = resolveReviewers({
      scope: "direct",
      baseAgent: "weft",
      agentOverrides: {
        weft: {
          model: "openai/gpt-4o",
          review_models: [],
        },
      },
      disabledAgents: new Set(),
      primaryModel: "openai/gpt-4o",
    })

    expect(plan).toEqual({
      kind: "primary-only",
      scope: "direct",
      baseAgent: "weft",
      primary: { agentName: "weft", label: "Weft", model: "openai/gpt-4o" },
      reason: "no-variants",
    })
  })

  it("(e) direct + Weft + one review_model disabled => primary-only (all-variants-disabled)", () => {
    const plan = resolveReviewers({
      scope: "direct",
      baseAgent: "weft",
      agentOverrides: {
        weft: {
          model: "openai/gpt-4o",
          review_models: ["opencode-go/x"],
        },
      },
      disabledAgents: new Set(["weft-review-opencode-go-x"]),
      primaryModel: "openai/gpt-4o",
    })

    expect(plan).toEqual({
      kind: "primary-only",
      scope: "direct",
      baseAgent: "weft",
      primary: { agentName: "weft", label: "Weft", model: "openai/gpt-4o" },
      reason: "all-variants-disabled",
    })
  })

  it("(f) review_models entry matching primary model is filtered; sole entry => primary-only (no-variants)", () => {
    const plan = resolveReviewers({
      scope: "direct",
      baseAgent: "weft",
      agentOverrides: {
        weft: {
          model: "openai/gpt-4o",
          review_models: ["openai/gpt-4o"],
        },
      },
      disabledAgents: new Set(),
      primaryModel: "openai/gpt-4o",
    })

    expect(plan).toEqual({
      kind: "primary-only",
      scope: "direct",
      baseAgent: "weft",
      primary: { agentName: "weft", label: "Weft", model: "openai/gpt-4o" },
      reason: "no-variants",
    })
  })

  it("filters review_models against resolved primaryModel when override model is absent", () => {
    const plan = resolveReviewers({
      scope: "post-execution",
      baseAgent: "warp",
      agentOverrides: {
        warp: {
          review_models: ["openai/gpt-5"],
        },
      },
      disabledAgents: new Set(),
      primaryModel: "openai/gpt-5",
    })

    expect(plan).toEqual({
      kind: "primary-only",
      scope: "post-execution",
      baseAgent: "warp",
      primary: { agentName: "warp", label: "Warp", model: "openai/gpt-5" },
      reason: "no-variants",
    })
  })

  it("filters both override model and primary model and keeps only distinct variants", () => {
    const plan = resolveReviewers({
      scope: "direct",
      baseAgent: "weft",
      agentOverrides: {
        weft: {
          model: "openai/gpt-4o",
          review_models: ["openai/gpt-4o", "openai/gpt-5", "anthropic/claude-sonnet-4"],
        },
      },
      disabledAgents: new Set(),
      primaryModel: "openai/gpt-5",
    })

    expect(plan.kind).toBe("fan-out")
    if (plan.kind !== "fan-out") throw new Error("Expected fan-out")
    expect(plan.variants.map((v) => v.model)).toEqual(["anthropic/claude-sonnet-4"])
  })

  it("(g) Weft plan never contains warp-* variants even when agents.warp.review_models is set", () => {
    const plan = resolveReviewers({
      scope: "direct",
      baseAgent: "weft",
      agentOverrides: {
        weft: {
          model: "openai/gpt-4o",
          review_models: ["anthropic/claude-sonnet-4"],
        },
        warp: {
          model: "openai/gpt-4o",
          review_models: ["google/gemini-2.5-pro"],
        },
      },
      disabledAgents: new Set(),
      primaryModel: "openai/gpt-4o",
    })

    expect(plan.kind).toBe("fan-out")
    if (plan.kind !== "fan-out") throw new Error("Expected fan-out")

    expect(plan.variants.map((v) => v.key)).toEqual(["weft-review-anthropic-claude-sonnet-4"])
    expect(plan.variants.some((v) => v.key.startsWith("warp-"))).toBe(false)
  })

  it("(h) post-execution and direct are structurally identical for same inputs except scope", () => {
    const shared = {
      baseAgent: "weft" as const,
      agentOverrides: {
        weft: {
          model: "openai/gpt-4o",
          review_models: ["anthropic/claude-sonnet-4", "openai/gpt-5"],
        },
      },
      disabledAgents: new Set<string>(),
      primaryModel: "openai/gpt-4o",
    }

    const direct = resolveReviewers({ ...shared, scope: "direct" })
    const postExecution = resolveReviewers({ ...shared, scope: "post-execution" })

    expect(direct.scope).toBe("direct")
    expect(postExecution.scope).toBe("post-execution")

    expect({ ...direct, scope: "same" }).toEqual({ ...postExecution, scope: "same" })
  })
})
