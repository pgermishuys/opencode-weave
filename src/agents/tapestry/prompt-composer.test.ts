import { describe, it, expect } from "bun:test"
import {
  composeTapestryPrompt,
  buildTapestryRoleSection,
  buildTapestryDisciplineSection,
  buildTapestrySidebarTodosSection,
  buildTapestryPlanExecutionSection,
  buildTapestryContinuationHintSection,
  buildTapestryVerificationSection,
  buildTapestryPostExecutionReviewSection,
  buildTapestryExecutionSection,
  buildTapestryStyleSection,
  buildTapestryDelegationSection,
  buildTapestryParallelismSection,
  buildTapestryErrorHandlingSection,
  buildTapestryCategoryRoutingSection,
} from "./prompt-composer"

describe("composeTapestryPrompt", () => {
  it("produces a non-empty prompt with default options", () => {
    const prompt = composeTapestryPrompt()
    expect(prompt.length).toBeGreaterThan(0)
  })

  it("contains all XML sections with no disabled agents", () => {
    const prompt = composeTapestryPrompt()
    expect(prompt).toContain("<Role>")
    expect(prompt).toContain("<Discipline>")
    expect(prompt).toContain("<SidebarTodos>")
    expect(prompt).toContain("<Delegation>")
    expect(prompt).toContain("<Parallelism>")
    expect(prompt).toContain("<PlanExecution>")
    expect(prompt).toContain("<Verification>")
    expect(prompt).toContain("<ErrorHandling>")
    expect(prompt).toContain("<PostExecutionReview>")
    expect(prompt).toContain("<Execution>")
    expect(prompt).toContain("<Style>")
    expect(prompt).not.toContain("<Continuation>")
  })

  it("adds a continuation hint section when compaction recovery is enabled", () => {
    const prompt = composeTapestryPrompt({
      continuation: {
        recovery: { compaction: true },
        idle: { enabled: false, work: false, workflow: false, todo_prompt: false },
      },
    })
    expect(prompt).toContain("<Continuation>")
    expect(prompt).toContain("persisted plan/workflow state")
  })

  it("PostExecutionReview includes Weft and Warp by default", () => {
    const prompt = composeTapestryPrompt()
    const reviewSection = prompt.slice(
      prompt.indexOf("<PostExecutionReview>"),
      prompt.indexOf("</PostExecutionReview>"),
    )
    expect(reviewSection).toContain("Weft")
    expect(reviewSection).toContain("Warp")
  })

  it("PostExecutionReview mentions Task tool by default", () => {
    const prompt = composeTapestryPrompt()
    const reviewSection = prompt.slice(
      prompt.indexOf("<PostExecutionReview>"),
      prompt.indexOf("</PostExecutionReview>"),
    )
    expect(reviewSection).toContain("Task tool")
  })
})

describe("buildTapestryPostExecutionReviewSection", () => {
  it("includes both Weft and Warp by default", () => {
    const section = buildTapestryPostExecutionReviewSection(new Set())
    expect(section).toContain("Weft")
    expect(section).toContain("Warp")
    expect(section).toContain("Task tool")
  })

  it("includes only Weft when warp disabled", () => {
    const section = buildTapestryPostExecutionReviewSection(new Set(["warp"]))
    expect(section).toContain("Weft")
    expect(section).not.toContain("Warp")
  })

  it("includes only Warp when weft disabled", () => {
    const section = buildTapestryPostExecutionReviewSection(new Set(["weft"]))
    expect(section).not.toContain("Weft")
    expect(section).toContain("Warp")
  })

  it("omits review delegation when both disabled", () => {
    const section = buildTapestryPostExecutionReviewSection(new Set(["weft", "warp"]))
    expect(section).not.toContain("Delegate to")
    expect(section).not.toContain("Task tool")
    expect(section).toContain("Report the summary")
  })

  it("contains do NOT attempt to fix with reviewers enabled", () => {
    const section = buildTapestryPostExecutionReviewSection(new Set())
    expect(section).toContain("do NOT attempt to fix")
  })

  it("contains user approval requirement with reviewers enabled", () => {
    const section = buildTapestryPostExecutionReviewSection(new Set())
    expect(section).toContain("user approval")
  })
})

