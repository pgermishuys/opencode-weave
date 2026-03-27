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
  buildCustomAgentDelegationSection,
} from "./prompt-composer"
import type { ProjectFingerprint } from "../../features/analytics/types"
import type { AvailableAgent } from "../dynamic-prompt-builder"

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

  it("contains delegation guardrail preventing direct plan execution", () => {
    const prompt = composeLoomPrompt()
    expect(prompt).toContain("NEVER execute plan tasks directly")
  })

  it("does not include ProjectContext with no fingerprint", () => {
    const prompt = composeLoomPrompt()
    expect(prompt).not.toContain("<ProjectContext>")
  })

  it("does not include ProjectContext with null fingerprint", () => {
    const prompt = composeLoomPrompt({ fingerprint: null })
    expect(prompt).not.toContain("<ProjectContext>")
  })

  it("includes ProjectContext when fingerprint is provided", () => {
    const fp: ProjectFingerprint = {
      generatedAt: new Date().toISOString(),
      stack: [{ name: "bun", confidence: "high", evidence: "bun.lockb" }],
      isMonorepo: false,
      primaryLanguage: "typescript",
      packageManager: "bun",
    }
    const prompt = composeLoomPrompt({ fingerprint: fp })
    expect(prompt).toContain("<ProjectContext>")
    expect(prompt).toContain("typescript")
    expect(prompt).toContain("bun")
    expect(prompt).toContain("</ProjectContext>")
  })

  it("places ProjectContext between Role and Discipline sections", () => {
    const fp: ProjectFingerprint = {
      generatedAt: new Date().toISOString(),
      stack: [],
      isMonorepo: false,
      primaryLanguage: "typescript",
      packageManager: "npm",
    }
    const prompt = composeLoomPrompt({ fingerprint: fp })
    const roleEnd = prompt.indexOf("</Role>")
    const contextStart = prompt.indexOf("<ProjectContext>")
    const disciplineStart = prompt.indexOf("<Discipline>")
    expect(contextStart).toBeGreaterThan(roleEnd)
    expect(contextStart).toBeLessThan(disciplineStart)
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
  it("contains delegation guardrail at the top", () => {
    const section = buildPlanWorkflowSection(new Set())
    expect(section).toContain("NEVER execute plan tasks directly")
    expect(section).toContain("/start-work")
  })

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

  it("buildDisciplineSection contains plan delegation guardrail", () => {
    const section = buildDisciplineSection()
    expect(section).toContain("PLANS: Never execute plan tasks directly")
    expect(section).toContain("/start-work")
  })

  it("buildSidebarTodosSection contains format rules", () => {
    expect(buildSidebarTodosSection()).toContain("35 chars")
  })

  it("buildSidebarTodosSection contains BEFORE FINISHING mandatory block", () => {
    const section = buildSidebarTodosSection()
    expect(section).toContain("BEFORE FINISHING (MANDATORY)")
    expect(section).toContain("NON-NEGOTIABLE")
    expect(section).toContain("final todowrite")
    expect(section).not.toContain("sidebar hides")
  })

  it("buildDelegationNarrationSection contains duration hints", () => {
    expect(buildDelegationNarrationSection()).toContain("DURATION HINTS")
  })

  it("buildDelegationNarrationSection omits Pattern hint when disabled", () => {
    const section = buildDelegationNarrationSection(new Set(["pattern"]))
    expect(section).not.toContain("Pattern (planning)")
    expect(section).toContain("Spindle")
    expect(section).toContain("Thread")
  })

  it("buildDelegationNarrationSection omits all duration hints when all agents disabled", () => {
    const section = buildDelegationNarrationSection(new Set(["pattern", "spindle", "weft", "warp", "thread"]))
    expect(section).not.toContain("DURATION HINTS")
  })

  it("buildStyleSection contains Dense > verbose", () => {
    expect(buildStyleSection()).toContain("Dense > verbose")
  })
})

