import { describe, it, expect } from "bun:test"
import {
  composeTapestryPrompt,
  buildTapestryRoleSection,
  buildTapestryDisciplineSection,
  buildTapestrySidebarTodosSection,
  buildTapestryPlanExecutionSection,
  buildTapestryVerificationSection,
  buildTapestryPostExecutionReviewSection,
  buildTapestryExecutionSection,
  buildTapestryStyleSection,
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
    expect(prompt).toContain("<PlanExecution>")
    expect(prompt).toContain("<Verification>")
    expect(prompt).toContain("<PostExecutionReview>")
    expect(prompt).toContain("<Execution>")
    expect(prompt).toContain("<Style>")
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
    expect(buildTapestryRoleSection()).toContain("execution orchestrator")
  })

  it("buildTapestryDisciplineSection contains TODO OBSESSION", () => {
    expect(buildTapestryDisciplineSection()).toContain("TODO OBSESSION")
  })

  it("buildTapestrySidebarTodosSection contains format rules", () => {
    expect(buildTapestrySidebarTodosSection()).toContain("35 chars")
  })

  it("buildTapestryPlanExecutionSection references Verification and PostExecutionReview", () => {
    const section = buildTapestryPlanExecutionSection()
    expect(section).toContain("Verification")
    expect(section).toContain("PostExecutionReview")
  })

  it("buildTapestryVerificationSection mentions acceptance criteria", () => {
    expect(buildTapestryVerificationSection()).toContain("acceptance criteria")
  })

  it("buildTapestryVerificationSection mentions Edit/Write tool call history", () => {
    expect(buildTapestryVerificationSection()).toContain("Edit/Write tool call history")
  })

  it("buildTapestryExecutionSection contains top to bottom", () => {
    expect(buildTapestryExecutionSection()).toContain("top to bottom")
  })

  it("buildTapestryStyleSection contains Dense > verbose", () => {
    expect(buildTapestryStyleSection()).toContain("Dense > verbose")
  })
})
