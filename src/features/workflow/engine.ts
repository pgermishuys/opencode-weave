import type { WorkflowDefinition, WorkflowInstance } from "./types"
import { checkStepCompletion } from "./completion"
import type { CompletionContext, CompletionCheckResult } from "./completion"
import { composeStepPrompt } from "./context"
import {
  createWorkflowInstance,
  writeWorkflowInstance,
  getActiveWorkflowInstance,
  setActiveInstance,
  clearActiveInstance,
  readWorkflowInstance,
} from "./storage"
import { loadWorkflowDefinition } from "./discovery"

/**
 * An action the engine wants the caller to take.
 */
export interface EngineAction {
  type: "inject_prompt" | "switch_agent" | "pause" | "complete" | "none"
  /** Context-threaded prompt to inject */
  prompt?: string
  /** Agent to switch to for the next step */
  agent?: string
  reason?: string
}

/**
 * Start a new workflow instance from a definition and goal.
 * Creates the instance, sets it as active, and returns the first step's prompt.
 */
export function startWorkflow(input: {
  definition: WorkflowDefinition
  definitionPath: string
  goal: string
  sessionId: string
  directory: string
}): EngineAction {
  const { definition, definitionPath, goal, sessionId, directory } = input

  const instance = createWorkflowInstance(definition, definitionPath, goal, sessionId)
  writeWorkflowInstance(directory, instance)
  setActiveInstance(directory, instance.instance_id)

  const firstStepDef = definition.steps[0]
  const prompt = composeStepPrompt(firstStepDef, instance, definition)

  return {
    type: "inject_prompt",
    prompt,
    agent: firstStepDef.agent,
  }
}

/**
 * Check the current step's completion and advance if complete.
 * This is called on session.idle events.
 */
export function checkAndAdvance(input: {
  directory: string
  context: CompletionContext
}): EngineAction {
  const { directory, context } = input

  const instance = getActiveWorkflowInstance(directory)
  if (!instance) return { type: "none" }
  if (instance.status !== "running") return { type: "none" }

  const definition = loadWorkflowDefinition(instance.definition_path)
  if (!definition) return { type: "none", reason: "Failed to load workflow definition" }

  const currentStepDef = definition.steps.find((s) => s.id === instance.current_step_id)
  if (!currentStepDef) return { type: "none", reason: "Current step not found in definition" }

  const stepState = instance.steps[instance.current_step_id]
  if (!stepState || stepState.status !== "active") return { type: "none" }

  // Check completion
  const completionResult = checkStepCompletion(currentStepDef.completion.method, context)
  if (!completionResult.complete) {
    // For interactive steps, don't auto-advance
    if (currentStepDef.type === "interactive") return { type: "none" }
    // For autonomous/gate, also return none (wait for actual completion)
    return { type: "none" }
  }

  // Handle gate rejection
  if (currentStepDef.type === "gate" && completionResult.verdict === "reject") {
    return handleGateReject(directory, instance, currentStepDef, completionResult)
  }

  // Step is complete — advance
  return advanceToNextStep(directory, instance, definition, completionResult)
}

/**
 * Handle a gate step rejection.
 */
function handleGateReject(
  directory: string,
  instance: WorkflowInstance,
  currentStepDef: { id: string; on_reject?: string },
  completionResult: CompletionCheckResult,
): EngineAction {
  const stepState = instance.steps[currentStepDef.id]
  stepState.status = "completed"
  stepState.completed_at = new Date().toISOString()
  stepState.verdict = "reject"
  stepState.summary = completionResult.summary

  const action = currentStepDef.on_reject ?? "pause"
  if (action === "fail") {
    instance.status = "failed"
    instance.ended_at = new Date().toISOString()
    clearActiveInstance(directory)
  } else {
    instance.status = "paused"
    instance.pause_reason = "Gate step rejected"
  }

  writeWorkflowInstance(directory, instance)
  return {
    type: "pause",
    reason: `Gate step "${currentStepDef.id}" rejected${action === "fail" ? " — workflow failed" : " — workflow paused"}`,
  }
}

