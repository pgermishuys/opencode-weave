/**
 * Workflow hook handler: detects /run-workflow commands, parses arguments,
 * manages workflow instances, and drives step transitions on session.idle.
 */

import { log } from "../../shared/log"
import {
  discoverWorkflows,
  loadWorkflowDefinition,
  getActiveWorkflowInstance,
  startWorkflow,
  checkAndAdvance,
  pauseWorkflow,
  resumeWorkflow as engineResumeWorkflow,
} from "./index"
import type { CompletionContext } from "./index"

/**
 * Marker embedded in workflow continuation prompts so the auto-pause guard
 * in plugin-interface.ts can recognize them and NOT pause coexisting WorkState plans.
 */
export const WORKFLOW_CONTINUATION_MARKER = "<!-- weave:workflow-continuation -->"

export interface WorkflowHookResult {
  /** Context to inject into the prompt (step prompt with workflow context) */
  contextInjection: string | null
  /** Agent to switch to for the current step */
  switchAgent: string | null
}

/**
 * Parse /run-workflow arguments into workflow name and optional goal.
 * Argument format: `<workflow-name> "goal text"` or `<workflow-name>` or empty.
 */
export function parseWorkflowArgs(args: string): {
  workflowName: string | null
  goal: string | null
} {
  const trimmed = args.trim()
  if (!trimmed) return { workflowName: null, goal: null }

  // Try to extract quoted goal: workflow-name "goal text"
  const quotedMatch = trimmed.match(/^(\S+)\s+"([^"]+)"$/)
  if (quotedMatch) {
    return { workflowName: quotedMatch[1], goal: quotedMatch[2] }
  }

  // Try single-quoted: workflow-name 'goal text'
  const singleQuotedMatch = trimmed.match(/^(\S+)\s+'([^']+)'$/)
  if (singleQuotedMatch) {
    return { workflowName: singleQuotedMatch[1], goal: singleQuotedMatch[2] }
  }

  // No quotes — check if there's additional text after the workflow name
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) {
    return { workflowName: parts[0], goal: null }
  }

  // Multiple words without quotes — first word is name, rest is goal
  return { workflowName: parts[0], goal: parts.slice(1).join(" ") }
}

/**
 * Handle the /run-workflow command.
 * Detects the command via <session-context> tag, parses arguments,
 * and either creates a new instance, resumes an existing one, or lists available definitions.
 */
export function handleRunWorkflow(input: {
  promptText: string
  sessionId: string
  directory: string
}): WorkflowHookResult {
  const { promptText, sessionId, directory } = input

  // Only fire when the template has been injected (contains <session-context>)
  if (!promptText.includes("<session-context>")) {
    return { contextInjection: null, switchAgent: null }
  }

  const args = extractArguments(promptText)
  const { workflowName, goal } = parseWorkflowArgs(args)

  // Check for existing active instance
  const activeInstance = getActiveWorkflowInstance(directory)

  // Case 1: No args, no active instance → list available definitions
  if (!workflowName && !activeInstance) {
    return listAvailableWorkflows(directory)
  }

  // Case 2: No args, active instance exists → resume it
  if (!workflowName && activeInstance) {
    return resumeActiveWorkflow(directory)
  }

  // Case 3: Workflow name provided, no goal, active instance matches → resume
  if (workflowName && !goal && activeInstance && activeInstance.definition_id === workflowName) {
    return resumeActiveWorkflow(directory)
  }

  // Case 4: Workflow name provided with goal → start new instance
  if (workflowName && goal) {
    // Check for existing active instance — can't start new while one is active
    if (activeInstance) {
      return {
        contextInjection: `## Workflow Already Active\nThere is already an active workflow: "${activeInstance.definition_name}" (${activeInstance.instance_id}).\nGoal: "${activeInstance.goal}"\n\nTo start a new workflow, first abort the current one with \`/workflow abort\` or let it complete.`,
        switchAgent: null,
      }
    }

    return startNewWorkflow(workflowName, goal, sessionId, directory)
  }

  // Case 5: Workflow name provided, no goal, no matching active instance → start with name only
  if (workflowName && !goal) {
    if (activeInstance) {
      return {
        contextInjection: `## Workflow Already Active\nThere is already an active workflow: "${activeInstance.definition_name}" (${activeInstance.instance_id}).\nGoal: "${activeInstance.goal}"\n\nDid you mean to resume the active workflow? Run \`/run-workflow\` without arguments to resume.`,
        switchAgent: null,
      }
    }

    // No active instance, no goal — need a goal to start
    return {
      contextInjection: `## Goal Required\nTo start the "${workflowName}" workflow, provide a goal:\n\`/run-workflow ${workflowName} "your goal here"\``,
      switchAgent: null,
    }
  }

  return { contextInjection: null, switchAgent: null }
}

/**
 * Check workflow continuation on session.idle.
 * If an active workflow instance exists and the current step's completion condition is met,
 * advance to the next step and return a continuation prompt.
 */
