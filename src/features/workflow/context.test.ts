import { describe, it, expect } from "bun:test"
import { resolveTemplate, buildContextHeader, composeStepPrompt } from "./context"
import type { WorkflowInstance, WorkflowDefinition, WorkflowStepDefinition } from "./types"

const SAMPLE_DEFINITION: WorkflowDefinition = {
  name: "secure-feature",
  version: 1,
  steps: [
    {
      id: "gather",
      name: "Gather Requirements",
      type: "interactive",
      agent: "loom",
      prompt: "Gather requirements for: {{instance.goal}}",
      completion: { method: "user_confirm" },
    },
    {
      id: "plan",
      name: "Create Plan",
      type: "autonomous",
      agent: "pattern",
      prompt: "Create a plan at .weave/plans/{{instance.slug}}.md based on {{artifacts.spec}}",
      completion: { method: "plan_created", plan_name: "{{instance.slug}}" },
    },
    {
      id: "review",
      name: "Plan Review",
      type: "gate",
      agent: "weft",
      prompt: "Review the plan at {{artifacts.plan_path}}.",
      completion: { method: "review_verdict" },
      on_reject: "pause",
    },
  ],
}

function makeInstance(overrides: Partial<WorkflowInstance> = {}): WorkflowInstance {
  return {
    instance_id: "wf_12345678",
    definition_id: "secure-feature",
    definition_name: "secure-feature",
    definition_path: "/path/test.jsonc",
    goal: "Add OAuth2 login with Google and GitHub",
    slug: "add-oauth2-login-with-google-and-github",
    status: "running",
    started_at: "2026-01-01T00:00:00Z",
    session_ids: ["sess_1"],
    current_step_id: "gather",
    steps: {
      gather: { id: "gather", status: "active", started_at: "2026-01-01T00:00:00Z" },
      plan: { id: "plan", status: "pending" },
      review: { id: "review", status: "pending" },
    },
    artifacts: {},
    ...overrides,
  }
}

describe("resolveTemplate", () => {
  it("resolves instance.goal", () => {
    const instance = makeInstance()
    const result = resolveTemplate("Goal: {{instance.goal}}", instance, SAMPLE_DEFINITION)
    expect(result).toBe("Goal: Add OAuth2 login with Google and GitHub")
  })

  it("resolves instance.slug", () => {
    const instance = makeInstance()
    const result = resolveTemplate("Slug: {{instance.slug}}", instance, SAMPLE_DEFINITION)
    expect(result).toBe("Slug: add-oauth2-login-with-google-and-github")
  })

  it("resolves artifacts", () => {
    const instance = makeInstance({ artifacts: { spec: "Users need OAuth2" } })
    const result = resolveTemplate("Spec: {{artifacts.spec}}", instance, SAMPLE_DEFINITION)
    expect(result).toBe("Spec: Users need OAuth2")
  })

  it("shows (not yet available) for missing artifacts", () => {
    const instance = makeInstance()
    const result = resolveTemplate("Path: {{artifacts.plan_path}}", instance, SAMPLE_DEFINITION)
    expect(result).toBe("Path: (not yet available)")
  })

  it("resolves step.name for current step", () => {
    const instance = makeInstance()
    const result = resolveTemplate("Step: {{step.name}}", instance, SAMPLE_DEFINITION)
    expect(result).toBe("Step: Gather Requirements")
  })

  it("leaves unknown namespaces as-is", () => {
    const instance = makeInstance()
    const result = resolveTemplate("{{unknown.field}}", instance, SAMPLE_DEFINITION)
    expect(result).toBe("{{unknown.field}}")
  })

  it("leaves unknown instance fields as-is", () => {
    const instance = makeInstance()
    const result = resolveTemplate("{{instance.nonexistent}}", instance, SAMPLE_DEFINITION)
    expect(result).toBe("{{instance.nonexistent}}")
  })

  it("handles multiple variables in one string", () => {
    const instance = makeInstance({ artifacts: { spec: "OAuth2 spec" } })
    const result = resolveTemplate(
      "Goal={{instance.goal}}, Slug={{instance.slug}}, Spec={{artifacts.spec}}",
      instance,
      SAMPLE_DEFINITION,
    )
    expect(result).toContain("Goal=Add OAuth2 login")
    expect(result).toContain("Slug=add-oauth2-login")
    expect(result).toContain("Spec=OAuth2 spec")
  })

  it("handles text with no variables", () => {
    const instance = makeInstance()
    const result = resolveTemplate("No variables here.", instance, SAMPLE_DEFINITION)
    expect(result).toBe("No variables here.")
  })
})

