import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { getTaskDir, readTask, writeTask } from "../storage"
import { syncTaskTodoUpdate, type TodoWriter } from "../todo-sync"
import { type TaskObject } from "../types"
import { log } from "../../../shared/log"

const TASK_ID_PATTERN = /^T-[A-Za-z0-9-]+$/

export function createTaskUpdateTool(options: { directory: string; configDir?: string; todoWriter?: TodoWriter | null }): ToolDefinition {
  const { directory, configDir, todoWriter = null } = options

  return tool({
    description:
      "Update an existing task by ID. Modifies only the specified fields — " +
      "other tasks and non-task todos are completely untouched. " +
      "blocks/blockedBy are additive (appended, never replaced).",
    args: {
      id: tool.schema.string().describe("Task ID to update (required, format: T-{uuid})"),
      subject: tool.schema.string().optional().describe("New subject/title"),
      description: tool.schema.string().optional().describe("New description"),
      status: tool.schema.enum(["pending", "in_progress", "completed", "deleted"]).optional().describe("New status"),
      addBlocks: tool.schema.array(tool.schema.string()).optional().describe("Task IDs to add to blocks (additive)"),
      addBlockedBy: tool.schema.array(tool.schema.string()).optional().describe("Task IDs to add to blockedBy (additive)"),
      metadata: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional().describe("Metadata to merge (null values delete keys)"),
    },
    async execute(args, context) {
      // Validate ID format
      if (!TASK_ID_PATTERN.test(args.id)) {
        return JSON.stringify({ error: "invalid_task_id", message: `Invalid task ID format: ${args.id}. Expected T-{uuid}` })
      }

      const taskDir = getTaskDir(directory, configDir)
      const task = readTask(taskDir, args.id)

      if (!task) {
        return JSON.stringify({ error: "task_not_found", message: `Task ${args.id} not found` })
      }

      // Apply updates
      if (args.subject !== undefined) task.subject = args.subject
      if (args.description !== undefined) task.description = args.description
      if (args.status !== undefined) task.status = args.status as TaskObject["status"]

      // Additive blocks
      if (args.addBlocks?.length) {
        const existing = new Set(task.blocks)
        for (const b of args.addBlocks) {
          if (!existing.has(b)) {
            task.blocks.push(b)
            existing.add(b)
          }
        }
      }

      // Additive blockedBy
      if (args.addBlockedBy?.length) {
        const existing = new Set(task.blockedBy)
        for (const b of args.addBlockedBy) {
          if (!existing.has(b)) {
            task.blockedBy.push(b)
            existing.add(b)
          }
        }
      }

      // Merge metadata (null deletes keys)
      if (args.metadata) {
        const meta = task.metadata ?? {}
        for (const [key, value] of Object.entries(args.metadata)) {
          if (value === null) {
            delete meta[key]
          } else {
            meta[key] = value
          }
        }
        task.metadata = Object.keys(meta).length > 0 ? meta : undefined
      }

      writeTask(taskDir, task)
      log("[task-update] Updated task", { id: task.id })

      // Sync to sidebar
      await syncTaskTodoUpdate(todoWriter, context.sessionID, task)

      return JSON.stringify({ task })
    },
  })
}
