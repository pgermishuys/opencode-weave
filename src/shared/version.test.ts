import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"
import { fileURLToPath } from "url"
import { dirname } from "path"
import { getWeaveVersion } from "./version"

describe("getWeaveVersion", () => {
  it("returns a semver-like string", () => {
    const version = getWeaveVersion()
    expect(version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it("returns the same value on repeated calls (caching)", () => {
    const first = getWeaveVersion()
    const second = getWeaveVersion()
    expect(first).toBe(second)
  })

  it("matches the version in package.json", () => {
    const thisDir = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(join(thisDir, "../../package.json"), "utf-8"))
    expect(getWeaveVersion()).toBe(pkg.version)
  })
})
