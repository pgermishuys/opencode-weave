import { describe, it, expect } from "bun:test"
import {
  syncTaskToTodo,
  todosMatch,
  syncTaskTodoUpdate,
  syncAllTasksToTodos,
  type TodoWriter,
  type TodoInfo,
} from "./todo-sync"
import type { TaskObject } from "./types"

function createTask(overrides: Partial<TaskObject> = {}): TaskObject {
  return {
    id: "T-test-1",
    subject: "Test task",
    description: "A test task",
    status: "pending",
    threadID: "sess-1",
    blocks: [],
    blockedBy: [],
    ...overrides,
  }
}

function createMockWriter(initialTodos: TodoInfo[] = []): TodoWriter & { todos: TodoInfo[] } {
  const state = { todos: [...initialTodos] }
  return {
    get todos() { return state.todos },
    async read(_sessionId: string) {
      return [...state.todos]
    },
    async update(_sessionId: string, todos: TodoInfo[]) {
      state.todos = [...todos]
    },
  }
}

describe("syncTaskToTodo", () => {
  it("maps pending → pending", () => {
    const todo = syncTaskToTodo(createTask({ status: "pending" }))
    expect(todo).not.toBeNull()
    expect(todo!.status).toBe("pending")
  })

  it("maps in_progress → in_progress", () => {
    const todo = syncTaskToTodo(createTask({ status: "in_progress" }))
    expect(todo).not.toBeNull()
    expect(todo!.status).toBe("in_progress")
  })

  it("maps completed → completed", () => {
    const todo = syncTaskToTodo(createTask({ status: "completed" }))
    expect(todo).not.toBeNull()
    expect(todo!.status).toBe("completed")
  })

  it("maps deleted → null", () => {
    const todo = syncTaskToTodo(createTask({ status: "deleted" }))
    expect(todo).toBeNull()
  })

  it("uses subject as todo content", () => {
    const todo = syncTaskToTodo(createTask({ subject: "Build feature X" }))
    expect(todo!.content).toBe("Build feature X")
  })

  it("sets task ID on todo", () => {
    const todo = syncTaskToTodo(createTask({ id: "T-abc-123" }))
    expect(todo!.id).toBe("T-abc-123")
  })

  it("extracts priority from metadata", () => {
    const todo = syncTaskToTodo(createTask({ metadata: { priority: "high" } }))
    expect(todo!.priority).toBe("high")
  })

  it("omits priority when not in metadata", () => {
    const todo = syncTaskToTodo(createTask())
    expect(todo!.priority).toBeUndefined()
  })
})

describe("todosMatch", () => {
  it("matches by ID when both have IDs", () => {
    expect(todosMatch(
      { id: "T-1", content: "Task 1", status: "pending" },
      { id: "T-1", content: "Different", status: "completed" },
    )).toBe(true)
  })

  it("does not match different IDs", () => {
    expect(todosMatch(
      { id: "T-1", content: "Same", status: "pending" },
      { id: "T-2", content: "Same", status: "pending" },
    )).toBe(false)
  })

  it("falls back to content match when no IDs", () => {
    expect(todosMatch(
      { content: "Same task", status: "pending" },
      { content: "Same task", status: "completed" },
    )).toBe(true)
  })

  it("does not match different content when no IDs", () => {
    expect(todosMatch(
      { content: "Task A", status: "pending" },
      { content: "Task B", status: "pending" },
    )).toBe(false)
  })
})

describe("syncTaskTodoUpdate", () => {
  it("preserves existing todos when updating one task (THE KEY TEST)", async () => {
    // Start with 3 todos (A, B, C) — this simulates the existing sidebar state
    const writer = createMockWriter([
      { id: "T-a", content: "Task A", status: "pending" },
      { id: "T-b", content: "Task B", status: "pending" },
      { id: "T-c", content: "Task C", status: "pending" },
    ])

    // Update task B — this should NOT destroy A and C
    const taskB = createTask({ id: "T-b", subject: "Task B", status: "in_progress" })
    await syncTaskTodoUpdate(writer, "sess-1", taskB)

    // A and C should be untouched
    expect(writer.todos).toHaveLength(3)
    const todoA = writer.todos.find((t) => t.id === "T-a")
    const todoB = writer.todos.find((t) => t.id === "T-b")
    const todoC = writer.todos.find((t) => t.id === "T-c")
    expect(todoA).toBeDefined()
    expect(todoA!.status).toBe("pending") // unchanged
    expect(todoB).toBeDefined()
    expect(todoB!.status).toBe("in_progress") // updated
    expect(todoC).toBeDefined()
    expect(todoC!.status).toBe("pending") // unchanged
  })

  it("removes deleted task without affecting others", async () => {
    const writer = createMockWriter([
      { id: "T-a", content: "Task A", status: "pending" },
      { id: "T-b", content: "Task B", status: "pending" },
    ])

    const deletedTask = createTask({ id: "T-b", subject: "Task B", status: "deleted" })
    await syncTaskTodoUpdate(writer, "sess-1", deletedTask)

    expect(writer.todos).toHaveLength(1)
    expect(writer.todos[0].id).toBe("T-a")
  })

  it("adds new task to existing list", async () => {
    const writer = createMockWriter([
      { id: "T-a", content: "Task A", status: "pending" },
    ])

    const newTask = createTask({ id: "T-b", subject: "Task B" })
    await syncTaskTodoUpdate(writer, "sess-1", newTask)

    expect(writer.todos).toHaveLength(2)
    expect(writer.todos.find((t) => t.id === "T-b")).toBeDefined()
  })

  it("handles null writer gracefully", async () => {
    // Should not throw
    const task = createTask()
    await syncTaskTodoUpdate(null, "sess-1", task)
  })

  it("handles writer failure gracefully", async () => {
    const failingWriter: TodoWriter = {
      async read() { throw new Error("read failed") },
      async update() { throw new Error("update failed") },
    }

    // Should not throw despite writer failure
    const task = createTask()
    await syncTaskTodoUpdate(failingWriter, "sess-1", task)
  })
})