describe("individual tapestry section builders", () => {
  it("buildTapestryRoleSection contains Tapestry identity", () => {
    expect(buildTapestryRoleSection()).toContain("Tapestry")
    expect(buildTapestryRoleSection()).toContain("coordination orchestrator")
  })

  it("buildTapestryDisciplineSection contains TODO OBSESSION", () => {
    expect(buildTapestryDisciplineSection()).toContain("TODO OBSESSION")
  })

  it("buildTapestrySidebarTodosSection contains format rules", () => {
    expect(buildTapestrySidebarTodosSection()).toContain("35 chars")
  })

  it("buildTapestrySidebarTodosSection contains BEFORE FINISHING mandatory block", () => {
    const section = buildTapestrySidebarTodosSection()
    expect(section).toContain("BEFORE FINISHING (MANDATORY)")
    expect(section).toContain("NON-NEGOTIABLE")
    expect(section).toContain("final todowrite")
  })

  it("buildTapestryPlanExecutionSection references Verification and terminal-state behavior", () => {
    const section = buildTapestryPlanExecutionSection()
    expect(section).toContain("Verification")
    expect(section).toContain("terminal-state behavior")
  })

  it("buildTapestryPlanExecutionSection mentions Weft by default", () => {
    const section = buildTapestryPlanExecutionSection()
    expect(section).toContain("Weft")
  })

  it("buildTapestryPlanExecutionSection omits Weft when disabled", () => {
    const section = buildTapestryPlanExecutionSection(new Set(["weft"]))
    expect(section).not.toContain("Weft")
    expect(section).toContain("Verification")
  })

  it("buildTapestryContinuationHintSection returns null when no resume paths are enabled", () => {
    expect(
      buildTapestryContinuationHintSection({
        recovery: { compaction: false },
        idle: { enabled: false, work: false, workflow: false, todo_prompt: true },
      }),
    ).toBeNull()
  })

  it("buildTapestryContinuationHintSection returns a hint when any resume path is enabled", () => {
    const section = buildTapestryContinuationHintSection({
      recovery: { compaction: false },
      idle: { enabled: false, work: true, workflow: false, todo_prompt: false },
    })
    expect(section).not.toBeNull()
    expect(section).toContain("resume from persisted plan/workflow state")
  })

  it("buildTapestryVerificationSection mentions acceptance criteria", () => {
    expect(buildTapestryVerificationSection()).toContain("acceptance criteria")
  })

  it("buildTapestryVerificationSection mentions Shuttle output inspection", () => {
    expect(buildTapestryVerificationSection()).toContain("Shuttle")
  })

  it("buildTapestryExecutionSection contains top to bottom", () => {
    expect(buildTapestryExecutionSection()).toContain("top to bottom")
  })

  it("buildTapestryStyleSection contains Dense > verbose", () => {
    expect(buildTapestryStyleSection()).toContain("Dense > verbose")
  })

  it("buildTapestryDelegationSection contains subagent_type shuttle", () => {
    const section = buildTapestryDelegationSection()
    expect(section).toContain("subagent_type")
    expect(section).toContain("shuttle")
  })

  it("buildTapestryDelegationSection contains delegation contract fields", () => {
    const section = buildTapestryDelegationSection()
    expect(section).toContain("What")
    expect(section).toContain("Files")
    expect(section).toContain("Acceptance")
  })

  it("buildTapestryParallelismSection contains file disjointness rule", () => {
    const section = buildTapestryParallelismSection()
    expect(section).toContain("disjoint")
    expect(section).toContain("3")
  })

  it("buildTapestryParallelismSection mentions max concurrency", () => {
    const section = buildTapestryParallelismSection()
    expect(section).toContain("Maximum 3 concurrent")
  })

  it("buildTapestryErrorHandlingSection contains retry logic", () => {
    const section = buildTapestryErrorHandlingSection()
    expect(section).toContain("Retry")
    expect(section).toContain("blocked")
  })

  it("buildTapestryErrorHandlingSection contains escalation after repeated failures", () => {
    const section = buildTapestryErrorHandlingSection()
    expect(section).toContain("Three or more consecutive failures")
    expect(section).toContain("report to the user")
  })
})

