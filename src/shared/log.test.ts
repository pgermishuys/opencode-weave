import { describe, it, expect, beforeEach } from "bun:test"
import * as fs from "fs"
import { log, getLogFilePath, logDelegation } from "./log"

const logFile = getLogFilePath()

beforeEach(() => {
  if (fs.existsSync(logFile)) {
    fs.writeFileSync(logFile, "")
  }
})

describe("log", () => {
  it("appends a timestamped message to the log file", () => {
    log("test message")

    const content = fs.readFileSync(logFile, "utf8")
    expect(content).toContain("test message")
    expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T/)
  })

  it("includes serialized data when provided", () => {
    log("with data", { key: "value" })

    const content = fs.readFileSync(logFile, "utf8")
    expect(content).toContain("with data")
    expect(content).toContain('"key":"value"')
  })

  it("appends multiple entries without overwriting", () => {
    log("first")
    log("second")

    const content = fs.readFileSync(logFile, "utf8")
    expect(content).toContain("first")
    expect(content).toContain("second")
  })
})

describe("getLogFilePath", () => {
  it("returns a path ending in weave-opencode.log", () => {
    expect(getLogFilePath()).toMatch(/weave-opencode\.log$/)
  })
})

describe("logDelegation", () => {
  it("writes a delegation:start entry with agent name", () => {
    logDelegation({ phase: "start", agent: "thread" })

    const content = fs.readFileSync(logFile, "utf8")
    expect(content).toContain("[delegation:start]")
    expect(content).toContain("agent=thread")
  })

  it("writes a delegation:complete entry", () => {
    logDelegation({ phase: "complete", agent: "pattern", sessionId: "s123", toolCallId: "c1" })

    const content = fs.readFileSync(logFile, "utf8")
    expect(content).toContain("[delegation:complete]")
    expect(content).toContain("agent=pattern")
    expect(content).toContain('"sessionId":"s123"')
    expect(content).toContain('"toolCallId":"c1"')
  })

  it("writes a delegation:error entry with summary", () => {
    logDelegation({ phase: "error", agent: "spindle", summary: "timeout" })

    const content = fs.readFileSync(logFile, "utf8")
    expect(content).toContain("[delegation:error]")
    expect(content).toContain("agent=spindle")
    expect(content).toContain('"summary":"timeout"')
  })

  it("includes durationMs when provided", () => {
    logDelegation({ phase: "complete", agent: "weft", durationMs: 1234 })

    const content = fs.readFileSync(logFile, "utf8")
    expect(content).toContain('"durationMs":1234')
  })
})
