import { describe, it, expect, beforeEach } from "bun:test"
import { BackgroundManager } from "./background-manager"
import type { SpawnOptions, TaskRecord } from "./background-manager"

const defaultOptions: SpawnOptions = {
  agentName: "loom",
  prompt: "Do something useful",
}

describe("BackgroundManager", () => {
  let manager: BackgroundManager

  beforeEach(() => {
    manager = new BackgroundManager()
  })

  // ── spawn ────────────────────────────────────────────────────────────────

  describe("spawn()", () => {
    it("creates a task with status 'pending' and returns a string ID", () => {
      const id = manager.spawn(defaultOptions)

      expect(typeof id).toBe("string")
      expect(id.length).toBeGreaterThan(0)

      const task = manager.getTask(id)
      expect(task).toBeDefined()
      expect(task?.status).toBe("pending")
    })

    it("stores the supplied options on the task record", () => {
      const options: SpawnOptions = {
        agentName: "shuttle",
        prompt: "Analyse logs",
        category: "analysis",
        skills: ["log-reader"],
        concurrencyKey: "unique-key",
      }
      const id = manager.spawn(options)
      const task = manager.getTask(id)

      expect(task?.options).toEqual(options)
    })

    it("sets startedAt to a Date on the task record", () => {
      const before = new Date()
      const id = manager.spawn(defaultOptions)
      const after = new Date()

      const task = manager.getTask(id)
      expect(task?.startedAt).toBeInstanceOf(Date)
      expect(task?.startedAt?.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(task?.startedAt?.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it("generates unique IDs for each spawned task", () => {
      const ids = new Set([
        manager.spawn(defaultOptions),
        manager.spawn(defaultOptions),
        manager.spawn(defaultOptions),
      ])
      expect(ids.size).toBe(3)
    })

    it("throws when concurrency limit is reached", () => {
      const mgr = new BackgroundManager({ maxConcurrent: 2 })
      const id1 = mgr.spawn({ agentName: "loom", prompt: "task 1" })
      const id2 = mgr.spawn({ agentName: "loom", prompt: "task 2" })
      // Manually set both to "running" status (Map stores object references, direct mutation works)
      const task1 = mgr.getTask(id1) as TaskRecord
      const task2 = mgr.getTask(id2) as TaskRecord
      task1.status = "running"
      task2.status = "running"
      // Now spawning a 3rd task should throw
      expect(() => mgr.spawn({ agentName: "loom", prompt: "task 3" })).toThrow("Concurrency limit reached")
    })
  })

  // ── getTask ──────────────────────────────────────────────────────────────

  describe("getTask()", () => {
    it("returns the task record for a known ID", () => {
      const id = manager.spawn(defaultOptions)
      const task = manager.getTask(id)

      expect(task).toBeDefined()
      expect(task?.id).toBe(id)
    })

    it("returns undefined for an unknown ID", () => {
      expect(manager.getTask("does-not-exist")).toBeUndefined()
    })
  })

  // ── cancel ───────────────────────────────────────────────────────────────

  describe("cancel()", () => {
    it("sets task status to 'cancelled' and returns true", () => {
      const id = manager.spawn(defaultOptions)
      const result = manager.cancel(id)

      expect(result).toBe(true)
      expect(manager.getTask(id)?.status).toBe("cancelled")
    })

    it("sets completedAt when cancelling", () => {
      const id = manager.spawn(defaultOptions)
      const before = new Date()
      manager.cancel(id)
      const after = new Date()

      const task = manager.getTask(id)
      expect(task?.completedAt).toBeInstanceOf(Date)
      expect(task?.completedAt?.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(task?.completedAt?.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it("returns false for a non-existent task ID", () => {
      expect(manager.cancel("does-not-exist")).toBe(false)
    })

    it("returns false when task is already 'cancelled'", () => {
      const id = manager.spawn(defaultOptions)
      manager.cancel(id) // first cancel
      const second = manager.cancel(id) // second attempt
      expect(second).toBe(false)
    })

    it("returns false when task is in a terminal 'completed' state", () => {
      const id = manager.spawn(defaultOptions)
      // Manually set to completed (simulates a task finishing)
      const task = manager.getTask(id) as TaskRecord
      task.status = "completed"

      expect(manager.cancel(id)).toBe(false)
    })

    it("returns false when task is in a terminal 'failed' state", () => {
      const id = manager.spawn(defaultOptions)
      const task = manager.getTask(id) as TaskRecord
      task.status = "failed"

      expect(manager.cancel(id)).toBe(false)
    })

    it("can cancel a 'running' task", () => {
      const id = manager.spawn(defaultOptions)
      const task = manager.getTask(id) as TaskRecord
      task.status = "running"

      expect(manager.cancel(id)).toBe(true)
      expect(manager.getTask(id)?.status).toBe("cancelled")
    })
  })

  // ── cancelAll ────────────────────────────────────────────────────────────

  describe("cancelAll()", () => {
    it("cancels all pending tasks", () => {
      manager.spawn(defaultOptions)
      manager.spawn(defaultOptions)
      manager.spawn(defaultOptions)

      manager.cancelAll()

      const tasks = manager.list()
      for (const task of tasks) {
        expect(task.status).toBe("cancelled")
      }
    })

    it("does not alter tasks already in terminal states", () => {
      const pendingId = manager.spawn(defaultOptions)
      const completedId = manager.spawn(defaultOptions)
      const failedId = manager.spawn(defaultOptions)

      const completedTask = manager.getTask(completedId) as TaskRecord
      completedTask.status = "completed"

      const failedTask = manager.getTask(failedId) as TaskRecord
      failedTask.status = "failed"

      manager.cancelAll()

      expect(manager.getTask(pendingId)?.status).toBe("cancelled")
      expect(manager.getTask(completedId)?.status).toBe("completed")
      expect(manager.getTask(failedId)?.status).toBe("failed")
    })
  })

  // ── list ─────────────────────────────────────────────────────────────────

  describe("list()", () => {
    it("returns all tasks when called without a filter", () => {
      manager.spawn(defaultOptions)
      manager.spawn(defaultOptions)

      expect(manager.list()).toHaveLength(2)
    })

    it("returns an empty array when no tasks have been spawned", () => {
      expect(manager.list()).toHaveLength(0)
    })

    it("filters tasks by status when filter.status is provided", () => {
      const id1 = manager.spawn(defaultOptions)
      const id2 = manager.spawn(defaultOptions)
      manager.spawn(defaultOptions) // stays pending

      // Force id1 to running, id2 to cancelled
      const t1 = manager.getTask(id1) as TaskRecord
      t1.status = "running"
      manager.cancel(id2)

      const pending = manager.list({ status: "pending" })
      const running = manager.list({ status: "running" })
      const cancelled = manager.list({ status: "cancelled" })

      expect(pending).toHaveLength(1)
      expect(running).toHaveLength(1)
      expect(cancelled).toHaveLength(1)
    })

    it("returns an empty array when no tasks match the filter", () => {
      manager.spawn(defaultOptions) // pending

      expect(manager.list({ status: "completed" })).toHaveLength(0)
    })
  })

  // ── getRunningCount ──────────────────────────────────────────────────────

  describe("getRunningCount()", () => {
    it("returns 0 when no tasks are running", () => {
      manager.spawn(defaultOptions)
      expect(manager.getRunningCount()).toBe(0)
    })

    it("returns the correct count of running tasks", () => {
      const id1 = manager.spawn(defaultOptions)
      const id2 = manager.spawn(defaultOptions)
      manager.spawn(defaultOptions) // stays pending

      const t1 = manager.getTask(id1) as TaskRecord
      const t2 = manager.getTask(id2) as TaskRecord
      t1.status = "running"
      t2.status = "running"

      expect(manager.getRunningCount()).toBe(2)
    })
  })

  // ── constructor ──────────────────────────────────────────────────────────

  describe("constructor()", () => {
    it("defaults maxConcurrent to 5", () => {
      expect(new BackgroundManager().maxConcurrent).toBe(5)
    })

    it("accepts a custom maxConcurrent value", () => {
      expect(new BackgroundManager({ maxConcurrent: 10 }).maxConcurrent).toBe(10)
    })
  })
})
