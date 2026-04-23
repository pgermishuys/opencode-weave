import { describe, it, expect, spyOn } from "bun:test"
import type { WeaveConfig } from "../config/schema"
import { resolveEffectiveReviewers } from "./reviewer-resolution"

describe("resolveEffectiveReviewers", () => {
  it("rejects additional reviewers configured as mode primary", () => {
    const warnSpy = spyOn(console, "error").mockImplementation(() => {})

    const config: WeaveConfig = {
      custom_agents: {
        "primary-reviewer": { mode: "primary", model: "gpt-4o" },
      },
      review: {
        additional_agents: ["primary-reviewer"],
      },
    }

    const metadata = [
      {
        name: "primary-reviewer",
        description: "Primary Reviewer",
        metadata: { category: "advisor", cost: "EXPENSIVE", triggers: [] },
      },
    ]

    const result = resolveEffectiveReviewers({
      pluginConfig: config,
      customAgentMetadata: metadata,
    })

    expect(result.reviewers).toHaveLength(1)
    expect(result.reviewers[0]?.isValid).toBe(false)
    expect(result.effectiveReviewers).toHaveLength(0)
    expect(result.warnings.some((w) => w.includes('mode "primary" cannot be delegated via subagent_type'))).toBe(
      true,
    )
    expect(warnSpy.mock.calls.some((call) => String(call[0]).includes('mode "primary"'))).toBe(true)

    warnSpy.mockRestore()
  })

  it("allows additional reviewers in mode subagent or all", () => {
    const config: WeaveConfig = {
      custom_agents: {
        "subagent-reviewer": { mode: "subagent", model: "gpt-4o" },
        "all-reviewer": { mode: "all", model: "gpt-4o" },
      },
      review: {
        additional_agents: ["subagent-reviewer", "all-reviewer"],
      },
    }

    const metadata = [
      {
        name: "subagent-reviewer",
        description: "Subagent Reviewer",
        metadata: { category: "advisor", cost: "EXPENSIVE", triggers: [] },
      },
      {
        name: "all-reviewer",
        description: "All Reviewer",
        metadata: { category: "advisor", cost: "EXPENSIVE", triggers: [] },
      },
    ]

    const result = resolveEffectiveReviewers({
      pluginConfig: config,
      customAgentMetadata: metadata,
    })

    expect(result.warnings).toHaveLength(0)
    expect(result.reviewers).toHaveLength(2)
    expect(result.reviewers.every((reviewer) => reviewer.isValid)).toBe(true)
    expect(result.effectiveReviewers.map((r) => r.key)).toEqual(["subagent-reviewer", "all-reviewer"])
  })
})
