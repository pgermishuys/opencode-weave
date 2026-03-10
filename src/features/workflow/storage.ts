import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, readdirSync } from "fs"
import { join } from "path"
import { randomBytes } from "node:crypto"
import type { WorkflowDefinition, WorkflowInstance, ActiveInstancePointer, StepState } from "./types"
import { WORKFLOWS_STATE_DIR, INSTANCE_STATE_FILE, ACTIVE_INSTANCE_FILE } from "./constants"

/**
 * Generate a unique instance ID.
 * Format: wf_{8 random hex chars} (e.g., "wf_a1b2c3d4").
 */
export function generateInstanceId(): string {
  return `wf_${randomBytes(4).toString("hex")}`
}

/**
 * Generate a URL-safe slug from a goal string.
 * Lowercase, spaces to hyphens, strip non-alphanumeric, truncate to 50 chars.
 */
export function generateSlug(goal: string): string {
  return goal
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50)
}

/**
 * Create a fresh WorkflowInstance for a definition + goal.
 */
export function createWorkflowInstance(
  definition: WorkflowDefinition,
  definitionPath: string,
  goal: string,
  sessionId: string,
): WorkflowInstance {
  const instanceId = generateInstanceId()
  const slug = generateSlug(goal)
  const firstStepId = definition.steps[0].id

  const steps: Record<string, StepState> = {}
  for (const step of definition.steps) {
    steps[step.id] = {
      id: step.id,
      status: step.id === firstStepId ? "active" : "pending",
      ...(step.id === firstStepId ? { started_at: new Date().toISOString() } : {}),
    }
  }

  return {
    instance_id: instanceId,
    definition_id: definition.name,
    definition_name: definition.name,
    definition_path: definitionPath,
    goal,
    slug,
    status: "running",
    started_at: new Date().toISOString(),
    session_ids: [sessionId],
    current_step_id: firstStepId,
    steps,
    artifacts: {},
  }
}

/**
 * Read a workflow instance by ID. Returns null if not found or invalid.
 */
export function readWorkflowInstance(directory: string, instanceId: string): WorkflowInstance | null {
  const filePath = join(directory, WORKFLOWS_STATE_DIR, instanceId, INSTANCE_STATE_FILE)
  try {
    if (!existsSync(filePath)) return null
    const raw = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    if (typeof parsed.instance_id !== "string") return null
    return parsed as WorkflowInstance
  } catch {
    return null
  }
}

/**
 * Write a workflow instance to its state directory.
 * Creates directories as needed.
 */
export function writeWorkflowInstance(directory: string, instance: WorkflowInstance): boolean {
  try {
    const dir = join(directory, WORKFLOWS_STATE_DIR, instance.instance_id)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(join(dir, INSTANCE_STATE_FILE), JSON.stringify(instance, null, 2), "utf-8")
    return true
  } catch {
    return false
  }
}

/**
 * Read the active instance pointer. Returns null if no active instance.
 */
export function readActiveInstance(directory: string): ActiveInstancePointer | null {
  const filePath = join(directory, WORKFLOWS_STATE_DIR, ACTIVE_INSTANCE_FILE)
  try {
    if (!existsSync(filePath)) return null
    const raw = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || typeof parsed.instance_id !== "string") return null
    return parsed as ActiveInstancePointer
  } catch {
    return null
  }
}

/**
 * Set the active instance pointer.
 */
export function setActiveInstance(directory: string, instanceId: string): boolean {
  try {
    const dir = join(directory, WORKFLOWS_STATE_DIR)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    const pointer: ActiveInstancePointer = { instance_id: instanceId }
    writeFileSync(join(dir, ACTIVE_INSTANCE_FILE), JSON.stringify(pointer, null, 2), "utf-8")
    return true
  } catch {
    return false
  }
}

/**
 * Clear the active instance pointer (without deleting the instance).
 */
export function clearActiveInstance(directory: string): boolean {
  const filePath = join(directory, WORKFLOWS_STATE_DIR, ACTIVE_INSTANCE_FILE)
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
    return true
  } catch {
    return false
  }
}

/**
 * Get the active workflow instance (resolves pointer -> reads instance).
 * Returns null if no active instance or instance not found.
 */
export function getActiveWorkflowInstance(directory: string): WorkflowInstance | null {
  const pointer = readActiveInstance(directory)
  if (!pointer) return null
  return readWorkflowInstance(directory, pointer.instance_id)
}

/**
 * List all instance IDs (for status/history commands).
 * Returns IDs sorted alphabetically.
 */
export function listInstances(directory: string): string[] {
  const dir = join(directory, WORKFLOWS_STATE_DIR)
  try {
    if (!existsSync(dir)) return []
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("wf_"))
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

/**
 * Append a session ID to an instance's session_ids.
 * Returns the updated instance, or null if the instance doesn't exist.
 */
export function appendInstanceSessionId(
  directory: string,
  instanceId: string,
  sessionId: string,
): WorkflowInstance | null {
  const instance = readWorkflowInstance(directory, instanceId)
  if (!instance) return null
  if (!instance.session_ids.includes(sessionId)) {
    instance.session_ids.push(sessionId)
    writeWorkflowInstance(directory, instance)
  }
  return instance
}