describe("syncAllTasksToTodos", () => {
  it("preserves non-task todos during bulk sync", async () => {
    const writer = createMockWriter([
      { content: "Manual todo 1", status: "pending" },
      { content: "Manual todo 2", status: "in_progress" },
    ])

    const tasks = [
      createTask({ id: "T-1", subject: "Task 1" }),
      createTask({ id: "T-2", subject: "Task 2" }),
    ]
    await syncAllTasksToTodos(writer, "sess-1", tasks)

    // Both manual todos AND task todos should be present
    expect(writer.todos).toHaveLength(4)
    expect(writer.todos.find((t) => t.content === "Manual todo 1")).toBeDefined()
    expect(writer.todos.find((t) => t.content === "Manual todo 2")).toBeDefined()
    expect(writer.todos.find((t) => t.id === "T-1")).toBeDefined()
    expect(writer.todos.find((t) => t.id === "T-2")).toBeDefined()
  })

  it("removes deleted tasks from todo list", async () => {
    const writer = createMockWriter([
      { id: "T-1", content: "Task 1", status: "pending" },
      { id: "T-2", content: "Task 2", status: "pending" },
    ])

    const tasks = [
      createTask({ id: "T-1", subject: "Task 1" }),
      createTask({ id: "T-2", subject: "Task 2", status: "deleted" }),
    ]
    await syncAllTasksToTodos(writer, "sess-1", tasks)

    expect(writer.todos).toHaveLength(1)
    expect(writer.todos[0].id).toBe("T-1")
  })

  it("deduplicates when task subject matches existing todo content", async () => {
    const writer = createMockWriter([
      { content: "Task 1", status: "pending" }, // matches by content
    ])

    const tasks = [
      createTask({ id: "T-1", subject: "Task 1" }),
    ]
    await syncAllTasksToTodos(writer, "sess-1", tasks)

    // Should not have duplicate "Task 1" entries
    const matching = writer.todos.filter((t) => t.content === "Task 1")
    expect(matching).toHaveLength(1)
    expect(matching[0].id).toBe("T-1")
  })

  it("handles null writer gracefully", async () => {
    await syncAllTasksToTodos(null, "sess-1", [createTask()])
  })
})

describe("obliteration scenario", () => {
  it("documents that todowrite with partial list destroys items", async () => {
    // SCENARIO: The current failure mode with todowrite
    //
    // If you have todos [A, B, C] and call todowrite with just [B_updated],
    // the writer REPLACES the entire list — A and C are destroyed.
    //
    // This test documents the problem by showing what happens with a naive writer.
    const naiveWriter = createMockWriter([
      { id: "T-a", content: "Task A", status: "pending" },
      { id: "T-b", content: "Task B", status: "pending" },
      { id: "T-c", content: "Task C", status: "pending" },
    ])

    // Simulate what todowrite does: REPLACE the entire list
    const updatedB: TodoInfo = { id: "T-b", content: "Task B", status: "in_progress" }
    await naiveWriter.update("sess-1", [updatedB]) // <-- OBLITERATION: only B survives

    expect(naiveWriter.todos).toHaveLength(1) // A and C are GONE
    expect(naiveWriter.todos[0].id).toBe("T-b")
    // A and C have been destroyed — this is the problem todowrite causes
  })

  it("proves syncTaskTodoUpdate prevents obliteration", async () => {
    // SCENARIO: The fix — syncTaskTodoUpdate reads, merges, writes
    const writer = createMockWriter([
      { id: "T-a", content: "Task A", status: "pending" },
      { id: "T-b", content: "Task B", status: "pending" },
      { id: "T-c", content: "Task C", status: "pending" },
    ])

    // Update only B — but through the sync layer
    const taskB = createTask({ id: "T-b", subject: "Task B", status: "in_progress" })
    await syncTaskTodoUpdate(writer, "sess-1", taskB)

    // ALL items survive — B is updated, A and C are untouched
    expect(writer.todos).toHaveLength(3)
    expect(writer.todos.find((t) => t.id === "T-a")!.status).toBe("pending")
    expect(writer.todos.find((t) => t.id === "T-b")!.status).toBe("in_progress")
    expect(writer.todos.find((t) => t.id === "T-c")!.status).toBe("pending")
  })
})
