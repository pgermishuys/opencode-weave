import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { execSync } from "child_process"
import { getChangedFiles } from "./git-diff"

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "weave-git-diff-test-"))
})

afterEach(() => {
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
})

function initGitRepo(): void {
  execSync("git init", { cwd: tempDir, stdio: "pipe" })
  execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: "pipe" })
  execSync('git config user.name "Test"', { cwd: tempDir, stdio: "pipe" })
}

function commitFile(name: string, content: string): string {
  writeFileSync(join(tempDir, name), content, "utf-8")
  execSync(`git add "${name}"`, { cwd: tempDir, stdio: "pipe" })
  execSync(`git commit -m "add ${name}"`, { cwd: tempDir, stdio: "pipe" })
  return execSync("git rev-parse HEAD", { cwd: tempDir, encoding: "utf-8" }).trim()
}

describe("getChangedFiles", () => {
  it("returns files changed between a SHA and HEAD", () => {
    initGitRepo()
    writeFileSync(join(tempDir, "initial.txt"), "init", "utf-8")
    execSync("git add .", { cwd: tempDir, stdio: "pipe" })
    execSync('git commit -m "initial"', { cwd: tempDir, stdio: "pipe" })
    const baseSha = execSync("git rev-parse HEAD", { cwd: tempDir, encoding: "utf-8" }).trim()

    writeFileSync(join(tempDir, "changed.txt"), "changed", "utf-8")
    execSync("git add .", { cwd: tempDir, stdio: "pipe" })
    execSync('git commit -m "change"', { cwd: tempDir, stdio: "pipe" })

    const files = getChangedFiles(tempDir, baseSha)
    expect(files).toEqual(["changed.txt"])
  })

  it("returns multiple changed files", () => {
    initGitRepo()
    commitFile("base.txt", "base")
    const baseSha = execSync("git rev-parse HEAD", { cwd: tempDir, encoding: "utf-8" }).trim()

    writeFileSync(join(tempDir, "a.ts"), "a", "utf-8")
    writeFileSync(join(tempDir, "b.ts"), "b", "utf-8")
    mkdirSync(join(tempDir, "src"), { recursive: true })
    writeFileSync(join(tempDir, "src/c.ts"), "c", "utf-8")
    execSync("git add .", { cwd: tempDir, stdio: "pipe" })
    execSync('git commit -m "add files"', { cwd: tempDir, stdio: "pipe" })

    const files = getChangedFiles(tempDir, baseSha)
    expect(files.sort()).toEqual(["a.ts", "b.ts", "src/c.ts"])
  })

  it("includes modified files", () => {
    initGitRepo()
    commitFile("existing.txt", "original")
    const baseSha = execSync("git rev-parse HEAD", { cwd: tempDir, encoding: "utf-8" }).trim()

    writeFileSync(join(tempDir, "existing.txt"), "modified", "utf-8")
    execSync("git add .", { cwd: tempDir, stdio: "pipe" })
    execSync('git commit -m "modify"', { cwd: tempDir, stdio: "pipe" })

    const files = getChangedFiles(tempDir, baseSha)
    expect(files).toEqual(["existing.txt"])
  })

  it("returns empty array for invalid SHA", () => {
    initGitRepo()
    commitFile("file.txt", "content")
    const files = getChangedFiles(tempDir, "0000000000000000000000000000000000000000")
    expect(files).toEqual([])
  })

  it("returns empty array for non-git directory", () => {
    const files = getChangedFiles(tempDir, "abc123")
    expect(files).toEqual([])
  })

  it("returns empty array when no changes between SHA and HEAD", () => {
    initGitRepo()
    commitFile("file.txt", "content")
    const sha = execSync("git rev-parse HEAD", { cwd: tempDir, encoding: "utf-8" }).trim()
    const files = getChangedFiles(tempDir, sha)
    expect(files).toEqual([])
  })

  it("returns empty array for malicious SHA (command injection prevention)", () => {
    initGitRepo()
    commitFile("file.txt", "content")
    const malicious = "; echo pwned #"
    const files = getChangedFiles(tempDir, malicious)
    expect(files).toEqual([])
  })

  it("returns empty array for SHA containing shell metacharacters", () => {
    initGitRepo()
    commitFile("file.txt", "content")
    expect(getChangedFiles(tempDir, "$(whoami)")).toEqual([])
    expect(getChangedFiles(tempDir, "abc && rm -rf /")).toEqual([])
    expect(getChangedFiles(tempDir, "`id`")).toEqual([])
  })
})
