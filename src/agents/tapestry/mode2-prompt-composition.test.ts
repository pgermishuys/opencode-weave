/**
 * Mode 2 prompt composition tests — deterministic assertions against the
 * composed Tapestry prompt for categorized delegation.
 *
 * These tests verify the prompt *says the right things* without calling an LLM.
 */

import { describe, it, expect } from "bun:test"
import {
  composeTapestryPrompt,
  buildTapestryCategoryRoutingSection,
} from "./prompt-composer"

describe("Mode 2 prompt composition — category routing section", () => {
  it("routing section instructs routing to shuttle-frontend for *.tsx files", () => {
    const section = buildTapestryCategoryRoutingSection({
      frontend: { patterns: ["*.tsx", "*.css"] },
    })
    expect(section).toContain("shuttle-frontend")
    expect(section).toContain("*.tsx")
    expect(section).toContain("*.css")
  })

  it("routing section instructs explicit tag override takes priority over file patterns", () => {
    const section = buildTapestryCategoryRoutingSection({
      frontend: { patterns: ["*.tsx"] },
      backend: { patterns: ["*.go"] },
    })
    expect(section).toContain("[category:")
    // Explicit tag should be listed as highest priority
    const priorityIdx = section!.indexOf("ROUTING PRIORITY")
    const tagIdx = section!.indexOf("[category:")
    expect(tagIdx).toBeGreaterThan(priorityIdx)
  })

  it("routing section instructs fallback to generic shuttle for unmatched files", () => {
    const section = buildTapestryCategoryRoutingSection({
      frontend: { patterns: ["*.tsx"] },
    })
    expect(section).toContain("shuttle")
    expect(section).toContain("fallback")
  })

  it("routing section instructs spawning different category shuttles in parallel for disjoint tasks", () => {
    const section = buildTapestryCategoryRoutingSection({
      frontend: { patterns: ["*.tsx"] },
      backend: { patterns: ["*.go"] },
    })
    expect(section).toContain("shuttle-frontend")
    expect(section).toContain("shuttle-backend")
    expect(section).toContain("parallel")
  })
})

describe("Mode 2 prompt composition — full composed prompt", () => {
  it("composed prompt with categories includes CategoryRouting section", () => {
    const prompt = composeTapestryPrompt({
      categories: {
        frontend: { patterns: ["*.tsx", "*.css"], prompt_append: "React expert" },
      },
    })
    expect(prompt).toContain("<CategoryRouting>")
    expect(prompt).toContain("shuttle-frontend")
    expect(prompt).toContain("*.tsx")
  })

  it("composed prompt with categories uses shuttle-{category} in delegation section", () => {
    const prompt = composeTapestryPrompt({
      categories: { frontend: { patterns: ["*.tsx"] } },
    })
    const delegationSection = prompt.slice(prompt.indexOf("<Delegation>"), prompt.indexOf("</Delegation>"))
    expect(delegationSection).toContain("shuttle-{category}")
  })

  it("composed prompt without categories omits CategoryRouting section (Mode 1 preserved)", () => {
    const prompt = composeTapestryPrompt()
    expect(prompt).not.toContain("<CategoryRouting>")
  })

  it("composed prompt without categories uses plain shuttle in delegation section", () => {
    const prompt = composeTapestryPrompt()
    const delegationSection = prompt.slice(prompt.indexOf("<Delegation>"), prompt.indexOf("</Delegation>"))
    expect(delegationSection).toContain('subagent_type="shuttle"')
    expect(delegationSection).not.toContain("shuttle-{category}")
  })

  it("CategoryRouting section appears before PlanExecution", () => {
    const prompt = composeTapestryPrompt({
      categories: { frontend: { patterns: ["*.tsx"] } },
    })
    const categoryRoutingIdx = prompt.indexOf("<CategoryRouting>")
    const planExecIdx = prompt.indexOf("<PlanExecution>")
    expect(categoryRoutingIdx).toBeGreaterThan(-1)
    expect(categoryRoutingIdx).toBeLessThan(planExecIdx)
  })

  it("categories without patterns do not produce CategoryRouting section", () => {
    const prompt = composeTapestryPrompt({
      categories: {
        backend: { model: "claude-opus-4", temperature: 0.3 },
      },
    })
    expect(prompt).not.toContain("<CategoryRouting>")
    expect(prompt).not.toContain("shuttle-backend")
  })
})