/**
 * Advance from the current (just completed) step to the next step.
 */
function advanceToNextStep(
  directory: string,
  instance: WorkflowInstance,
  definition: WorkflowDefinition,
  completionResult: CompletionCheckResult,
): EngineAction {
  const currentStepDef = definition.steps.find((s) => s.id === instance.current_step_id)!
  const currentIndex = definition.steps.indexOf(currentStepDef)

  // Mark current step complete
  const stepState = instance.steps[instance.current_step_id]
  stepState.status = "completed"
  stepState.completed_at = new Date().toISOString()
  stepState.summary = completionResult.summary
  if (completionResult.verdict) stepState.verdict = completionResult.verdict
  if (completionResult.artifacts) {
    stepState.artifacts = completionResult.artifacts
    // Merge step artifacts into instance artifacts
    Object.assign(instance.artifacts, completionResult.artifacts)
  }

  // Check if this was the last step
  if (currentIndex >= definition.steps.length - 1) {
    instance.status = "completed"
    instance.ended_at = new Date().toISOString()
    clearActiveInstance(directory)
    writeWorkflowInstance(directory, instance)
    return { type: "complete", reason: "Workflow completed — all steps done" }
  }

  // Activate next step
  const nextStepDef = definition.steps[currentIndex + 1]
  instance.current_step_id = nextStepDef.id
  instance.steps[nextStepDef.id].status = "active"
  instance.steps[nextStepDef.id].started_at = new Date().toISOString()

  writeWorkflowInstance(directory, instance)

  const prompt = composeStepPrompt(nextStepDef, instance, definition)
  return {
    type: "inject_prompt",
    prompt,
    agent: nextStepDef.agent,
  }
}

/**
 * Pause the active workflow instance.
 */
export function pauseWorkflow(directory: string, reason?: string): boolean {
  const instance = getActiveWorkflowInstance(directory)
  if (!instance || instance.status !== "running") return false

  instance.status = "paused"
  instance.pause_reason = reason ?? "Paused by user"
  return writeWorkflowInstance(directory, instance)
}

/**
 * Resume a paused workflow instance.
 * Returns the current step's context-threaded prompt.
 */
export function resumeWorkflow(directory: string): EngineAction {
  const instance = getActiveWorkflowInstance(directory)
  if (!instance || instance.status !== "paused") return { type: "none", reason: "No paused workflow to resume" }

  const definition = loadWorkflowDefinition(instance.definition_path)
  if (!definition) return { type: "none", reason: "Failed to load workflow definition" }

  instance.status = "running"
  instance.pause_reason = undefined

  // Re-activate the current step
  const currentStepState = instance.steps[instance.current_step_id]
  if (currentStepState.status !== "active") {
    currentStepState.status = "active"
    currentStepState.started_at = new Date().toISOString()
  }

  writeWorkflowInstance(directory, instance)

  const currentStepDef = definition.steps.find((s) => s.id === instance.current_step_id)
  if (!currentStepDef) return { type: "none", reason: "Current step not found in definition" }

  const prompt = composeStepPrompt(currentStepDef, instance, definition)
  return {
    type: "inject_prompt",
    prompt,
    agent: currentStepDef.agent,
  }
}

/**
 * Skip the current step and advance to the next.
 */
export function skipStep(directory: string): EngineAction {
  const instance = getActiveWorkflowInstance(directory)
  if (!instance) return { type: "none", reason: "No active workflow" }

  const definition = loadWorkflowDefinition(instance.definition_path)
  if (!definition) return { type: "none", reason: "Failed to load workflow definition" }

  return advanceToNextStep(directory, instance, definition, {
    complete: true,
    summary: "Step skipped by user",
  })
}

/**
 * Abort the active workflow instance.
 */
export function abortWorkflow(directory: string): boolean {
  const instance = getActiveWorkflowInstance(directory)
  if (!instance) return false

  instance.status = "cancelled"
  instance.ended_at = new Date().toISOString()
  clearActiveInstance(directory)
  return writeWorkflowInstance(directory, instance)
}