describe("buildCustomAgentDelegationSection", () => {
  const makeCustomAgent = (name: string, domain: string, trigger: string): AvailableAgent => ({
    name,
    description: `${name} agent`,
    metadata: {
      category: "specialist",
      cost: "CHEAP",
      triggers: [{ domain, trigger }],
    },
  })

  it("returns empty string when no custom agents", () => {
    expect(buildCustomAgentDelegationSection([], new Set())).toBe("")
  })

  it("returns formatted section for custom agents", () => {
    const agents = [makeCustomAgent("code-reviewer", "Code Review", "Code quality review")]
    const result = buildCustomAgentDelegationSection(agents, new Set())
    expect(result).toContain("<CustomDelegation>")
    expect(result).toContain("</CustomDelegation>")
    expect(result).toContain("Code Review")
    expect(result).toContain("`code-reviewer`")
  })

  it("filters out disabled custom agents", () => {
    const agents = [
      makeCustomAgent("code-reviewer", "Code Review", "Quality review"),
      makeCustomAgent("doc-writer", "Documentation", "Write docs"),
    ]
    const result = buildCustomAgentDelegationSection(agents, new Set(["code-reviewer"]))
    expect(result).not.toContain("code-reviewer")
    expect(result).toContain("doc-writer")
  })

  it("returns empty string when all custom agents are disabled", () => {
    const agents = [makeCustomAgent("code-reviewer", "Code Review", "Quality review")]
    expect(buildCustomAgentDelegationSection(agents, new Set(["code-reviewer"]))).toBe("")
  })

  it("includes multiple custom agents in the table", () => {
    const agents = [
      makeCustomAgent("code-reviewer", "Code Review", "Quality review"),
      makeCustomAgent("compliance", "Compliance", "License checks"),
    ]
    const result = buildCustomAgentDelegationSection(agents, new Set())
    expect(result).toContain("`code-reviewer`")
    expect(result).toContain("`compliance`")
    expect(result).toContain("Code Review")
    expect(result).toContain("Compliance")
  })
})

describe("composeLoomPrompt with custom agents", () => {
  it("does not include CustomDelegation when no custom agents provided", () => {
    const prompt = composeLoomPrompt()
    expect(prompt).not.toContain("<CustomDelegation>")
  })

  it("does not include CustomDelegation when custom agents array is empty", () => {
    const prompt = composeLoomPrompt({ customAgents: [] })
    expect(prompt).not.toContain("<CustomDelegation>")
  })

  it("includes CustomDelegation section when custom agents provided", () => {
    const prompt = composeLoomPrompt({
      customAgents: [{
        name: "code-reviewer",
        description: "Reviews code quality",
        metadata: {
          category: "advisor",
          cost: "CHEAP",
          triggers: [{ domain: "Code Review", trigger: "Code quality review and best practices" }],
        },
      }],
    })
    expect(prompt).toContain("<CustomDelegation>")
    expect(prompt).toContain("Code Review")
    expect(prompt).toContain("`code-reviewer`")
    expect(prompt).toContain("</CustomDelegation>")
  })

  it("places CustomDelegation between DelegationNarration and PlanWorkflow", () => {
    const prompt = composeLoomPrompt({
      customAgents: [{
        name: "test-agent",
        description: "Test agent",
        metadata: {
          category: "specialist",
          cost: "CHEAP",
          triggers: [{ domain: "Testing", trigger: "Run tests" }],
        },
      }],
    })
    const narrationEnd = prompt.indexOf("</DelegationNarration>")
    const customStart = prompt.indexOf("<CustomDelegation>")
    const planStart = prompt.indexOf("<PlanWorkflow>")
    expect(customStart).toBeGreaterThan(narrationEnd)
    expect(customStart).toBeLessThan(planStart)
  })

  it("produces identical output to default when customAgents is empty", () => {
    const defaultPrompt = composeLoomPrompt()
    const withEmptyCustom = composeLoomPrompt({ customAgents: [] })
    expect(withEmptyCustom).toBe(defaultPrompt)
  })

  it("filters disabled custom agents from the section", () => {
    const prompt = composeLoomPrompt({
      customAgents: [
        {
          name: "code-reviewer",
          description: "Reviews code",
          metadata: {
            category: "advisor",
            cost: "CHEAP",
            triggers: [{ domain: "Code Review", trigger: "Quality review" }],
          },
        },
        {
          name: "doc-writer",
          description: "Writes docs",
          metadata: {
            category: "utility",
            cost: "CHEAP",
            triggers: [{ domain: "Docs", trigger: "Documentation writing" }],
          },
        },
      ],
      disabledAgents: new Set(["code-reviewer"]),
    })
    expect(prompt).toContain("<CustomDelegation>")
    expect(prompt).not.toContain("code-reviewer")
    expect(prompt).toContain("doc-writer")
  })

  it("omits CustomDelegation entirely when all custom agents are disabled", () => {
    const prompt = composeLoomPrompt({
      customAgents: [{
        name: "code-reviewer",
        description: "Reviews code",
        metadata: {
          category: "advisor",
          cost: "CHEAP",
          triggers: [{ domain: "Code Review", trigger: "Quality review" }],
        },
      }],
      disabledAgents: new Set(["code-reviewer"]),
    })
    expect(prompt).not.toContain("<CustomDelegation>")
  })
})
