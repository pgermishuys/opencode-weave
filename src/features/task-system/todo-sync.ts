import type { TaskObject } from "./types"
import { TaskStatus } from "./types"
import { log } from "../../shared/log"

/** TodoInfo matches the shape expected by OpenCode's todo sidebar */
export interface TodoInfo {
  id?: string
  content: string
  status: "pending" | "in_progress" | "completed"
  priority?: "high" | "medium" | "low"
}

/** TodoWriter interface — abstracts the OpenCode todo write API */
export interface TodoWriter {
  read(sessionId: string): Promise<TodoInfo[]>
  update(sessionId: string, todos: TodoInfo[]): Promise<void>
}

/**
 * Map a TaskObject to a TodoInfo for the sidebar.
 * Returns null for deleted tasks (they should be removed from the sidebar).
 */
export function syncTaskToTodo(task: TaskObject): TodoInfo | null {
  if (task.status === TaskStatus.DELETED) {
    return null
  }

  const statusMap: Record<string, TodoInfo["status"]> = {
    [TaskStatus.PENDING]: "pending",
    [TaskStatus.IN_PROGRESS]: "in_progress",
    [TaskStatus.COMPLETED]: "completed",
  }

  const priority = (task.metadata?.priority as TodoInfo["priority"]) ?? undefined

  return {
    id: task.id,
    content: task.subject,
    status: statusMap[task.status] ?? "pending",
    ...(priority ? { priority } : {}),
  }
}

/**
 * Check if two todo items match by ID first, then by content as fallback.
 */
export function todosMatch(a: TodoInfo, b: TodoInfo): boolean {
  if (a.id && b.id) return a.id === b.id
  return a.content === b.content
}

/**
 * Sync a single task to the todo sidebar.
 * This is the anti-obliteration mechanism:
 * 1. Read current todos
 * 2. Filter out the matching item (by ID or content)
 * 3. Push the updated item (or omit it if deleted)
 * 4. Write back the full list
 *
 * Non-task todos (those not matching any task ID) survive intact.
 */
export async function syncTaskTodoUpdate(
  writer: TodoWriter | null,
  sessionId: string,
  task: TaskObject,
): Promise<void> {
  if (!writer) {
    log("[task-sync] No todo writer available — skipping sidebar sync")
    return
  }

  try {
    const currentTodos = await writer.read(sessionId)
    const todoItem = syncTaskToTodo(task)

    // Filter out the existing entry for this task
    const filtered = currentTodos.filter((t) => !todosMatch(t, { id: task.id, content: task.subject, status: "pending" }))

    // Add the updated item (unless deleted — then just remove it)
    if (todoItem) {
      filtered.push(todoItem)
    }

    await writer.update(sessionId, filtered)
  } catch (err) {
    log("[task-sync] Failed to sync task to sidebar (non-fatal)", { taskId: task.id, error: String(err) })
  }
}

/**
 * Sync all tasks to the todo sidebar, preserving non-task todos.
 * Used for bulk reconciliation.
 */
export async function syncAllTasksToTodos(
  writer: TodoWriter | null,
  sessionId: string,
  tasks: TaskObject[],
): Promise<void> {
  if (!writer) {
    log("[task-sync] No todo writer available — skipping bulk sync")
    return
  }

  try {
    const currentTodos = await writer.read(sessionId)

    // Build a set of task IDs and subjects for matching
    const taskIdentifiers = new Set<string>()
    for (const task of tasks) {
      taskIdentifiers.add(task.id)
      taskIdentifiers.add(task.subject)
    }

    // Keep non-task todos (those that don't match any task)
    const nonTaskTodos = currentTodos.filter((t) => {
      if (t.id && taskIdentifiers.has(t.id)) return false
      if (taskIdentifiers.has(t.content)) return false
      return true
    })

    // Map tasks to todos (exclude deleted)
    const taskTodos: TodoInfo[] = []
    for (const task of tasks) {
      const todo = syncTaskToTodo(task)
      if (todo) taskTodos.push(todo)
    }

    // Merge: non-task todos first, then task todos
    const merged = [...nonTaskTodos, ...taskTodos]
    await writer.update(sessionId, merged)
  } catch (err) {
    log("[task-sync] Failed to bulk sync tasks to sidebar (non-fatal)", { error: String(err) })
  }
}
