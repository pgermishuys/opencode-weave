import { describe, it, expect } from "bun:test"
import { generateHealthReport } from "./health-report"
import type { ConfigLoadResult } from "../config/loader"

describe("generateHealthReport", () => {
  it("reports healthy when no diagnostics", () => {
    const loadResult: ConfigLoadResult = {
      config: {},
      loadedFiles: ["/home/user/.config/opencode/weave-opencode.jsonc"],
      diagnostics: [],
    }
    const agents = {
      "Loom (Main Orchestrator)": {},
      "Tapestry (Execution Orchestrator)": {},
    }
    const report = generateHealthReport(loadResult, agents)
    expect(report).toContain("✅ Weave Config Health: OK")
    expect(report).toContain("weave-opencode.jsonc")
    expect(report).not.toContain("Validation Issues")
  })

  it("reports issues when diagnostics present", () => {
    const loadResult: ConfigLoadResult = {
      config: {},
      loadedFiles: ["/project/.opencode/weave-opencode.json"],
      diagnostics: [
        {
          level: "warn",
          section: "custom_agents",
          message: 'Section "custom_agents" was dropped due to validation errors',
          fields: [
            { path: "my-agent.mode", message: 'Invalid option: expected one of "subagent"|"primary"|"all"' },
          ],
        },
      ],
    }
    const report = generateHealthReport(loadResult, {})
    expect(report).toContain("⚠ Weave Config Health: Issues Found")
    expect(report).toContain("custom_agents")
    expect(report).toContain("my-agent.mode")
    expect(report).toContain("Invalid option")
    expect(report).toContain("Fix the issues above")
  })

  it("shows loaded and custom agent counts", () => {
    const loadResult: ConfigLoadResult = {
      config: {
        custom_agents: {
          "my-reviewer": { prompt: "Review code", model: "test/v1" },
        },
      },
      loadedFiles: [],
      diagnostics: [],
    }
    const agents = {
      "Loom (Main Orchestrator)": {},
      "shuttle": {},
      "my-reviewer": {},
    }
    const report = generateHealthReport(loadResult, agents)
    expect(report).toContain("Builtin: 2/8")
    expect(report).toContain("Custom: 1")
    expect(report).toContain("my-reviewer")
  })

  it("shows disabled agents", () => {
    const loadResult: ConfigLoadResult = {
      config: { disabled_agents: ["warp", "weft"] },
      loadedFiles: [],
      diagnostics: [],
    }
    const report = generateHealthReport(loadResult, {})
    expect(report).toContain("Disabled Agents")
    expect(report).toContain("warp")
    expect(report).toContain("weft")
  })

  it("includes log location hint", () => {
    const loadResult: ConfigLoadResult = {
      config: {},
      loadedFiles: [],
      diagnostics: [],
    }
    const report = generateHealthReport(loadResult, {})
    expect(report).toContain("~/.local/share/opencode/log/")
    expect(report).toContain("service=weave")
    expect(report).toContain("--print-logs")
  })

  it("handles null load result", () => {
    const report = generateHealthReport(null, {})
    expect(report).toContain("No config load result available")
  })

  it("reports multiple diagnostics with field details", () => {
    const loadResult: ConfigLoadResult = {
      config: {},
      loadedFiles: [],
      diagnostics: [
        {
          level: "warn",
          section: "custom_agents",
          message: "Section dropped",
          fields: [
            { path: "agent-a.cost", message: "Invalid enum" },
            { path: "agent-b.mode", message: "Expected subagent|primary|all" },
          ],
        },
        {
          level: "error",
          section: "(root)",
          message: "Config validation failed entirely",
        },
      ],
    }
    const report = generateHealthReport(loadResult, {})
    expect(report).toContain("🟡")
    expect(report).toContain("🔴")
    expect(report).toContain("agent-a.cost")
    expect(report).toContain("agent-b.mode")
  })

  it("shows no config files found when loadedFiles is empty", () => {
    const loadResult: ConfigLoadResult = {
      config: {},
      loadedFiles: [],
      diagnostics: [],
    }
    const report = generateHealthReport(loadResult, {})
    expect(report).toContain("No config files found")
  })
})