describe("buildTapestryCategoryRoutingSection", () => {
  it("returns null for empty categories and a section for categories without patterns", () => {
    expect(buildTapestryCategoryRoutingSection({})).toBeNull()
    const section = buildTapestryCategoryRoutingSection({ backend: { model: "claude-opus-4" } })
    expect(section).not.toBeNull()
    expect(section).toContain("shuttle-backend")
  })

  it("returns a section when at least one category has patterns", () => {
    const section = buildTapestryCategoryRoutingSection({
      frontend: { patterns: ["*.tsx", "*.css"] },
    })
    expect(section).not.toBeNull()
    expect(section).toContain("<CategoryRouting>")
  })

  it("includes shuttle-{category} agent name for each category with patterns", () => {
    const section = buildTapestryCategoryRoutingSection({
      frontend: { patterns: ["*.tsx"] },
      backend: { patterns: ["*.go"] },
    })
    expect(section).not.toBeNull()
    expect(section).toContain("shuttle-frontend")
    expect(section).toContain("shuttle-backend")
  })

  it("includes the file patterns for each category", () => {
    const section = buildTapestryCategoryRoutingSection({
      frontend: { patterns: ["src/components/**", "*.tsx", "*.css"] },
    })
    expect(section).not.toBeNull()
    expect(section).toContain("src/components/**")
    expect(section).toContain("*.tsx")
    expect(section).toContain("*.css")
  })

  it("includes routing priority instructions", () => {
    const section = buildTapestryCategoryRoutingSection({
      frontend: { patterns: ["*.tsx"] },
    })
    expect(section).not.toBeNull()
    expect(section).toContain("ROUTING PRIORITY")
    expect(section).toContain("[category:")
  })

  it("includes fallback to generic shuttle", () => {
    const section = buildTapestryCategoryRoutingSection({
      frontend: { patterns: ["*.tsx"] },
    })
    expect(section).not.toBeNull()
    expect(section).toContain("shuttle")
    expect(section).toContain("fallback")
  })
})

describe("composeTapestryPrompt with categories", () => {
  it("includes CategoryRouting section when categories with patterns provided", () => {
    const prompt = composeTapestryPrompt({
      categories: { frontend: { patterns: ["*.tsx"] } },
    })
    expect(prompt).toContain("<CategoryRouting>")
    expect(prompt).toContain("shuttle-frontend")
  })

  it("omits CategoryRouting section when no categories provided", () => {
    const prompt = composeTapestryPrompt()
    expect(prompt).not.toContain("<CategoryRouting>")
  })

  it("includes CategoryRouting section when categories have no patterns", () => {
    const prompt = composeTapestryPrompt({
      categories: { backend: { model: "claude-opus-4" } },
    })
    expect(prompt).toContain("<CategoryRouting>")
    expect(prompt).toContain("shuttle-backend")
  })

  it("delegation section uses concrete category agent names when categories present", () => {
    const prompt = composeTapestryPrompt({
      categories: { frontend: { patterns: ["*.tsx"] } },
    })
    const delegationSection = prompt.slice(prompt.indexOf("<Delegation>"), prompt.indexOf("</Delegation>"))
    expect(delegationSection).toContain("shuttle-frontend")
    expect(delegationSection).not.toContain("shuttle-{category}")
  })

  it("delegation section uses plain shuttle when no categories", () => {
    const prompt = composeTapestryPrompt()
    const delegationSection = prompt.slice(prompt.indexOf("<Delegation>"), prompt.indexOf("</Delegation>"))
    expect(delegationSection).toContain('subagent_type="shuttle"')
    expect(delegationSection).not.toContain("shuttle-{category}")
  })
})
