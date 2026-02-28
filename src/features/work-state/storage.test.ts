import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  readWorkState,
  writeWorkState,
  clearWorkState,
  appendSessionId,
  createWorkState,
  findPlans,
  getPlanProgress,
  getPlanName,
  getHeadSha,
  pauseWork,
  resumeWork,
} from "./storage"
import { WEAVE_DIR, PLANS_DIR } from "./constants"

let testDir: string

beforeEach(() => {
  testDir = join(tmpdir(), `weave-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors on Windows
  }
})

describe("readWorkState", () => {
  it("returns null when file does not exist", () => {
    expect(readWorkState(testDir)).toBeNull()
  })

  it("returns null for invalid JSON", () => {
    const dir = join(testDir, WEAVE_DIR)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "state.json"), "not json", "utf-8")
    expect(readWorkState(testDir)).toBeNull()
  })

  it("returns null for array JSON", () => {
    const dir = join(testDir, WEAVE_DIR)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "state.json"), "[]", "utf-8")
    expect(readWorkState(testDir)).toBeNull()
  })

  it("returns null when active_plan is missing", () => {
    const dir = join(testDir, WEAVE_DIR)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "state.json"), '{"plan_name":"test"}', "utf-8")
    expect(readWorkState(testDir)).toBeNull()
  })

  it("normalizes missing session_ids to empty array", () => {
    const dir = join(testDir, WEAVE_DIR)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, "state.json"),
      JSON.stringify({ active_plan: "/path/to/plan.md", started_at: "2026-01-01", plan_name: "test" }),
      "utf-8",
    )
    const state = readWorkState(testDir)
    expect(state).not.toBeNull()
    expect(state!.session_ids).toEqual([])
  })

  it("reads valid state", () => {
    const dir = join(testDir, WEAVE_DIR)
    mkdirSync(dir, { recursive: true })
    const expected = {
      active_plan: "/path/plan.md",
      started_at: "2026-01-01T00:00:00Z",
      session_ids: ["sess_1"],
      plan_name: "plan",
    }
    writeFileSync(join(dir, "state.json"), JSON.stringify(expected), "utf-8")
    expect(readWorkState(testDir)).toEqual(expected)
  })
})

describe("writeWorkState", () => {
  it("creates .weave directory and writes state", () => {
    const state = createWorkState("/path/plan.md", "sess_1")
    expect(writeWorkState(testDir, state)).toBe(true)
    expect(existsSync(join(testDir, WEAVE_DIR, "state.json"))).toBe(true)
    const read = readWorkState(testDir)
    expect(read!.active_plan).toBe("/path/plan.md")
  })
})

describe("clearWorkState", () => {
  it("deletes state file", () => {
    writeWorkState(testDir, createWorkState("/path/plan.md", "sess_1"))
    expect(clearWorkState(testDir)).toBe(true)
    expect(readWorkState(testDir)).toBeNull()
  })

  it("returns true even if file does not exist", () => {
    expect(clearWorkState(testDir)).toBe(true)
  })
})

describe("appendSessionId", () => {
  it("returns null when no state exists", () => {
    expect(appendSessionId(testDir, "sess_1")).toBeNull()
  })

  it("appends new session ID", () => {
    writeWorkState(testDir, createWorkState("/path/plan.md", "sess_1"))
    const updated = appendSessionId(testDir, "sess_2")
    expect(updated!.session_ids).toEqual(["sess_1", "sess_2"])
  })

  it("does not duplicate existing session ID", () => {
    writeWorkState(testDir, createWorkState("/path/plan.md", "sess_1"))
    appendSessionId(testDir, "sess_1")
    const state = readWorkState(testDir)
    expect(state!.session_ids).toEqual(["sess_1"])
  })
})

describe("createWorkState", () => {
  it("creates state with required fields", () => {
    const state = createWorkState("/proj/.weave/plans/my-plan.md", "sess_abc")
    expect(state.active_plan).toBe("/proj/.weave/plans/my-plan.md")
    expect(state.plan_name).toBe("my-plan")
    expect(state.session_ids).toEqual(["sess_abc"])
    expect(state.started_at).toBeTruthy()
    expect(state.agent).toBeUndefined()
  })

  it("includes agent when provided", () => {
    const state = createWorkState("/path/plan.md", "sess_1", "tapestry")
    expect(state.agent).toBe("tapestry")
  })

  it("includes start_sha when directory is a git repo", () => {
    // Use the actual weave repo root as the directory
    const state = createWorkState("/path/plan.md", "sess_1", "tapestry", process.cwd())
    expect(state.start_sha).toBeDefined()
    expect(state.start_sha!.length).toBe(40)
  })

  it("omits start_sha when directory is not provided", () => {
    const state = createWorkState("/path/plan.md", "sess_1", "tapestry")
    expect(state.start_sha).toBeUndefined()
  })

  it("omits start_sha when directory is not a git repo", () => {
    const state = createWorkState("/path/plan.md", "sess_1", "tapestry", testDir)
    expect(state.start_sha).toBeUndefined()
  })
})

describe("getHeadSha", () => {
  it("returns a 40-char SHA for a git repo", () => {
    const sha = getHeadSha(process.cwd())
    expect(sha).toBeDefined()
    expect(sha!.length).toBe(40)
    expect(/^[0-9a-f]{40}$/.test(sha!)).toBe(true)
  })

  it("returns undefined for a non-git directory", () => {
    const sha = getHeadSha(testDir)
    expect(sha).toBeUndefined()
  })
})

describe("findPlans", () => {
  it("returns empty array when plans directory does not exist", () => {
    expect(findPlans(testDir)).toEqual([])
  })

  it("returns only .md files", () => {
    const plansDir = join(testDir, PLANS_DIR)
    mkdirSync(plansDir, { recursive: true })
    writeFileSync(join(plansDir, "plan-a.md"), "# Plan A", "utf-8")
    writeFileSync(join(plansDir, "notes.txt"), "not a plan", "utf-8")
    writeFileSync(join(plansDir, "plan-b.md"), "# Plan B", "utf-8")
    const plans = findPlans(testDir)
    expect(plans).toHaveLength(2)
    expect(plans.every((p) => p.endsWith(".md"))).toBe(true)
  })

  it("returns absolute paths", () => {
    const plansDir = join(testDir, PLANS_DIR)
    mkdirSync(plansDir, { recursive: true })
    writeFileSync(join(plansDir, "plan.md"), "# Plan", "utf-8")
    const plans = findPlans(testDir)
    expect(plans[0]).toContain(testDir)
  })
})

describe("getPlanProgress", () => {
  it("returns isComplete:true for missing file", () => {
    const progress = getPlanProgress("/nonexistent/plan.md")
    expect(progress).toEqual({ total: 0, completed: 0, isComplete: true })
  })

  it("returns isComplete:true for file with no checkboxes", () => {
    const file = join(testDir, "no-checkboxes.md")
    writeFileSync(file, "# Plan\n\nJust text, no tasks.", "utf-8")
    expect(getPlanProgress(file).isComplete).toBe(true)
  })

  it("counts unchecked checkboxes", () => {
    const file = join(testDir, "plan.md")
    writeFileSync(file, "- [ ] Task 1\n- [ ] Task 2\n- [ ] Task 3\n", "utf-8")
    const progress = getPlanProgress(file)
    expect(progress.total).toBe(3)
    expect(progress.completed).toBe(0)
    expect(progress.isComplete).toBe(false)
  })

  it("counts mixed checked/unchecked", () => {
    const file = join(testDir, "plan.md")
    writeFileSync(file, "- [x] Done 1\n- [ ] Todo 2\n- [X] Done 3\n- [ ] Todo 4\n", "utf-8")
    const progress = getPlanProgress(file)
    expect(progress.total).toBe(4)
    expect(progress.completed).toBe(2)
    expect(progress.isComplete).toBe(false)
  })

  it("returns isComplete:true when all checked", () => {
    const file = join(testDir, "plan.md")
    writeFileSync(file, "- [x] Done 1\n- [X] Done 2\n", "utf-8")
    const progress = getPlanProgress(file)
    expect(progress.total).toBe(2)
    expect(progress.completed).toBe(2)
    expect(progress.isComplete).toBe(true)
  })

  it("handles * bullet style", () => {
    const file = join(testDir, "plan.md")
    writeFileSync(file, "* [ ] Task 1\n* [x] Done 1\n", "utf-8")
    const progress = getPlanProgress(file)
    expect(progress.total).toBe(2)
    expect(progress.completed).toBe(1)
  })
})

describe("getPlanName", () => {
  it("extracts name from path", () => {
    expect(getPlanName("/proj/.weave/plans/my-feature.md")).toBe("my-feature")
  })

  it("handles path without .md extension", () => {
    expect(getPlanName("/proj/.weave/plans/readme")).toBe("readme")
  })
})

describe("pauseWork", () => {
  it("returns false when no state exists", () => {
    expect(pauseWork(testDir)).toBe(false)
  })

  it("sets paused: true on existing state", () => {
    writeWorkState(testDir, createWorkState("/path/plan.md", "sess_1"))
    expect(pauseWork(testDir)).toBe(true)
    const state = readWorkState(testDir)
    expect(state!.paused).toBe(true)
  })

  it("preserves other state fields when pausing", () => {
    const original = createWorkState("/path/plan.md", "sess_1", "tapestry")
    writeWorkState(testDir, original)
    pauseWork(testDir)
    const state = readWorkState(testDir)
    expect(state!.active_plan).toBe("/path/plan.md")
    expect(state!.session_ids).toEqual(["sess_1"])
    expect(state!.agent).toBe("tapestry")
    expect(state!.paused).toBe(true)
  })
})

describe("resumeWork", () => {
  it("returns false when no state exists", () => {
    expect(resumeWork(testDir)).toBe(false)
  })

  it("sets paused: false on existing state", () => {
    const state = createWorkState("/path/plan.md", "sess_1")
    writeWorkState(testDir, { ...state, paused: true })
    expect(resumeWork(testDir)).toBe(true)
    const updated = readWorkState(testDir)
    expect(updated!.paused).toBe(false)
  })

  it("clears paused even when it was already false", () => {
    writeWorkState(testDir, createWorkState("/path/plan.md", "sess_1"))
    expect(resumeWork(testDir)).toBe(true)
    const state = readWorkState(testDir)
    expect(state!.paused).toBe(false)
  })
})
