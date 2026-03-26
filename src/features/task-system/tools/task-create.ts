import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { generateTaskId, getTaskDir, writeTask, ensureDir } from "../storage"
import { syncTaskTodoUpdate, type TodoWriter } from "../todo-sync"
import { TaskStatus, type TaskObject } from "../types"
import { log } from "../../../shared/log"

const TASK_ID_PATTERN = /^T-[A-Za-z0-9-]+$/

export function createTaskCreateTool(options: { directory: string; configDir?: string; todoWriter?: TodoWriter | null }): ToolDefinition {
  const { directory, configDir, todoWriter = null } = options

  return tool({
    description:
      "Create a new task. Use this instead of todowrite for task tracking. " +
      "Each task gets a unique ID and is stored atomically — creating a task never destroys existing tasks or todos.",
    args: {
      subject: tool.schema.string().describe("Short title for the task (required)"),
      description: tool.schema.string().optional().describe("Detailed description of the task"),
      blocks: tool.schema.array(tool.schema.string()).optional().describe("Task IDs that this task blocks"),
      blockedBy: tool.schema.array(tool.schema.string()).optional().describe("Task IDs that block this task"),
      metadata: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional().describe("Arbitrary key-value metadata"),
    },
    async execute(args, context) {
      const taskDir = getTaskDir(directory, configDir)
      ensureDir(taskDir)

      const task: TaskObject = {
        id: generateTaskId(),
        subject: args.subject,
        description: args.description ?? "",
        status: TaskStatus.PENDING,
        threadID: context.sessionID,
        blocks: args.blocks ?? [],
        blockedBy: args.blockedBy ?? [],
        metadata: args.metadata,
      }

      writeTask(taskDir, task)
      log("[task-create] Created task", { id: task.id, subject: task.subject })

      // Sync to sidebar (non-blocking, graceful failure)
      await syncTaskTodoUpdate(todoWriter, context.sessionID, task)

      return JSON.stringify({ task: { id: task.id, subject: task.subject } })
    },
  })
}

export { TASK_ID_PATTERN }
