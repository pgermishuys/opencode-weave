import { describe, it, expect } from "bun:test"
import {
  composeLoomPrompt,
  buildRoleSection,
  buildDisciplineSection,
  buildSidebarTodosSection,
  buildDelegationSection,
  buildDelegationNarrationSection,
  buildPlanWorkflowSection,
  buildReviewWorkflowSection,
  buildStyleSection,
} from "./prompt-composer"

describe("composeLoomPrompt", () => {
  it("produces a non-empty prompt with default options", () => {
    const prompt = composeLoomPrompt()
    expect(prompt.length).toBeGreaterThan(0)
  })

  it("contains all XML sections with no disabled agents", () => {
    const prompt = composeLoomPrompt()
    expect(prompt).toContain("<Role>")
    expect(prompt).toContain("<Discipline>")
    expect(prompt).toContain("<SidebarTodos>")
    expect(prompt).toContain("<Delegation>")
    expect(prompt).toContain("<DelegationNarration>")
    expect(prompt).toContain("<PlanWorkflow>")
    expect(prompt).toContain("<ReviewWorkflow>")
    expect(prompt).toContain("<Style>")
  })

  it("preserves mandatory Warp language with no disabled agents", () => {
    const prompt = composeLoomPrompt()
    expect(prompt).toContain("MUST use Warp")
    expect(prompt).toContain("NOT optional")
    expect(prompt).toContain("MUST run Warp")
  })

  it("preserves review trigger conditions", () => {
    const prompt = composeLoomPrompt()
    expect(prompt).toContain("3+ files")
    expect(prompt).toContain("5+ tasks")
  })

  it("preserves Tapestry post-execution review note", () => {
    const prompt = composeLoomPrompt()
    expect(prompt).toContain("Tapestry runs Weft and Warp")
  })
})

describe("buildDelegationSection", () => {
  it("includes all agents by default", () => {
    const section = buildDelegationSection(new Set())
    expect(section).toContain("thread")
    expect(section).toContain("spindle")
    expect(section).toContain("pattern")
    expect(section).toContain("Tapestry")
    expect(section).toContain("shuttle")
    expect(section).toContain("Weft")
    expect(section).toContain("Warp")
  })

  it("excludes thread when disabled", () => {
    const section = buildDelegationSection(new Set(["thread"]))
    expect(section).not.toContain("Use thread")
  })

  it("excludes warp line when warp disabled", () => {
    const section = buildDelegationSection(new Set(["warp"]))
    expect(section).toContain("Weft")
    expect(section).not.toContain("MUST use Warp")
  })

  it("excludes weft line when weft disabled but keeps warp", () => {
    const section = buildDelegationSection(new Set(["weft"]))
    expect(section).not.toContain("Use Weft")
    expect(section).toContain("MUST use Warp")
  })

  it("excludes both weft and warp when both disabled", () => {
    const section = buildDelegationSection(new Set(["weft", "warp"]))
    expect(section).not.toContain("Weft")
    expect(section).not.toContain("Warp")
  })

  it("always includes delegate aggressively line", () => {
    const section = buildDelegationSection(new Set(["thread", "spindle", "pattern", "tapestry", "shuttle", "weft", "warp"]))
    expect(section).toContain("Delegate aggressively")
  })
})

describe("buildPlanWorkflowSection", () => {
  it("includes Pattern, Weft, Warp, and Tapestry by default", () => {
    const section = buildPlanWorkflowSection(new Set())
    expect(section).toContain("Pattern")
    expect(section).toContain("Weft")
    expect(section).toContain("Warp")
    expect(section).toContain("Tapestry")
  })

  it("omits Pattern step when pattern disabled", () => {
    const section = buildPlanWorkflowSection(new Set(["pattern"]))
    expect(section).not.toContain("Delegate to Pattern")
  })

  it("omits Weft review when weft disabled", () => {
    const section = buildPlanWorkflowSection(new Set(["weft"]))
    expect(section).not.toContain("Weft review is mandatory")
    // Warp should still be in review step
    expect(section).toContain("Warp")
  })

  it("omits both review steps when weft and warp disabled", () => {
    const section = buildPlanWorkflowSection(new Set(["weft", "warp"]))
    expect(section).not.toContain("REVIEW")
  })

  it("contains SKIP ONLY IF when weft enabled", () => {
    const section = buildPlanWorkflowSection(new Set())
    expect(section).toContain("SKIP ONLY IF")
  })

  it("includes security areas for Warp", () => {
    const section = buildPlanWorkflowSection(new Set())
    expect(section).toContain("security-relevant areas")
    expect(section).toContain("crypto")
  })
})

describe("buildReviewWorkflowSection", () => {
  it("returns empty string when both weft and warp disabled", () => {
    const section = buildReviewWorkflowSection(new Set(["weft", "warp"]))
    expect(section).toBe("")
  })

  it("includes Post-Plan and Ad-Hoc modes by default", () => {
    const section = buildReviewWorkflowSection(new Set())
    expect(section).toContain("Post-Plan-Execution Review")
    expect(section).toContain("Ad-Hoc Review")
  })

  it("includes Tapestry invokes Weft and Warp when tapestry enabled", () => {
    const section = buildReviewWorkflowSection(new Set())
    expect(section).toContain("Tapestry invokes Weft and Warp")
  })

  it("omits post-plan section when tapestry disabled", () => {
    const section = buildReviewWorkflowSection(new Set(["tapestry"]))
    expect(section).not.toContain("Post-Plan-Execution Review")
  })

  it("contains mandatory Warp language when warp enabled", () => {
    const section = buildReviewWorkflowSection(new Set())
    expect(section).toContain("MUST run Warp")
    expect(section).toContain("NOT optional")
  })

  it("omits warp section when warp disabled", () => {
    const section = buildReviewWorkflowSection(new Set(["warp"]))
    expect(section).not.toContain("MUST run Warp")
  })

  it("contains all security trigger keywords when warp enabled", () => {
    const section = buildReviewWorkflowSection(new Set())
    const triggers = ["crypto", "auth", "certificates", "tokens", "signatures", "input validation"]
    for (const trigger of triggers) {
      expect(section).toContain(trigger)
    }
  })
})

describe("individual section builders", () => {
  it("buildRoleSection contains Loom identity", () => {
    expect(buildRoleSection()).toContain("Loom")
    expect(buildRoleSection()).toContain("orchestrator")
  })

  it("buildDisciplineSection contains TODO OBSESSION", () => {
    expect(buildDisciplineSection()).toContain("TODO OBSESSION")
  })

  it("buildSidebarTodosSection contains format rules", () => {
    expect(buildSidebarTodosSection()).toContain("35 chars")
  })

  it("buildDelegationNarrationSection contains duration hints", () => {
    expect(buildDelegationNarrationSection()).toContain("DURATION HINTS")
  })

  it("buildStyleSection contains Dense > verbose", () => {
    expect(buildStyleSection()).toContain("Dense > verbose")
  })
})
