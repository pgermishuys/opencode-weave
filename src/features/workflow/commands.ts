/**
 * Workflow control sub-commands: keyword detection in user messages during active workflows.
 * These are NOT separate slash commands — they're natural language keywords detected in chat.message.
 */

import { pauseWorkflow, skipStep, abortWorkflow } from "./engine"
import { getActiveWorkflowInstance } from "./storage"
import { loadWorkflowDefinition } from "./discovery"
import type { WorkflowInstance } from "./types"

export interface WorkflowCommandResult {
  /** Whether a workflow control keyword was detected and handled */
  handled: boolean
  /** Context to inject into the response */
  contextInjection?: string
  /** Agent to switch to (if any) */
  switchAgent?: string
}

/** Keyword patterns for workflow control commands */
const PAUSE_PATTERNS = [/\bworkflow\s+pause\b/i, /\bpause\s+workflow\b/i]
const SKIP_PATTERNS = [/\bworkflow\s+skip\b/i, /\bskip\s+step\b/i]
const ABORT_PATTERNS = [/\bworkflow\s+abort\b/i, /\babort\s+workflow\b/i]
const STATUS_PATTERNS = [/\bworkflow\s+status\b/i]

/**
 * Check if a user message contains a workflow control keyword and handle it.
 * Only active when a workflow instance is running.
 */
export function handleWorkflowCommand(
  message: string,
  directory: string,
): WorkflowCommandResult {
  const instance = getActiveWorkflowInstance(directory)
  if (!instance) return { handled: false }

  const trimmed = message.trim()

  // Check each pattern set in order
  if (matchesAny(trimmed, PAUSE_PATTERNS)) {
    return handlePause(directory, instance)
  }

  if (matchesAny(trimmed, SKIP_PATTERNS)) {
    return handleSkip(directory, instance)
  }

  if (matchesAny(trimmed, ABORT_PATTERNS)) {
    return handleAbort(directory, instance)
  }

  if (matchesAny(trimmed, STATUS_PATTERNS)) {
    return handleStatus(directory, instance)
  }

  return { handled: false }
}

// ─── Private helpers ────────────────────────────────────────────────────────

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text))
}

function handlePause(directory: string, instance: WorkflowInstance): WorkflowCommandResult {
  if (instance.status !== "running") {
    return {
      handled: true,
      contextInjection: `## Workflow Not Running\nThe workflow "${instance.definition_name}" is currently ${instance.status}. Cannot pause.`,
    }
  }

  pauseWorkflow(directory, "Paused by user command")
  return {
    handled: true,
    contextInjection: `## Workflow Paused\nWorkflow "${instance.definition_name}" has been paused.\nGoal: "${instance.goal}"\nCurrent step: ${instance.current_step_id}\n\nTo resume, run \`/run-workflow\`.`,
  }
}

function handleSkip(directory: string, instance: WorkflowInstance): WorkflowCommandResult {
  if (instance.status !== "running") {
    return {
      handled: true,
      contextInjection: `## Workflow Not Running\nThe workflow "${instance.definition_name}" is currently ${instance.status}. Cannot skip step.`,
    }
  }

  const currentStepId = instance.current_step_id
  const action = skipStep(directory)

  if (action.type === "inject_prompt") {
    return {
      handled: true,
      contextInjection: `## Step Skipped\nSkipped step "${currentStepId}".\n\n${action.prompt}`,
      switchAgent: action.agent,
    }
  }

  if (action.type === "complete") {
    return {
      handled: true,
      contextInjection: `## Step Skipped — Workflow Complete\nSkipped step "${currentStepId}".\n${action.reason ?? "All steps have been completed."}`,
    }
  }

  return {
    handled: true,
    contextInjection: `## Step Skipped\nSkipped step "${currentStepId}".`,
  }
}

function handleAbort(directory: string, instance: WorkflowInstance): WorkflowCommandResult {
  const name = instance.definition_name
  const goal = instance.goal

  abortWorkflow(directory)
  return {
    handled: true,
    contextInjection: `## Workflow Aborted\nWorkflow "${name}" has been cancelled.\nGoal: "${goal}"\n\nThe workflow instance has been terminated and the active pointer cleared.`,
  }
}

function handleStatus(directory: string, instance: WorkflowInstance): WorkflowCommandResult {
  const definition = loadWorkflowDefinition(instance.definition_path)

  let stepsDisplay = ""
  if (definition) {
    const lines: string[] = []
    for (const stepDef of definition.steps) {
      const stepState = instance.steps[stepDef.id]
      if (!stepState) continue

      if (stepState.status === "completed") {
        const summary = stepState.summary ? ` → ${truncate(stepState.summary, 80)}` : ""
        lines.push(`- [✓] ${stepDef.name}${summary}`)
      } else if (stepState.status === "active") {
        lines.push(`- [→] ${stepDef.name} (active)`)
      } else if (stepState.status === "skipped") {
        lines.push(`- [⊘] ${stepDef.name} (skipped)`)
      } else {
        lines.push(`- [ ] ${stepDef.name}`)
      }
    }
    stepsDisplay = lines.join("\n")
  }

  const completedCount = Object.values(instance.steps).filter((s) => s.status === "completed").length
  const totalCount = Object.keys(instance.steps).length

  return {
    handled: true,
    contextInjection: `## Workflow Status: ${instance.definition_name}\n**Goal**: "${instance.goal}"\n**Instance**: ${instance.instance_id}\n**Status**: ${instance.status}\n**Progress**: ${completedCount}/${totalCount} steps\n\n### Steps\n${stepsDisplay}`,
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 3) + "..."
}
