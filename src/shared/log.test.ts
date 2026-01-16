import { describe, it, expect, beforeEach } from "bun:test"
import * as fs from "fs"
import { log, getLogFilePath } from "./log"

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
