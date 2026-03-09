import { describe, it, expect } from "bun:test"
import { mkdtempSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { extractPlannedFiles } from "./plan-parser"

function createTempPlan(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "weave-plan-parser-test-"))
  const planPath = join(dir, "test-plan.md")
  writeFileSync(planPath, content, "utf-8")
  return planPath
}

describe("extractPlannedFiles", () => {
  it("extracts file paths from **Files**: lines in ## TODOs section", () => {
    const planPath = createTempPlan(`# My Plan

## TODOs

- [ ] 1. **Do something**
  **What**: Build a thing
  **Files**: src/foo.ts, src/bar.ts

- [ ] 2. **Do another thing**
  **What**: Build another
  **Files**: src/baz.ts
`)
    const files = extractPlannedFiles(planPath)
    expect(files).toEqual(["src/foo.ts", "src/bar.ts", "src/baz.ts"])
  })

  it("strips (new) suffix from file paths", () => {
    const planPath = createTempPlan(`# Plan

## TODOs

- [ ] 1. **Create module**
  **Files**: src/new-module.ts (new), src/existing.ts
`)
    const files = extractPlannedFiles(planPath)
    expect(files).toContain("src/new-module.ts")
    expect(files).toContain("src/existing.ts")
    expect(files.every((f) => !f.includes("(new)"))).toBe(true)
  })

  it("strips Create prefix from file paths", () => {
    const planPath = createTempPlan(`# Plan

## TODOs

- [ ] 1. **Add file**
  **Files**: Create src/new-file.ts
`)
    const files = extractPlannedFiles(planPath)
    expect(files).toEqual(["src/new-file.ts"])
  })

  it("deduplicates file paths", () => {
    const planPath = createTempPlan(`# Plan

## TODOs

- [ ] 1. **Task one**
  **Files**: src/shared.ts, src/a.ts
- [ ] 2. **Task two**
  **Files**: src/shared.ts, src/b.ts
`)
    const files = extractPlannedFiles(planPath)
    const sharedCount = files.filter((f) => f === "src/shared.ts").length
    expect(sharedCount).toBe(1)
    expect(files).toContain("src/a.ts")
    expect(files).toContain("src/b.ts")
  })

  it("returns empty array when file does not exist", () => {
    const files = extractPlannedFiles("/nonexistent/path/plan.md")
    expect(files).toEqual([])
  })

  it("returns empty array when no ## TODOs section exists", () => {
    const planPath = createTempPlan(`# Plan

## Context
Some context here.
`)
    const files = extractPlannedFiles(planPath)
    expect(files).toEqual([])
  })

  it("returns empty array when ## TODOs has no **Files** lines", () => {
    const planPath = createTempPlan(`# Plan

## TODOs

- [ ] 1. **Do something**
  **What**: Build a thing without files listed
`)
    const files = extractPlannedFiles(planPath)
    expect(files).toEqual([])
  })

  it("handles **Files** with only prose (no file paths)", () => {
    const planPath = createTempPlan(`# Plan

## TODOs

- [ ] 1. **Task**
  **Files**: various configuration files
`)
    const files = extractPlannedFiles(planPath)
    // "various configuration files" has no / and no recognized extension
    expect(files).toEqual([])
  })

  it("handles files with .json and .md extensions", () => {
    const planPath = createTempPlan(`# Plan

## TODOs

- [ ] 1. **Task**
  **Files**: package.json, README.md, src/index.ts
`)
    const files = extractPlannedFiles(planPath)
    expect(files).toContain("package.json")
    expect(files).toContain("README.md")
    expect(files).toContain("src/index.ts")
  })

  it("stops at the next ## section", () => {
    const planPath = createTempPlan(`# Plan

## TODOs

- [ ] 1. **Task**
  **Files**: src/todo.ts

## Verification

**Files**: src/verify.ts
`)
    const files = extractPlannedFiles(planPath)
    expect(files).toEqual(["src/todo.ts"])
    expect(files).not.toContain("src/verify.ts")
  })
})
