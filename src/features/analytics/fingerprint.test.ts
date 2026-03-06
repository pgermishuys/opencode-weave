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
import { readFingerprint, writeFingerprint } from "./storage"
import { getWeaveVersion } from "../../shared/version"

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

  it("detects dotnet from global.json", () => {
    writeFileSync(join(tempDir, "global.json"), '{"sdk":{}}', "utf-8")
    const stack = detectStack(tempDir)
    expect(stack.some((s) => s.name === "dotnet")).toBe(true)
  })

  it("detects dotnet from .csproj file", () => {
    writeFileSync(join(tempDir, "MyApp.csproj"), "<Project/>", "utf-8")
    const stack = detectStack(tempDir)
    expect(stack.some((s) => s.name === "dotnet")).toBe(true)
    expect(stack.find((s) => s.name === "dotnet")!.evidence).toContain("MyApp.csproj")
  })

  it("detects dotnet from .sln file", () => {
    writeFileSync(join(tempDir, "MyApp.sln"), "", "utf-8")
    const stack = detectStack(tempDir)
    expect(stack.some((s) => s.name === "dotnet")).toBe(true)
  })

  it("does not duplicate dotnet when both global.json and .csproj exist", () => {
    writeFileSync(join(tempDir, "global.json"), '{"sdk":{}}', "utf-8")
    writeFileSync(join(tempDir, "MyApp.csproj"), "<Project/>", "utf-8")
    const stack = detectStack(tempDir)
    const dotnetEntries = stack.filter((s) => s.name === "dotnet")
    expect(dotnetEntries.length).toBe(1)
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

  it("includes os and arch fields", () => {
    const fp = generateFingerprint(tempDir)
    expect(fp.os).toBe(process.platform)
    expect(typeof fp.arch).toBe("string")
    expect(fp.arch!.length).toBeGreaterThan(0)
  })

  it("includes weaveVersion field", () => {
    const fp = generateFingerprint(tempDir)
    expect(typeof fp.weaveVersion).toBe("string")
    expect(fp.weaveVersion).toMatch(/^\d+\.\d+\.\d+/)
    expect(fp.weaveVersion).toBe(getWeaveVersion())
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

  it("does not throw on failure", () => {
    // Pass a non-writable path — on some OSes this succeeds, on others it fails.
    // Either way, fingerprintProject must never throw.
    let fp: ReturnType<typeof fingerprintProject>
    expect(() => {
      fp = fingerprintProject("/nonexistent/path/that/should/fail/deeply/nested")
    }).not.toThrow()
    // Result is either a valid fingerprint or null — both are acceptable
    expect(fp! === null || typeof fp!.generatedAt === "string").toBe(true)
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

  it("regenerates when cached fingerprint has no weaveVersion (legacy)", () => {
    // Write a legacy fingerprint without weaveVersion
    writeFingerprint(tempDir, {
      generatedAt: "2024-01-01T00:00:00.000Z",
      stack: [],
      isMonorepo: false,
    })
    const fp = getOrCreateFingerprint(tempDir)
    expect(fp).not.toBeNull()
    // Should have regenerated — generatedAt must differ from the legacy value
    expect(fp!.generatedAt).not.toBe("2024-01-01T00:00:00.000Z")
    // New fingerprint must include weaveVersion
    expect(fp!.weaveVersion).toBe(getWeaveVersion())
  })

  it("regenerates when cached fingerprint has a stale weaveVersion", () => {
    // Write a fingerprint with an old version
    writeFingerprint(tempDir, {
      generatedAt: "2024-01-01T00:00:00.000Z",
      stack: [],
      isMonorepo: false,
      weaveVersion: "0.0.1",
    })
    const fp = getOrCreateFingerprint(tempDir)
    expect(fp).not.toBeNull()
    expect(fp!.weaveVersion).toBe(getWeaveVersion())
    expect(fp!.generatedAt).not.toBe("2024-01-01T00:00:00.000Z")
  })

  it("returns cached fingerprint when weaveVersion matches", () => {
    // Generate a fresh fingerprint (has correct weaveVersion)
    const first = fingerprintProject(tempDir)
    expect(first).not.toBeNull()
    expect(first!.weaveVersion).toBe(getWeaveVersion())

    // getOrCreateFingerprint should return from cache (same generatedAt)
    const second = getOrCreateFingerprint(tempDir)
    expect(second).not.toBeNull()
    expect(second!.generatedAt).toBe(first!.generatedAt)
  })
})
