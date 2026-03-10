import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { parse as parseJsonc } from "jsonc-parser"
import { log } from "../../shared/log"
import { WorkflowDefinitionSchema } from "./schema"
import type { WorkflowDefinition } from "./types"
import { WORKFLOWS_DIR_PROJECT, WORKFLOWS_DIR_USER } from "./constants"

/**
 * A workflow definition discovered from the filesystem.
 */
export interface DiscoveredWorkflow {
  definition: WorkflowDefinition
  path: string
  scope: "project" | "user"
}

/**
 * Load and validate a single workflow definition from a JSONC file path.
 * Returns null if the file can't be read, parsed, or fails validation.
 */
export function loadWorkflowDefinition(filePath: string): WorkflowDefinition | null {
  let raw: string
  try {
    raw = fs.readFileSync(filePath, "utf-8")
  } catch (err) {
    log("Failed to read workflow definition file", { filePath, error: String(err) })
    return null
  }

  let parsed: unknown
  try {
    parsed = parseJsonc(raw)
  } catch (err) {
    log("Failed to parse workflow definition JSONC", { filePath, error: String(err) })
    return null
  }

  const result = WorkflowDefinitionSchema.safeParse(parsed)
  if (!result.success) {
    log("Workflow definition failed validation", {
      filePath,
      errors: result.error.issues.map((i) => i.message),
    })
    return null
  }

  return result.data as WorkflowDefinition
}

/**
 * Scan a directory for workflow definition files (.jsonc and .json).
 * Returns validated definitions with their file paths.
 */
function scanWorkflowDirectory(directory: string, scope: "project" | "user"): DiscoveredWorkflow[] {
  if (!fs.existsSync(directory)) return []

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch (err) {
    log("Failed to read workflows directory", { directory, error: String(err) })
    return []
  }

  const workflows: DiscoveredWorkflow[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.endsWith(".jsonc") && !entry.name.endsWith(".json")) continue

    const filePath = path.join(directory, entry.name)
    const definition = loadWorkflowDefinition(filePath)
    if (definition) {
      workflows.push({ definition, path: filePath, scope })
    }
  }

  return workflows
}

/**
 * Discover all valid workflow definitions from project and user directories.
 * Project workflows override user workflows with the same name.
 */
export function discoverWorkflows(directory: string): DiscoveredWorkflow[] {
  const projectDir = path.join(directory, WORKFLOWS_DIR_PROJECT)
  const userDir = path.join(os.homedir(), ".config", "opencode", WORKFLOWS_DIR_USER)

  const userWorkflows = scanWorkflowDirectory(userDir, "user")
  const projectWorkflows = scanWorkflowDirectory(projectDir, "project")

  // Project workflows override user workflows with same name
  const byName = new Map<string, DiscoveredWorkflow>()
  for (const wf of userWorkflows) {
    byName.set(wf.definition.name, wf)
  }
  for (const wf of projectWorkflows) {
    byName.set(wf.definition.name, wf)
  }

  return Array.from(byName.values())
}
