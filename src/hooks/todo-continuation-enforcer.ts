/**
 * todo-continuation-enforcer hook
 *
 * Ensures in_progress todos are finalized when a session goes idle.
 * Extracted from the inline finalization logic in plugin-interface.ts.
 *
 * Primary path (zero-cost): If opencode/session/todo is available, directly
 * mutates the todo list to mark in_progress items as completed.
 *
 * Fallback path (1 LLM turn): If unavailable, injects a prompt asking the LLM
 * to finalize the todos.
 */
import type { PluginContext } from "../plugin/types"
import { log } from "../shared/log"
import { resolveTodoWriter, type TodoItem, type TodoWriter } from "./todo-writer"

export const FINALIZE_TODOS_MARKER = "<!-- weave:finalize-todos -->"

export function createTodoContinuationEnforcer(
  client: PluginContext["client"],
  options?: {
    /** Inject a mock todo writer for testing (bypasses dynamic import) */
    todoWriterOverride?: TodoWriter | null
  },
) {
  const todoFinalizedSessions = new Set<string>()

  // Resolve writer once — either from override (tests) or dynamic import
  let todoWriterPromise: Promise<TodoWriter | null>
  if (options !== undefined && "todoWriterOverride" in options) {
    todoWriterPromise = Promise.resolve(options.todoWriterOverride ?? null)
  } else {
    todoWriterPromise = resolveTodoWriter()
  }

  // Log which path will be active (async — don't await here, it's informational)
  todoWriterPromise.then((writer) => {
    if (writer) {
      log("[todo-continuation-enforcer] Direct write: available")
    } else {
      log("[todo-continuation-enforcer] Direct write: unavailable, will fall back to LLM prompt")
    }
  }).catch(() => {
    // ignore
  })

  async function checkAndFinalize(sessionID: string): Promise<void> {
    if (todoFinalizedSessions.has(sessionID)) {
      return
    }

    try {
      const todosResponse = await client.session.todo({ path: { id: sessionID } })
      const todos = (todosResponse.data ?? []) as TodoItem[]
      const inProgressTodos = todos.filter((t) => t.status === "in_progress")

      if (inProgressTodos.length === 0) {
        return
      }

      // Mark as finalized before the async operation to prevent re-entrancy
      todoFinalizedSessions.add(sessionID)

      const todoWriter = await todoWriterPromise

      if (todoWriter) {
        // Primary path: zero LLM tokens — directly mutate the todo list
        const updatedTodos = todos.map((t) =>
          t.status === "in_progress" ? { ...t, status: "completed" } : t,
        )
        todoWriter({ sessionID, todos: updatedTodos })
        log("[todo-continuation-enforcer] Finalized via direct write (0 tokens)", {
          sessionID,
          count: inProgressTodos.length,
        })
      } else {
        // Fallback path: 1 LLM turn
        const inProgressItems = inProgressTodos.map((t) => `  - "${t.content}"`).join("\n")
        await client.session.promptAsync({
          path: { id: sessionID },
          body: {
            parts: [
              {
                type: "text",
                text: `${FINALIZE_TODOS_MARKER}
You have finished your work but left these todos as in_progress:
${inProgressItems}

Use todowrite NOW to mark all of them as "completed" (or "cancelled" if abandoned). Do not do any other work — just update the todos and stop.`,
              },
            ],
          },
        })
        log("[todo-continuation-enforcer] Finalized via LLM prompt (fallback)", {
          sessionID,
          count: inProgressTodos.length,
        })
      }
    } catch (err) {
      // Re-arm so the next session.idle can retry (the mark on line 62
      // would otherwise permanently block future attempts).
      todoFinalizedSessions.delete(sessionID)
      log("[todo-continuation-enforcer] Failed to check/finalize todos (non-fatal, will retry)", {
        sessionID,
        error: String(err),
      })
    }
  }

  function markFinalized(sessionID: string): void {
    todoFinalizedSessions.add(sessionID)
  }

  function isFinalized(sessionID: string): boolean {
    return todoFinalizedSessions.has(sessionID)
  }

  function clearFinalized(sessionID: string): void {
    todoFinalizedSessions.delete(sessionID)
  }

  function clearSession(sessionID: string): void {
    todoFinalizedSessions.delete(sessionID)
  }

  return {
    checkAndFinalize,
    markFinalized,
    isFinalized,
    clearFinalized,
    clearSession,
  }
}
