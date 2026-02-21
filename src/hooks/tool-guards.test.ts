import { describe, it, expect } from "bun:test"
import { createWriteGuardState, checkWriteAllowed, trackFileRead, createWriteGuard } from "./write-existing-file-guard"
import { shouldInjectRules, buildRulesInjection, getDirectoryFromFilePath } from "./rules-injector"
import * as path from "path"

// Resolve a file path that exists on any platform (Windows dev, Linux CI, etc.)
const EXISTING_FILE = path.resolve(import.meta.dir, "../../package.json")

describe("WriteExistingFileGuard", () => {
  it("allows writing to new (non-existent) files without reading first", () => {
    const state = createWriteGuardState()
    const result = checkWriteAllowed(state, `/tmp/weave-test-nonexistent-${Date.now()}.ts`)
    expect(result.allowed).toBe(true)
  })

  it("unread files are not in readFiles set initially", () => {
    const state = createWriteGuardState()
    expect(state.readFiles.has("/some/file.ts")).toBe(false)
  })

  it("allows write after file is tracked as read", () => {
    const state = createWriteGuardState()
    trackFileRead(state, "/some/file.ts")
    expect(state.readFiles.has("/some/file.ts")).toBe(true)
  })

  it("createWriteGuard returns object with trackRead and checkWrite", () => {
    const state = createWriteGuardState()
    const guard = createWriteGuard(state)
    expect(typeof guard.trackRead).toBe("function")
    expect(typeof guard.checkWrite).toBe("function")
  })

  it("guard.trackRead registers the file path", () => {
    const state = createWriteGuardState()
    const guard = createWriteGuard(state)
    guard.trackRead("/project/src/index.ts")
    expect(state.readFiles.has("/project/src/index.ts")).toBe(true)
  })

  it("blocks write to existing unread file with warning", () => {
    // Use a file we know exists in this project (resolved for any platform)
    const state = createWriteGuardState()
    const result = checkWriteAllowed(state, EXISTING_FILE)
    expect(result.allowed).toBe(false)
    expect(result.warning).toContain("Write guard")
  })

  it("allows write to existing file after tracking read", () => {
    const state = createWriteGuardState()
    trackFileRead(state, EXISTING_FILE)
    const result = checkWriteAllowed(state, EXISTING_FILE)
    expect(result.allowed).toBe(true)
  })
})

describe("RulesInjector", () => {
  it("shouldInjectRules returns true for read/write/edit tools", () => {
    expect(shouldInjectRules("read")).toBe(true)
    expect(shouldInjectRules("write")).toBe(true)
    expect(shouldInjectRules("edit")).toBe(true)
  })

  it("shouldInjectRules returns false for other tools", () => {
    expect(shouldInjectRules("grep")).toBe(false)
    expect(shouldInjectRules("bash")).toBe(false)
    expect(shouldInjectRules("lsp_hover")).toBe(false)
  })

  it("buildRulesInjection wraps content with rules tags", () => {
    const result = buildRulesInjection("# Rules content", "/project")
    expect(result).toContain('<rules source="/project">')
    expect(result).toContain("# Rules content")
    expect(result).toContain("</rules>")
  })

  it("getDirectoryFromFilePath returns parent directory", () => {
    const dir = getDirectoryFromFilePath("/project/src/index.ts")
    expect(dir).toBe(path.resolve("/project/src"))
  })
})
