import type { WorkflowInstance, WorkflowDefinition, WorkflowStepDefinition } from "./types"

/**
 * Resolve template variables in a string.
 * Supports: {{instance.goal}}, {{instance.slug}}, {{artifacts.X}}, {{step.name}}, {{step.id}}
 * Unknown variables are left as-is.
 */
export function resolveTemplate(
  template: string,
  instance: WorkflowInstance,
  definition: WorkflowDefinition,
): string {
  return template.replace(/\{\{(\w+)\.(\w+)\}\}/g, (_match, namespace: string, key: string) => {
    switch (namespace) {
      case "instance": {
        const instanceRecord = instance as unknown as Record<string, unknown>
        const value = instanceRecord[key]
        return typeof value === "string" ? value : _match
      }
      case "artifacts": {
        const value = instance.artifacts[key]
        return value ?? "(not yet available)"
      }
      case "step": {
        const currentStep = definition.steps.find((s) => s.id === instance.current_step_id)
        if (!currentStep) return _match
        const stepRecord = currentStep as unknown as Record<string, unknown>
        const value = stepRecord[key]
        return typeof value === "string" ? value : _match
      }
      default:
        return _match
    }
  })
}

/**
 * Build the workflow context header showing goal, step history, and accumulated artifacts.
 */
export function buildContextHeader(
  instance: WorkflowInstance,
  definition: WorkflowDefinition,
): string {
  const currentStepIndex = definition.steps.findIndex((s) => s.id === instance.current_step_id)
  const currentStepDef = definition.steps[currentStepIndex]
  const stepLabel = currentStepDef
    ? `step ${currentStepIndex + 1} of ${definition.steps.length}: ${currentStepDef.name}`
    : `step ${currentStepIndex + 1} of ${definition.steps.length}`

  const lines: string[] = []
  lines.push("## Workflow Context")
  lines.push(`**Goal**: "${instance.goal}"`)
  lines.push(`**Workflow**: ${definition.name} (${stepLabel})`)
  lines.push("")

  // Completed steps
  const completedSteps = definition.steps.filter((s) => {
    const state = instance.steps[s.id]
    return state && state.status === "completed"
  })

  if (completedSteps.length > 0) {
    lines.push("### Completed Steps")
    for (const stepDef of completedSteps) {
      const state = instance.steps[stepDef.id]
      const summary = state.summary ? ` → "${truncateSummary(state.summary)}"` : ""
      lines.push(`- [✓] **${stepDef.name}**${summary}`)
    }
    lines.push("")
  }

  // Accumulated artifacts
  const artifactEntries = Object.entries(instance.artifacts)
  if (artifactEntries.length > 0) {
    lines.push("### Accumulated Artifacts")
    for (const [name, value] of artifactEntries) {
      lines.push(`- **${name}**: "${truncateSummary(value)}"`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

/**
 * Build the full context-threaded prompt for a step.
 * Combines: (1) workflow context header, (2) resolved step prompt.
 */
export function composeStepPrompt(
  stepDef: WorkflowStepDefinition,
  instance: WorkflowInstance,
  definition: WorkflowDefinition,
): string {
  const contextHeader = buildContextHeader(instance, definition)
  const resolvedPrompt = resolveTemplate(stepDef.prompt, instance, definition)

  return `${contextHeader}---

## Your Task
${resolvedPrompt}`
}

/**
 * Truncate a summary string to ~200 chars for context threading.
 */
function truncateSummary(text: string): string {
  const maxLength = 200
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 3) + "..."
}
