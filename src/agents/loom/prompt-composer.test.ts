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
  buildCategoryRoutingSection,
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

  it("preserves Warp security language with no disabled agents", () => {
    const prompt = composeLoomPrompt()
    expect(prompt).toContain("MUST use Warp")
    expect(prompt).toContain("Warp is mandatory")
  })

  it("preserves review trigger conditions", () => {
    const prompt = composeLoomPrompt()
    expect(prompt).toContain("3+ files")
  })

  it("contains plan execution routing in PlanWorkflow", () => {
    const prompt = composeLoomPrompt()
    expect(prompt).toContain("Plans are executed by Tapestry")
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

  it("clarifies Pattern versus Shuttle routing boundary", () => {
    const section = buildDelegationSection(new Set())
    expect(section).toContain("planning, scoping, and work breakdown")
    expect(section).toContain("domain expertise rather than planning or scoping")
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
  it("contains plan routing statement", () => {
    const section = buildPlanWorkflowSection(new Set())
    expect(section).toContain("Plans are executed by Tapestry")
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

  it("includes Warp in review step for security-relevant plans", () => {
    const section = buildPlanWorkflowSection(new Set())
    expect(section).toContain("Warp for security-relevant plans")
  })

  it("omits Warp from review when warp disabled", () => {
    const section = buildPlanWorkflowSection(new Set(["warp"]))
    expect(section).not.toContain("Warp")
  })
})

describe("buildReviewWorkflowSection", () => {
  it("returns empty string when both weft and warp disabled", () => {
    const section = buildReviewWorkflowSection(new Set(["weft", "warp"]))
    expect(section).toBe("")
  })

  it("includes ad-hoc review section by default", () => {
    const section = buildReviewWorkflowSection(new Set())
    expect(section).toContain("Ad-hoc review")
    expect(section).toContain("Weft")
  })

  it("includes Warp mandatory line when warp enabled", () => {
    const section = buildReviewWorkflowSection(new Set())
    expect(section).toContain("Warp is mandatory")
  })

  it("omits tapestry-dependent content gracefully", () => {
    // Review section no longer depends on tapestry — output is the same either way
    const withTapestry = buildReviewWorkflowSection(new Set())
    const withoutTapestry = buildReviewWorkflowSection(new Set(["tapestry"]))
    expect(withTapestry).toBe(withoutTapestry)
  })

  it("contains Warp mandatory language when warp enabled", () => {
    const section = buildReviewWorkflowSection(new Set())
    expect(section).toContain("Warp is mandatory")
    expect(section).toContain("auth")
    expect(section).toContain("crypto")
  })

  it("omits warp section when warp disabled", () => {
    const section = buildReviewWorkflowSection(new Set(["warp"]))
    expect(section).not.toContain("MUST run Warp")
  })

  it("contains key security trigger keywords when warp enabled", () => {
    const section = buildReviewWorkflowSection(new Set())
    const triggers = ["crypto", "auth", "tokens", "secrets", "input validation"]
    for (const trigger of triggers) {
      expect(section).toContain(trigger)
    }
  })
})

describe("individual section builders", () => {
  it("buildRoleSection contains Loom identity", () => {
    expect(buildRoleSection()).toContain("Loom")
    expect(buildRoleSection()).toContain("coordinator")
  })

  it("buildDisciplineSection contains work tracking rules", () => {
    expect(buildDisciplineSection()).toContain("WORK TRACKING")
  })

  it("buildDisciplineSection contains plan routing note", () => {
    const section = buildDisciplineSection()
    expect(section).toContain("/start-work")
    expect(section).toContain("Tapestry")
  })

  it("buildSidebarTodosSection contains format rules", () => {
    expect(buildSidebarTodosSection()).toContain("35 chars")
  })

  it("buildSidebarTodosSection contains stale-items rule", () => {
    const section = buildSidebarTodosSection()
    expect(section).toContain("never leave stale in_progress")
    expect(section).toContain("BEFORE each Task tool call")
  })

  it("buildDelegationNarrationSection contains slow-agent note", () => {
    const section = buildDelegationNarrationSection()
    expect(section).toContain("which agent you're delegating to by name")
    expect(section).toContain("can be slow")
    expect(section).toContain("Pattern")
    expect(section).toContain("Spindle")
  })

  it("buildDelegationNarrationSection omits Pattern from slow agents when disabled", () => {
    const section = buildDelegationNarrationSection(new Set(["pattern"]))
    expect(section).not.toContain("Pattern")
    expect(section).toContain("Spindle")
  })

  it("buildDelegationNarrationSection omits slow-agent note when all slow agents disabled", () => {
    const section = buildDelegationNarrationSection(new Set(["pattern", "spindle", "weft", "warp"]))
    expect(section).not.toContain("can be slow")
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

describe("buildCategoryRoutingSection", () => {
  it("returns empty string when categories is undefined", () => {
    expect(buildCategoryRoutingSection(undefined, new Set())).toBe("")
  })

  it("returns empty string when categories is empty", () => {
    expect(buildCategoryRoutingSection({}, new Set())).toBe("")
  })

  it("returns non-empty string when categories have no patterns", () => {
    const cats = { frontend: { description: "Frontend work" } }
    const result = buildCategoryRoutingSection(cats, new Set())
    expect(result).toContain("<CategoryRouting>")
    expect(result).toContain("`shuttle-frontend`")
  })

  it("returns empty string when shuttle is disabled", () => {
    const cats = { frontend: { patterns: ["src/ui/**"] } }
    expect(buildCategoryRoutingSection(cats, new Set(["shuttle"]))).toBe("")
  })

  it("includes shuttle-{category} agent for categories with patterns", () => {
    const cats = { frontend: { patterns: ["src/ui/**", "*.css"] } }
    const result = buildCategoryRoutingSection(cats, new Set())
    expect(result).toContain("<CategoryRouting>")
    expect(result).toContain("`shuttle-frontend`")
    expect(result).toContain("src/ui/**")
    expect(result).toContain("*.css")
    expect(result).toContain("</CategoryRouting>")
  })

  it("includes category description when provided", () => {
    const cats = { backend: { description: "Backend API work", patterns: ["src/api/**"] } }
    const result = buildCategoryRoutingSection(cats, new Set())
    expect(result).toContain("Backend API work")
    expect(result).toContain("`shuttle-backend`")
  })

  it("omits disabled category shuttle agents", () => {
    const cats = {
      frontend: { patterns: ["src/ui/**"] },
      backend: { patterns: ["src/api/**"] },
    }
    const result = buildCategoryRoutingSection(cats, new Set(["shuttle-frontend"]))
    expect(result).not.toContain("shuttle-frontend")
    expect(result).toContain("`shuttle-backend`")
  })

  it("returns empty string when all category agents are disabled", () => {
    const cats = { frontend: { patterns: ["src/ui/**"] } }
    expect(buildCategoryRoutingSection(cats, new Set(["shuttle-frontend"]))).toBe("")
  })

  it("lists categories without patterns in an 'Also available' subsection", () => {
    const cats = {
      frontend: { description: "UI", patterns: ["src/ui/**"] },
      docs: { description: "Docs only" },
    }
    const result = buildCategoryRoutingSection(cats, new Set())
    expect(result).toContain("`shuttle-frontend`")
    expect(result).toContain("Also available")
    expect(result).toContain("`shuttle-docs`")
  })
})

describe("composeLoomPrompt with categories", () => {
  it("does not include CategoryRouting when no categories provided", () => {
    const prompt = composeLoomPrompt()
    expect(prompt).not.toContain("<CategoryRouting>")
  })

  it("includes CategoryRouting even when categories have no patterns", () => {
    const prompt = composeLoomPrompt({ categories: { frontend: { description: "UI" } } })
    expect(prompt).toContain("<CategoryRouting>")
    expect(prompt).toContain("shuttle-frontend")
  })

  it("includes CategoryRouting when categories with patterns are configured", () => {
    const prompt = composeLoomPrompt({
      categories: { frontend: { patterns: ["src/ui/**"] } },
    })
    expect(prompt).toContain("<CategoryRouting>")
    expect(prompt).toContain("`shuttle-frontend`")
    expect(prompt).toContain("src/ui/**")
  })

  it("places CategoryRouting after DelegationNarration and before PlanWorkflow", () => {
    const prompt = composeLoomPrompt({
      categories: { frontend: { patterns: ["src/ui/**"] } },
    })
    const narrationEnd = prompt.indexOf("</DelegationNarration>")
    const categoryStart = prompt.indexOf("<CategoryRouting>")
    const planStart = prompt.indexOf("<PlanWorkflow>")
    expect(categoryStart).toBeGreaterThan(narrationEnd)
    expect(categoryStart).toBeLessThan(planStart)
  })

  it("produces identical output to default when categories is undefined", () => {
    const defaultPrompt = composeLoomPrompt()
    const withUndefined = composeLoomPrompt({ categories: undefined })
    expect(withUndefined).toBe(defaultPrompt)
  })

  it("differs from default output when categories with no patterns are provided", () => {
    const defaultPrompt = composeLoomPrompt()
    const withNoPatterned = composeLoomPrompt({ categories: { frontend: {} } })
    expect(withNoPatterned).not.toBe(defaultPrompt)
  })
})
