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

function getSection(prompt: string, tagName: string): string | null {
  const startTag = `<${tagName}>`
  const endTag = `</${tagName}>`
  const startIndex = prompt.indexOf(startTag)

  if (startIndex === -1) {
    return null
  }

  const endIndex = prompt.indexOf(endTag)
  return prompt.slice(startIndex, endIndex + endTag.length)
}

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
  it("includes CategoryRouting in the composed prompt when at least one category has patterns", () => {
    const prompt = composeTapestryPrompt({
      categories: {
        frontend: { patterns: ["*.tsx", "*.css"], prompt_append: "React expert" },
        backend: { model: "claude-opus-4", temperature: 0.3 },
      },
    })
    const categoryRoutingSection = getSection(prompt, "CategoryRouting")
    const delegationSection = getSection(prompt, "Delegation")

    expect(categoryRoutingSection).not.toBeNull()
    expect(categoryRoutingSection).toContain("shuttle-frontend")
    expect(categoryRoutingSection).toContain("*.tsx")
    expect(categoryRoutingSection).not.toContain("shuttle-backend")
    expect(delegationSection).not.toBeNull()
    expect(delegationSection).toContain("shuttle-frontend")
    expect(delegationSection).not.toContain("shuttle-{category}")
  })

  it("composed prompt with categories uses concrete agent names in delegation section", () => {
    const prompt = composeTapestryPrompt({
      categories: { frontend: { patterns: ["*.tsx"] } },
    })
    const delegationSection = prompt.slice(prompt.indexOf("<Delegation>"), prompt.indexOf("</Delegation>"))
    expect(delegationSection).toContain("shuttle-frontend")
    expect(delegationSection).not.toContain("shuttle-{category}")
  })

  it("omits CategoryRouting and keeps plain shuttle delegation when no categories are provided", () => {
    const prompt = composeTapestryPrompt()
    const categoryRoutingSection = getSection(prompt, "CategoryRouting")
    const delegationSection = getSection(prompt, "Delegation")

    expect(categoryRoutingSection).toBeNull()
    expect(delegationSection).not.toBeNull()
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

  it("omits CategoryRouting and keeps plain shuttle delegation when categories have no patterns", () => {
    const prompt = composeTapestryPrompt({
      categories: {
        backend: { model: "claude-opus-4", temperature: 0.3 },
      },
    })
    const categoryRoutingSection = getSection(prompt, "CategoryRouting")
    const delegationSection = getSection(prompt, "Delegation")

    expect(categoryRoutingSection).toBeNull()
    expect(prompt).not.toContain("shuttle-backend")
    expect(delegationSection).not.toBeNull()
    expect(delegationSection).toContain('subagent_type="shuttle"')
    expect(delegationSection).not.toContain("shuttle-{category}")
  })
})
