import { z } from "zod"

/**
 * Zod schema for step completion configuration in workflow definitions.
 */
export const CompletionConfigSchema = z.object({
  method: z.enum(["user_confirm", "plan_created", "plan_complete", "review_verdict", "agent_signal"]),
  plan_name: z.string().optional(),
  keywords: z.array(z.string()).optional(),
})

/**
 * Zod schema for artifact references.
 */
export const ArtifactRefSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
})

/**
 * Zod schema for step artifact declarations.
 */
export const StepArtifactsSchema = z.object({
  inputs: z.array(ArtifactRefSchema).optional(),
  outputs: z.array(ArtifactRefSchema).optional(),
})

/**
 * Zod schema for a workflow step definition.
 */
export const WorkflowStepSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, "Step ID must be lowercase alphanumeric with hyphens"),
  name: z.string(),
  type: z.enum(["interactive", "autonomous", "gate"]),
  agent: z.string(),
  prompt: z.string(),
  completion: CompletionConfigSchema,
  artifacts: StepArtifactsSchema.optional(),
  on_reject: z.enum(["pause", "fail"]).optional(),
})

/**
 * Zod schema for a complete workflow definition file.
 */
export const WorkflowDefinitionSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, "Workflow name must be lowercase alphanumeric with hyphens"),
  description: z.string().optional(),
  version: z.number().int().positive(),
  steps: z.array(WorkflowStepSchema).min(1, "Workflow must have at least one step"),
})
