import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { getTaskDir, readAllTasks } from "../storage"
import { TaskStatus } from "../types"
import { log } from "../../../shared/log"

export function createTaskListTool(options: { directory: string; configDir?: string }): ToolDefinition {
  const { directory, configDir } = options

  return tool({
    description:
      "List all active tasks (pending and in_progress). " +
      "Excludes completed and deleted tasks. " +
      "Shows unresolved blockers for each task.",
    args: {},
    async execute(_args, _context) {
      const taskDir = getTaskDir(directory, configDir)
      const allTasks = readAllTasks(taskDir)

      // Filter to active tasks only
      const activeTasks = allTasks.filter(
        (t) => t.status !== TaskStatus.COMPLETED && t.status !== TaskStatus.DELETED,
      )

      // Build a set of completed task IDs for resolving blockers
      const completedIds = new Set(
        allTasks.filter((t) => t.status === TaskStatus.COMPLETED).map((t) => t.id),
      )

      // Map to summary format with resolved blockers
      const tasks = activeTasks.map((t) => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        blockedBy: t.blockedBy.filter((b) => !completedIds.has(b)),
      }))

      log("[task-list] Listed tasks", { count: tasks.length })

      return JSON.stringify({ tasks })
    },
  })
}