describe("buildContextHeader", () => {
  it("includes goal and workflow name for first step", () => {
    const instance = makeInstance()
    const header = buildContextHeader(instance, SAMPLE_DEFINITION)
    expect(header).toContain("Add OAuth2 login with Google and GitHub")
    expect(header).toContain("secure-feature")
    expect(header).toContain("step 1 of 3")
    expect(header).toContain("Gather Requirements")
  })

  it("does not include completed steps section when none are completed", () => {
    const instance = makeInstance()
    const header = buildContextHeader(instance, SAMPLE_DEFINITION)
    expect(header).not.toContain("### Completed Steps")
  })

  it("does not include artifacts section when empty", () => {
    const instance = makeInstance()
    const header = buildContextHeader(instance, SAMPLE_DEFINITION)
    expect(header).not.toContain("### Accumulated Artifacts")
  })

  it("includes completed steps with summaries", () => {
    const instance = makeInstance({
      current_step_id: "plan",
      steps: {
        gather: {
          id: "gather",
          status: "completed",
          started_at: "2026-01-01T00:00:00Z",
          completed_at: "2026-01-01T01:00:00Z",
          summary: "Users need OAuth2 login with PKCE",
        },
        plan: { id: "plan", status: "active", started_at: "2026-01-01T01:00:00Z" },
        review: { id: "review", status: "pending" },
      },
    })
    const header = buildContextHeader(instance, SAMPLE_DEFINITION)
    expect(header).toContain("### Completed Steps")
    expect(header).toContain("[✓] **Gather Requirements**")
    expect(header).toContain("Users need OAuth2 login with PKCE")
    expect(header).toContain("step 2 of 3")
  })

  it("includes accumulated artifacts", () => {
    const instance = makeInstance({
      current_step_id: "review",
      artifacts: {
        spec: "Users need OAuth2 login",
        plan_path: ".weave/plans/add-oauth2.md",
      },
    })
    const header = buildContextHeader(instance, SAMPLE_DEFINITION)
    expect(header).toContain("### Accumulated Artifacts")
    expect(header).toContain("**spec**")
    expect(header).toContain("**plan_path**")
  })

  it("truncates long summaries", () => {
    const longSummary = "x".repeat(300)
    const instance = makeInstance({
      current_step_id: "plan",
      steps: {
        gather: {
          id: "gather",
          status: "completed",
          summary: longSummary,
        },
        plan: { id: "plan", status: "active" },
        review: { id: "review", status: "pending" },
      },
    })
    const header = buildContextHeader(instance, SAMPLE_DEFINITION)
    expect(header).toContain("...")
    // Should be truncated, not full 300 chars
    expect(header.length).toBeLessThan(longSummary.length + 200)
  })
})

describe("composeStepPrompt", () => {
  it("combines context header and resolved prompt for first step", () => {
    const instance = makeInstance()
    const stepDef = SAMPLE_DEFINITION.steps[0]
    const prompt = composeStepPrompt(stepDef, instance, SAMPLE_DEFINITION)

    expect(prompt).toContain("## Workflow Context")
    expect(prompt).toContain("Add OAuth2 login with Google and GitHub")
    expect(prompt).toContain("---")
    expect(prompt).toContain("## Your Task")
    expect(prompt).toContain("Gather requirements for: Add OAuth2 login with Google and GitHub")
  })

  it("includes prior step context for later steps", () => {
    const instance = makeInstance({
      current_step_id: "review",
      steps: {
        gather: {
          id: "gather",
          status: "completed",
          summary: "Users need OAuth2 with PKCE",
        },
        plan: {
          id: "plan",
          status: "completed",
          summary: "Plan saved to .weave/plans/add-oauth2.md",
        },
        review: { id: "review", status: "active" },
      },
      artifacts: {
        spec: "Users need OAuth2 login",
        plan_path: ".weave/plans/add-oauth2.md",
      },
    })
    const stepDef = SAMPLE_DEFINITION.steps[2]
    const prompt = composeStepPrompt(stepDef, instance, SAMPLE_DEFINITION)

    // Should have completed steps
    expect(prompt).toContain("[✓] **Gather Requirements**")
    expect(prompt).toContain("[✓] **Create Plan**")
    // Should have resolved artifact
    expect(prompt).toContain("Review the plan at .weave/plans/add-oauth2.md")
    // Should show step 3 of 3
    expect(prompt).toContain("step 3 of 3")
  })

  it("resolves multiple template variables in prompt", () => {
    const instance = makeInstance({
      current_step_id: "plan",
      artifacts: { spec: "OAuth2 requirements" },
      steps: {
        gather: { id: "gather", status: "completed" },
        plan: { id: "plan", status: "active" },
        review: { id: "review", status: "pending" },
      },
    })
    const stepDef = SAMPLE_DEFINITION.steps[1]
    const prompt = composeStepPrompt(stepDef, instance, SAMPLE_DEFINITION)

    expect(prompt).toContain("add-oauth2-login-with-google-and-github")
    expect(prompt).toContain("OAuth2 requirements")
  })
})
