/**
 * Start-work hook: detects the /start-work command, resolves the target plan,
 * creates/updates work state, and returns context for injection into the prompt.
 */

import {
  readWorkState,
  writeWorkState,
  clearWorkState,
  appendSessionId,
  createWorkState,
  findPlans,
  getPlanProgress,
  getPlanName,
} from "../features/work-state"

export interface StartWorkInput {
  promptText: string
  sessionId: string
  directory: string
}

export interface StartWorkResult {
  /** Context to inject into the prompt (plan path, progress, instructions) */
  contextInjection: string | null
  /** Agent to switch to (always "tapestry" when command is detected) */
  switchAgent: string | null
}

/**
 * Handle the /start-work command.
 * Returns null contextInjection if this message is not a /start-work command.
 */
export function handleStartWork(input: StartWorkInput): StartWorkResult {
  const { promptText, sessionId, directory } = input

  // Only fire when the template has been injected (contains <session-context>)
  if (!promptText.includes("<session-context>")) {
    return { contextInjection: null, switchAgent: null }
  }

  const explicitPlanName = extractPlanName(promptText)
  const existingState = readWorkState(directory)
  const allPlans = findPlans(directory)

  // Case 1: Explicit plan name provided
  if (explicitPlanName) {
    return handleExplicitPlan(explicitPlanName, allPlans, sessionId, directory)
  }

  // Case 2: Existing work state — resume
  if (existingState) {
    const progress = getPlanProgress(existingState.active_plan)
    if (!progress.isComplete) {
      appendSessionId(directory, sessionId)
      return {
        switchAgent: "tapestry",
        contextInjection: buildResumeContext(existingState.active_plan, existingState.plan_name, progress),
      }
    }
    // Previous plan is complete — fall through to discovery
  }

  // Case 3: Discover plans
  return handlePlanDiscovery(allPlans, sessionId, directory)
}

/**
 * Extract plan name from <user-request> tags in the prompt.
 */
function extractPlanName(promptText: string): string | null {
  const match = promptText.match(/<user-request>\s*([\s\S]*?)\s*<\/user-request>/i)
  if (!match) return null
  const cleaned = match[1].trim()
  return cleaned || null
}

/**
 * Handle explicit plan name: find matching plan, create state.
 */
function handleExplicitPlan(
  requestedName: string,
  allPlans: string[],
  sessionId: string,
  directory: string,
): StartWorkResult {
  const matched = findPlanByName(allPlans, requestedName)

  if (!matched) {
    const incompletePlans = allPlans.filter((p) => !getPlanProgress(p).isComplete)
    const listing =
      incompletePlans.length > 0
        ? incompletePlans.map((p) => `  - ${getPlanName(p)}`).join("\n")
        : "  (none)"
    return {
      switchAgent: "tapestry",
      contextInjection: `## Plan Not Found\nNo plan matching "${requestedName}" was found.\n\nAvailable incomplete plans:\n${listing}\n\nTell the user which plans are available and ask them to specify one.`,
    }
  }

  const progress = getPlanProgress(matched)
  if (progress.isComplete) {
    return {
      switchAgent: "tapestry",
      contextInjection: `## Plan Already Complete\nThe plan "${getPlanName(matched)}" has all ${progress.total} tasks completed.\nTell the user this plan is already done and suggest creating a new one with Pattern.`,
    }
  }

  // Create fresh state for this plan
  clearWorkState(directory)
  const state = createWorkState(matched, sessionId, "tapestry")
  writeWorkState(directory, state)

  return {
    switchAgent: "tapestry",
    contextInjection: buildFreshContext(matched, getPlanName(matched), progress),
  }
}

/**
 * Handle plan discovery when no explicit name given and no active state.
 */
function handlePlanDiscovery(
  allPlans: string[],
  sessionId: string,
  directory: string,
): StartWorkResult {
  if (allPlans.length === 0) {
    return {
      switchAgent: "tapestry",
      contextInjection:
        "## No Plans Found\nNo plan files found at `.weave/plans/`.\nTell the user to switch to Pattern agent to create a work plan first.",
    }
  }

  const incompletePlans = allPlans.filter((p) => !getPlanProgress(p).isComplete)

  if (incompletePlans.length === 0) {
    return {
      switchAgent: "tapestry",
      contextInjection:
        "## All Plans Complete\nAll existing plans have been completed.\nTell the user to switch to Pattern agent to create a new plan.",
    }
  }

  if (incompletePlans.length === 1) {
    const plan = incompletePlans[0]
    const progress = getPlanProgress(plan)
    const state = createWorkState(plan, sessionId, "tapestry")
    writeWorkState(directory, state)
    return {
      switchAgent: "tapestry",
      contextInjection: buildFreshContext(plan, getPlanName(plan), progress),
    }
  }

  // Multiple incomplete plans — list them for the user to choose
  const listing = incompletePlans
    .map((p) => {
      const progress = getPlanProgress(p)
      return `  - **${getPlanName(p)}** (${progress.completed}/${progress.total} tasks done)`
    })
    .join("\n")

  return {
    switchAgent: "tapestry",
    contextInjection: `## Multiple Plans Found\nThere are ${incompletePlans.length} incomplete plans:\n${listing}\n\nAsk the user which plan to work on. They can run \`/start-work [plan-name]\` to select one.`,
  }
}

/**
 * Find a plan by name (exact match first, then partial).
 */
function findPlanByName(plans: string[], requestedName: string): string | null {
  const lower = requestedName.toLowerCase()
  const exact = plans.find((p) => getPlanName(p).toLowerCase() === lower)
  if (exact) return exact
  const partial = plans.find((p) => getPlanName(p).toLowerCase().includes(lower))
  return partial || null
}

function buildFreshContext(
  planPath: string,
  planName: string,
  progress: { total: number; completed: number },
): string {
  return `## Starting Plan: ${planName}
**Plan file**: ${planPath}
**Progress**: ${progress.completed}/${progress.total} tasks completed

Read the plan file now and begin executing from the first unchecked \`- [ ]\` task.

**SIDEBAR TODOS — DO THIS FIRST:**
Before starting any work, use todowrite to populate the sidebar:
1. Create a summary todo (in_progress): "${planName} ${progress.completed}/${progress.total}"
2. Create a todo for the first unchecked task (in_progress)
3. Create todos for the next 2-3 tasks (pending)
Keep each todo under 35 chars. Update as you complete tasks.`
}

function buildResumeContext(
  planPath: string,
  planName: string,
  progress: { total: number; completed: number },
): string {
  const remaining = progress.total - progress.completed
  return `## Resuming Plan: ${planName}
**Plan file**: ${planPath}
**Progress**: ${progress.completed}/${progress.total} tasks completed
**Status**: RESUMING — continuing from where the previous session left off.

Read the plan file now and continue from the first unchecked \`- [ ]\` task.

**SIDEBAR TODOS — RESTORE STATE:**
Previous session's todos are lost. Use todowrite to restore the sidebar:
1. Create a summary todo (in_progress): "${planName} ${progress.completed}/${progress.total}"
2. Create a todo for the next unchecked task (in_progress)
3. Create todos for the following 2-3 tasks (pending)
Keep each todo under 35 chars. ${remaining} task${remaining !== 1 ? "s" : ""} remaining.`
}
