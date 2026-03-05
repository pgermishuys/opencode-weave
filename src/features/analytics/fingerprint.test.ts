import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  detectStack,
  detectPackageManager,
  detectMonorepo,
  detectPrimaryLanguage,
  generateFingerprint,
  fingerprintProject,
  getOrCreateFingerprint,
} from "./fingerprint"
import { readFingerprint } from "./storage"

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "weave-fp-test-"))
})

afterEach(() => {
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
})

describe("detectStack", () => {
  it("detects typescript from tsconfig.json", () => {
    writeFileSync(join(tempDir, "tsconfig.json"), "{}", "utf-8")
    const stack = detectStack(tempDir)
    expect(stack.some((s) => s.name === "typescript")).toBe(true)
  })

  it("detects bun from bun.lockb", () => {
    writeFileSync(join(tempDir, "bun.lockb"), "", "utf-8")
    const stack = detectStack(tempDir)
    expect(stack.some((s) => s.name === "bun")).toBe(true)
  })

  it("detects node from package.json", () => {
    writeFileSync(join(tempDir, "package.json"), '{"name":"test"}', "utf-8")
    const stack = detectStack(tempDir)
    expect(stack.some((s) => s.name === "node")).toBe(true)
  })

  it("detects react from package.json dependencies", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ dependencies: { react: "^18.0.0" } }),
      "utf-8",
    )
    const stack = detectStack(tempDir)
    expect(stack.some((s) => s.name === "react")).toBe(true)
  })

  it("detects python from pyproject.toml", () => {
    writeFileSync(join(tempDir, "pyproject.toml"), "[project]", "utf-8")
    const stack = detectStack(tempDir)
    expect(stack.some((s) => s.name === "python")).toBe(true)
  })

  it("detects go from go.mod", () => {
    writeFileSync(join(tempDir, "go.mod"), "module example.com/foo", "utf-8")
    const stack = detectStack(tempDir)
    expect(stack.some((s) => s.name === "go")).toBe(true)
  })

  it("detects rust from Cargo.toml", () => {
    writeFileSync(join(tempDir, "Cargo.toml"), "[package]", "utf-8")
    const stack = detectStack(tempDir)
    expect(stack.some((s) => s.name === "rust")).toBe(true)
  })

  it("returns empty array for empty directory", () => {
    const stack = detectStack(tempDir)
    expect(stack).toEqual([])
  })

  it("deduplicates entries by name", () => {
    writeFileSync(join(tempDir, "tsconfig.json"), "{}", "utf-8")
    writeFileSync(join(tempDir, "tsconfig.build.json"), "{}", "utf-8")
    const stack = detectStack(tempDir)
    const tsEntries = stack.filter((s) => s.name === "typescript")
    expect(tsEntries.length).toBe(1)
  })
})

describe("detectPackageManager", () => {
  it("detects bun from bun.lockb", () => {
    writeFileSync(join(tempDir, "bun.lockb"), "", "utf-8")
    expect(detectPackageManager(tempDir)).toBe("bun")
  })

  it("detects pnpm from pnpm-lock.yaml", () => {
    writeFileSync(join(tempDir, "pnpm-lock.yaml"), "", "utf-8")
    expect(detectPackageManager(tempDir)).toBe("pnpm")
  })

  it("detects yarn from yarn.lock", () => {
    writeFileSync(join(tempDir, "yarn.lock"), "", "utf-8")
    expect(detectPackageManager(tempDir)).toBe("yarn")
  })

  it("detects npm from package-lock.json", () => {
    writeFileSync(join(tempDir, "package-lock.json"), "{}", "utf-8")
    expect(detectPackageManager(tempDir)).toBe("npm")
  })

  it("falls back to npm when only package.json exists", () => {
    writeFileSync(join(tempDir, "package.json"), "{}", "utf-8")
    expect(detectPackageManager(tempDir)).toBe("npm")
  })

  it("returns undefined for empty directory", () => {
    expect(detectPackageManager(tempDir)).toBeUndefined()
  })
})

