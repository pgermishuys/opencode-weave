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

  it("PostExecutionReview mentions runtime-owned reviewer fan-out by default", () => {
    const prompt = composeTapestryPrompt()
    const reviewSection = prompt.slice(
      prompt.indexOf("<PostExecutionReview>"),
      prompt.indexOf("</PostExecutionReview>"),
    )
    expect(reviewSection).toContain("runtime reviewer fan-out runs automatically")
    expect(reviewSection).toContain("do not delegate terminal reviewers via Task tool")
  })
})

function getSection(prompt: string, tagName: string): string | null {
  const startTag = `<${tagName}>`
  const endTag = `</${tagName}>`
  const startIndex = prompt.indexOf(startTag)

  if (startIndex === -1) {
    return null
  }

  const endIndex = prompt.indexOf(endTag, startIndex)
  return prompt.slice(startIndex, endIndex + endTag.length)
}

describe("buildTapestryPostExecutionReviewSection", () => {
  it("includes both Weft and Warp by default", () => {
    const section = buildTapestryPostExecutionReviewSection(new Set())
    expect(section).toContain("Weft")
    expect(section).toContain("Warp")
    expect(section).toContain("runtime reviewer fan-out runs automatically")
  })

  it("includes only Weft when warp disabled", () => {
    const section = buildTapestryPostExecutionReviewSection(new Set(["warp"]))
    expect(section).toContain("Summarize Weft's findings")
    expect(section).not.toContain("Summarize Warp's findings")
    expect(section).toContain("Do not issue terminal reviewer Task calls")
  })

  it("includes only Warp when weft disabled", () => {
    const section = buildTapestryPostExecutionReviewSection(new Set(["weft"]))
    expect(section).toContain("Summarize Warp's findings")
    expect(section).not.toContain("Summarize Weft's findings")
    expect(section).toContain("Do not issue terminal reviewer Task calls")
  })

  it("does not enumerate visible review model variants as task delegates", () => {
    const section = buildTapestryPostExecutionReviewSection(new Set(), [
      {
        baseAgent: "weft" as const,
        key: "weft-review-opencode-go-kimi-k2-6",
        model: "opencode-go/kimi-k2.6",
        label: "weft @ opencode-go/kimi-k2.6",
      },
    ])

    expect(section).not.toContain('subagent_type "weft-review-opencode-go-kimi-k2-6"')
    expect(section).toContain("the Weave runtime spawns the configured variants and collates results automatically")
    expect(section).toContain("do not issue extra Task calls for them")
    expect(section).toContain("Do not issue terminal reviewer Task calls")
  })

  it("omits review delegation when both disabled", () => {
    const section = buildTapestryPostExecutionReviewSection(new Set(["weft", "warp"]))
    expect(section).not.toContain("Delegate to")
    expect(section).not.toContain("do not delegate terminal reviewers via Task tool")
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
    expect(section).toContain("explicit/manual-use only")
    expect(section).toContain("never auto-select from file matches")
  })

  it("returns a section when at least one category has patterns", () => {
    const section = buildTapestryCategoryRoutingSection({
      frontend: { patterns: ["*.tsx", "*.css"] },
    })
    expect(section).not.toBeNull()
    expect(section).toContain("<CategoryRouting>")
  })

  it("lists concrete shuttle category agent names for each category with patterns", () => {
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

  it("states overlapping file-pattern matches use the first category in config order", () => {
    const section = buildTapestryCategoryRoutingSection({
      frontend: { patterns: ["src/**"] },
      backend: { patterns: ["src/**/*.ts"] },
    })

    expect(section).not.toBeNull()
    expect(section).toContain(
      "Match task's **Files** against category patterns in config declaration order → use the first matching `shuttle-{category}`",
    )
    expect(section).toContain(
      "If multiple categories match the same task's files, the earliest declared matching category wins; later matches do not override earlier ones",
    )
  })

  it("includes fallback to generic shuttle", () => {
    const section = buildTapestryCategoryRoutingSection({
      frontend: { patterns: ["*.tsx"] },
    })
    expect(section).not.toBeNull()
    expect(section).toContain("shuttle")
    expect(section).toContain("fallback")
  })

  it("marks categories without patterns as manual-only even when other categories have patterns", () => {
    const section = buildTapestryCategoryRoutingSection({
      frontend: { patterns: ["*.tsx"] },
      backend: { model: "claude-opus-4" },
    })
    expect(section).not.toBeNull()
    expect(section).toContain("shuttle-frontend: patterns [*.tsx]")
    expect(section).toContain(
      "shuttle-backend: (no file patterns — explicit/manual-use only; never auto-select from file matches)",
    )
    expect(section).toContain(
      "Categories without file patterns are explicit/manual-use only and are never eligible for file-pattern auto-routing",
    )
  })

  it("omits file-pattern routing steps when all categories are manual-only", () => {
    const section = buildTapestryCategoryRoutingSection({
      backend: { model: "claude-opus-4" },
    })

    expect(section).not.toBeNull()
    expect(section).toContain("shuttle-backend")
    expect(section).toContain("explicit/manual-use only")
    expect(section).not.toContain("Match task's **Files** against category patterns in config declaration order")
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
    expect(prompt).toContain("explicit/manual-use only")
    expect(prompt).toContain("never eligible for file-pattern auto-routing")
  })

  it("keeps no-pattern categories out of delegation auto-routing examples", () => {
    const prompt = composeTapestryPrompt({
      categories: {
        frontend: { patterns: ["*.tsx"] },
        backend: { model: "claude-opus-4" },
      },
    })
    const delegationSection = getSection(prompt, "Delegation")
    expect(delegationSection).not.toBeNull()
    expect(delegationSection).toContain("shuttle-frontend")
    expect(delegationSection).not.toContain("shuttle-backend")
    expect(delegationSection).not.toContain("shuttle-{category}")
  })

  it("delegation section uses concrete category agent names when categories present", () => {
    const prompt = composeTapestryPrompt({
      categories: { frontend: { patterns: ["*.tsx"] } },
    })
    const delegationSection = getSection(prompt, "Delegation")
    expect(delegationSection).not.toBeNull()
    expect(delegationSection).toContain("shuttle-frontend")
    expect(delegationSection).not.toContain("shuttle-{category}")
  })

  it("delegation section uses plain shuttle when no categories", () => {
    const prompt = composeTapestryPrompt()
    const delegationSection = getSection(prompt, "Delegation")
    expect(delegationSection).not.toBeNull()
    expect(delegationSection).toContain('subagent_type="shuttle"')
    expect(delegationSection).not.toContain("shuttle-{category}")
  })

  it("manual-only categories keep plain shuttle delegation without placeholder names", () => {
    const prompt = composeTapestryPrompt({
      categories: { backend: { model: "claude-opus-4" } },
    })
    const categoryRoutingSection = getSection(prompt, "CategoryRouting")
    const delegationSection = getSection(prompt, "Delegation")

    expect(categoryRoutingSection).not.toBeNull()
    expect(categoryRoutingSection).toContain("shuttle-backend")
    expect(categoryRoutingSection).not.toContain("Match task's **Files** against category patterns in config declaration order")
    expect(delegationSection).not.toBeNull()
    expect(delegationSection).toContain('subagent_type="shuttle"')
    expect(delegationSection).not.toContain("shuttle-backend")
    expect(delegationSection).not.toContain("shuttle-{category}")
  })
})
