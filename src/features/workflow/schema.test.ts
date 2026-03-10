import { describe, it, expect } from "bun:test"
import { WorkflowDefinitionSchema } from "./schema"

const VALID_DEFINITION = {
  name: "secure-feature",
  description: "Plan, build, review, and security-audit a new feature",
  version: 1,
  steps: [
    {
      id: "gather",
      name: "Gather Requirements",
      type: "interactive",
      agent: "loom",
      prompt: "Gather requirements for: {{instance.goal}}",
      completion: { method: "user_confirm" },
      artifacts: {
        outputs: [{ name: "spec", description: "Feature specification" }],
      },
    },
    {
      id: "plan",
      name: "Create Plan",
      type: "autonomous",
      agent: "pattern",
      prompt: "Create a plan based on the spec.",
      completion: { method: "plan_created", plan_name: "{{instance.slug}}" },
      artifacts: {
        inputs: [{ name: "spec" }],
        outputs: [{ name: "plan_path", description: "Path to the plan file" }],
      },
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

describe("WorkflowDefinitionSchema", () => {
  it("validates a correct workflow definition", () => {
    const result = WorkflowDefinitionSchema.safeParse(VALID_DEFINITION)
    expect(result.success).toBe(true)
  })

  it("validates minimal definition with one step", () => {
    const minimal = {
      name: "simple",
      version: 1,
      steps: [
        {
          id: "do-it",
          name: "Do It",
          type: "autonomous",
          agent: "tapestry",
          prompt: "Do the thing.",
          completion: { method: "agent_signal" },
        },
      ],
    }
    const result = WorkflowDefinitionSchema.safeParse(minimal)
    expect(result.success).toBe(true)
  })

  it("rejects missing name", () => {
    const invalid = { ...VALID_DEFINITION, name: undefined }
    const result = WorkflowDefinitionSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it("rejects uppercase name", () => {
    const invalid = { ...VALID_DEFINITION, name: "SecureFeature" }
    const result = WorkflowDefinitionSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it("rejects name starting with number", () => {
    const invalid = { ...VALID_DEFINITION, name: "1-feature" }
    const result = WorkflowDefinitionSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it("rejects non-integer version", () => {
    const invalid = { ...VALID_DEFINITION, version: 1.5 }
    const result = WorkflowDefinitionSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it("rejects zero version", () => {
    const invalid = { ...VALID_DEFINITION, version: 0 }
    const result = WorkflowDefinitionSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it("rejects negative version", () => {
    const invalid = { ...VALID_DEFINITION, version: -1 }
    const result = WorkflowDefinitionSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it("rejects empty steps array", () => {
    const invalid = { ...VALID_DEFINITION, steps: [] }
    const result = WorkflowDefinitionSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it("rejects step with invalid type", () => {
    const invalid = {
      ...VALID_DEFINITION,
      steps: [
        { ...VALID_DEFINITION.steps[0], type: "unknown" },
      ],
    }
    const result = WorkflowDefinitionSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it("rejects step with invalid completion method", () => {
    const invalid = {
      ...VALID_DEFINITION,
      steps: [
        {
          ...VALID_DEFINITION.steps[0],
          completion: { method: "invalid_method" },
        },
      ],
    }
    const result = WorkflowDefinitionSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it("rejects step with uppercase ID", () => {
    const invalid = {
      ...VALID_DEFINITION,
      steps: [
        { ...VALID_DEFINITION.steps[0], id: "GatherReqs" },
      ],
    }
    const result = WorkflowDefinitionSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it("rejects step with invalid on_reject", () => {
    const invalid = {
      ...VALID_DEFINITION,
      steps: [
        { ...VALID_DEFINITION.steps[2], on_reject: "retry" },
      ],
    }
    const result = WorkflowDefinitionSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it("accepts step without optional fields", () => {
    const minimal = {
      name: "test",
      version: 1,
      steps: [
        {
          id: "step-one",
          name: "Step One",
          type: "autonomous",
          agent: "loom",
          prompt: "Do it.",
          completion: { method: "agent_signal" },
        },
      ],
    }
    const result = WorkflowDefinitionSchema.safeParse(minimal)
    expect(result.success).toBe(true)
  })

  it("accepts completion config with optional plan_name", () => {
    const def = {
      name: "test",
      version: 1,
      steps: [
        {
          id: "plan",
          name: "Plan",
          type: "autonomous",
          agent: "pattern",
          prompt: "Plan it.",
          completion: { method: "plan_created", plan_name: "my-plan" },
        },
      ],
    }
    const result = WorkflowDefinitionSchema.safeParse(def)
    expect(result.success).toBe(true)
  })

  it("accepts completion config with optional keywords", () => {
    const def = {
      name: "test",
      version: 1,
      steps: [
        {
          id: "confirm",
          name: "Confirm",
          type: "interactive",
          agent: "loom",
          prompt: "Confirm.",
          completion: { method: "user_confirm", keywords: ["yes", "go"] },
        },
      ],
    }
    const result = WorkflowDefinitionSchema.safeParse(def)
    expect(result.success).toBe(true)
  })

  it("accepts description as optional", () => {
    const withoutDesc = { ...VALID_DEFINITION }
    delete (withoutDesc as Record<string, unknown>).description
    const result = WorkflowDefinitionSchema.safeParse(withoutDesc)
    expect(result.success).toBe(true)
  })

  it("rejects missing steps field", () => {
    const invalid = { name: "test", version: 1 }
    const result = WorkflowDefinitionSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it("provides clear error message for invalid name", () => {
    const invalid = { ...VALID_DEFINITION, name: "BAD NAME!" }
    const result = WorkflowDefinitionSchema.safeParse(invalid)
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message)
      expect(messages.some((m) => m.includes("lowercase") || m.includes("alphanumeric") || m.includes("invalid"))).toBe(true)
    }
  })
})
