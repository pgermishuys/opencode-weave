import { describe, it, expect } from "bun:test"
import { createToolPermissions } from "./permissions"

describe("createToolPermissions", () => {
  it("allows tool when agent has no restrictions", () => {
    const perms = createToolPermissions({})
    expect(perms.isToolAllowed("loom", "write")).toBe(true)
  })

  it("denies tool when restriction is false", () => {
    const perms = createToolPermissions({ thread: { write: false, edit: false } })
    expect(perms.isToolAllowed("thread", "write")).toBe(false)
    expect(perms.isToolAllowed("thread", "edit")).toBe(false)
  })

  it("allows tool not in restrictions (undefined = allowed)", () => {
    const perms = createToolPermissions({ thread: { write: false } })
    expect(perms.isToolAllowed("thread", "read")).toBe(true)
  })

  it("allows tool when restriction is true", () => {
    const perms = createToolPermissions({ loom: { write: true } })
    expect(perms.isToolAllowed("loom", "write")).toBe(true)
  })

  it("returns empty object for unknown agent in getRestrictions", () => {
    const perms = createToolPermissions({})
    expect(perms.getRestrictions("unknown")).toEqual({})
  })

  it("returns correct restriction map for known agent", () => {
    const map = { write: false, task: false }
    const perms = createToolPermissions({ tapestry: map })
    expect(perms.getRestrictions("tapestry")).toEqual(map)
  })
})