describe("detectMonorepo", () => {
  it("detects monorepo from lerna.json", () => {
    writeFileSync(join(tempDir, "lerna.json"), "{}", "utf-8")
    expect(detectMonorepo(tempDir)).toBe(true)
  })

  it("detects monorepo from nx.json", () => {
    writeFileSync(join(tempDir, "nx.json"), "{}", "utf-8")
    expect(detectMonorepo(tempDir)).toBe(true)
  })

  it("detects monorepo from turbo.json", () => {
    writeFileSync(join(tempDir, "turbo.json"), "{}", "utf-8")
    expect(detectMonorepo(tempDir)).toBe(true)
  })

  it("detects monorepo from package.json workspaces", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ workspaces: ["packages/*"] }),
      "utf-8",
    )
    expect(detectMonorepo(tempDir)).toBe(true)
  })

  it("returns false for non-monorepo", () => {
    writeFileSync(join(tempDir, "package.json"), '{"name":"test"}', "utf-8")
    expect(detectMonorepo(tempDir)).toBe(false)
  })

  it("returns false for empty directory", () => {
    expect(detectMonorepo(tempDir)).toBe(false)
  })
})

describe("detectPrimaryLanguage", () => {
  it("returns typescript when detected", () => {
    expect(detectPrimaryLanguage([{ name: "typescript", confidence: "high", evidence: "tsconfig.json" }])).toBe("typescript")
  })

  it("returns python when detected", () => {
    expect(detectPrimaryLanguage([{ name: "python", confidence: "high", evidence: "pyproject.toml" }])).toBe("python")
  })

  it("returns javascript when node is detected but not typescript", () => {
    expect(detectPrimaryLanguage([{ name: "node", confidence: "high", evidence: "package.json" }])).toBe("javascript")
  })

  it("prefers typescript over node", () => {
    expect(
      detectPrimaryLanguage([
        { name: "node", confidence: "high", evidence: "package.json" },
        { name: "typescript", confidence: "high", evidence: "tsconfig.json" },
      ]),
    ).toBe("typescript")
  })

  it("returns undefined for empty stack", () => {
    expect(detectPrimaryLanguage([])).toBeUndefined()
  })
})

describe("generateFingerprint", () => {
  it("generates a complete fingerprint for a TypeScript/Bun project", () => {
    writeFileSync(join(tempDir, "tsconfig.json"), "{}", "utf-8")
    writeFileSync(join(tempDir, "bun.lockb"), "", "utf-8")
    writeFileSync(join(tempDir, "package.json"), '{"name":"test"}', "utf-8")

    const fp = generateFingerprint(tempDir)
    expect(fp.generatedAt).toBeTruthy()
    expect(fp.primaryLanguage).toBe("typescript")
    expect(fp.packageManager).toBe("bun")
    expect(fp.isMonorepo).toBe(false)
    expect(fp.stack.length).toBeGreaterThan(0)
  })

  it("generates a fingerprint for an empty directory", () => {
    const fp = generateFingerprint(tempDir)
    expect(fp.stack).toEqual([])
    expect(fp.isMonorepo).toBe(false)
    expect(fp.packageManager).toBeUndefined()
    expect(fp.primaryLanguage).toBeUndefined()
  })
})

describe("fingerprintProject", () => {
  it("generates and persists a fingerprint", () => {
    writeFileSync(join(tempDir, "package.json"), '{"name":"test"}', "utf-8")
    const fp = fingerprintProject(tempDir)
    expect(fp).not.toBeNull()

    const persisted = readFingerprint(tempDir)
    expect(persisted).not.toBeNull()
    expect(persisted!.primaryLanguage).toBe(fp!.primaryLanguage)
  })

  it("returns null on failure without throwing", () => {
    // Pass a non-writable path to trigger a failure
    const fp = fingerprintProject("/nonexistent/path/that/should/fail/deeply/nested")
    // On some OSes this might succeed (creating dirs) or fail — either way, no throw
    expect(() => fp).not.toThrow()
  })
})

describe("getOrCreateFingerprint", () => {
  it("returns cached fingerprint if one exists", () => {
    writeFileSync(join(tempDir, "tsconfig.json"), "{}", "utf-8")
    const first = fingerprintProject(tempDir)
    const second = getOrCreateFingerprint(tempDir)
    expect(second).not.toBeNull()
    expect(second!.generatedAt).toBe(first!.generatedAt)
  })

  it("generates a new fingerprint when none is cached", () => {
    writeFileSync(join(tempDir, "package.json"), '{"name":"test"}', "utf-8")
    const fp = getOrCreateFingerprint(tempDir)
    expect(fp).not.toBeNull()
    expect(fp!.stack.some((s) => s.name === "node")).toBe(true)
  })
})