export function checkWorkflowContinuation(input: {
  sessionId: string
  directory: string
  lastAssistantMessage?: string
  lastUserMessage?: string
}): { continuationPrompt: string | null; switchAgent: string | null } {
  const { directory, lastAssistantMessage, lastUserMessage } = input

  const instance = getActiveWorkflowInstance(directory)
  if (!instance) return { continuationPrompt: null, switchAgent: null }
  if (instance.status !== "running") return { continuationPrompt: null, switchAgent: null }

  const definition = loadWorkflowDefinition(instance.definition_path)
  if (!definition) return { continuationPrompt: null, switchAgent: null }

  const currentStepDef = definition.steps.find((s) => s.id === instance.current_step_id)
  if (!currentStepDef) return { continuationPrompt: null, switchAgent: null }

  const completionContext: CompletionContext = {
    directory,
    config: currentStepDef.completion,
    artifacts: instance.artifacts,
    lastAssistantMessage,
    lastUserMessage,
  }

  const action = checkAndAdvance({ directory, context: completionContext })

  switch (action.type) {
    case "inject_prompt":
      return {
        continuationPrompt: `${WORKFLOW_CONTINUATION_MARKER}\n${action.prompt}`,
        switchAgent: action.agent ?? null,
      }
    case "complete":
      return {
        continuationPrompt: `${WORKFLOW_CONTINUATION_MARKER}\n## Workflow Complete\n${action.reason ?? "All steps have been completed."}\n\nSummarize what was accomplished across all workflow steps.`,
        switchAgent: null,
      }
    case "pause":
      return {
        continuationPrompt: `${WORKFLOW_CONTINUATION_MARKER}\n## Workflow Paused\n${action.reason ?? "The workflow has been paused."}\n\nInform the user about the pause and what to do next.`,
        switchAgent: null,
      }
    case "none":
    default:
      return { continuationPrompt: null, switchAgent: null }
  }
}

// ─── Private helpers ────────────────────────────────────────────────────────

/**
 * Extract the arguments from <user-request> tags.
 */
function extractArguments(promptText: string): string {
  const match = promptText.match(/<user-request>\s*([\s\S]*?)\s*<\/user-request>/i)
  if (!match) return ""
  return match[1].trim()
}

/**
 * List available workflow definitions.
 */
function listAvailableWorkflows(directory: string): WorkflowHookResult {
  const workflows = discoverWorkflows(directory)
  if (workflows.length === 0) {
    return {
      contextInjection:
        "## No Workflows Available\nNo workflow definitions found.\n\nWorkflow definitions should be placed in `.opencode/workflows/` (project) or `~/.config/opencode/workflows/` (user).",
      switchAgent: null,
    }
  }

  const listing = workflows
    .map((w) => `  - **${w.definition.name}**: ${w.definition.description ?? "(no description)"} (${w.scope})`)
    .join("\n")

  return {
    contextInjection: `## Available Workflows\n${listing}\n\nTo start a workflow, run:\n\`/run-workflow <name> "your goal"\``,
    switchAgent: null,
  }
}

/**
 * Resume the currently active workflow instance.
 */
function resumeActiveWorkflow(directory: string): WorkflowHookResult {
  const action = engineResumeWorkflow(directory)
  if (action.type === "none") {
    // Instance exists but isn't paused — it's running. Return current step info.
    const instance = getActiveWorkflowInstance(directory)
    if (instance && instance.status === "running") {
      const definition = loadWorkflowDefinition(instance.definition_path)
      if (definition) {
        const currentStep = definition.steps.find((s) => s.id === instance.current_step_id)
        return {
          contextInjection: `## Workflow In Progress\nWorkflow "${instance.definition_name}" is already running.\nCurrent step: **${currentStep?.name ?? instance.current_step_id}**\nGoal: "${instance.goal}"\n\nContinue with the current step.`,
          switchAgent: currentStep?.agent ?? null,
        }
      }
    }
    return { contextInjection: null, switchAgent: null }
  }

  return {
    contextInjection: action.prompt ?? null,
    switchAgent: action.agent ?? null,
  }
}

/**
 * Start a new workflow from a definition name and goal.
 */
function startNewWorkflow(
  workflowName: string,
  goal: string,
  sessionId: string,
  directory: string,
): WorkflowHookResult {
  const workflows = discoverWorkflows(directory)
  const match = workflows.find((w) => w.definition.name === workflowName)

  if (!match) {
    const available = workflows.map((w) => w.definition.name).join(", ")
    return {
      contextInjection: `## Workflow Not Found\nNo workflow definition named "${workflowName}" was found.\n${available ? `Available workflows: ${available}` : "No workflow definitions available."}`,
      switchAgent: null,
    }
  }

  const action = startWorkflow({
    definition: match.definition,
    definitionPath: match.path,
    goal,
    sessionId,
    directory,
  })

  log("Workflow started", {
    workflowName: match.definition.name,
    goal,
    agent: action.agent,
  })

  return {
    contextInjection: action.prompt ?? null,
    switchAgent: action.agent ?? null,
  }
}
