import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { join } from "path"
import { stripDisabledAgentReferences, resetNameVariants } from "../../src/agents/agent-builder"
import { WeaveConfigSchema } from "../../src/config/schema"
import { createManagers } from "../../src/create-managers"
import { resetDisplayNames } from "../../src/shared/agent-display-names"
import { createProjectFixture, type ProjectFixture } from "../testkit/fixtures/project-fixture"
import { makeMockCtx } from "../testkit/plugin-context"

describe("Integration: manager config", () => {
  let fixture: ProjectFixture

  beforeEach(() => {
    fixture = createProjectFixture("weave-integration-manager-config-")
  })

  afterEach(() => {
    fixture.cleanup()
    resetDisplayNames()
    resetNameVariants()
  })

  it("resolves prompt_file relative to configDir through createManagers", () => {
    fixture.writeFile(
      ".opencode/prompts/my-agent.md",
      "You are a database optimization specialist.\n\nFocus on query performance.",
    )

    const config = WeaveConfigSchema.parse({
      custom_agents: {
        "db-helper": {
          prompt_file: "prompts/my-agent.md",
          display_name: "DB Helper",
        },
      },
    })

    const managers = createManagers({
      ctx: makeMockCtx(fixture.directory),
      pluginConfig: config,
      configDir: join(fixture.directory, ".opencode"),
    })

    expect(managers.agents["db-helper"]).toBeDefined()
    expect(managers.agents["db-helper"].prompt).toContain("database optimization specialist")
    expect(managers.agents["db-helper"].prompt).toContain("query performance")
  })

  it("keeps custom agents buildable when prompt_file is missing", () => {
    const config = WeaveConfigSchema.parse({
      custom_agents: {
        "missing-prompt": {
          prompt_file: "nonexistent.md",
          display_name: "Missing",
        },
      },
    })

    const managers = createManagers({
      ctx: makeMockCtx(fixture.directory),
      pluginConfig: config,
      configDir: join(fixture.directory, ".opencode"),
    })

    expect(managers.agents["missing-prompt"]).toBeDefined()
    const prompt = managers.agents["missing-prompt"].prompt
    expect(!prompt || prompt.trim() === "").toBe(true)
  })

  it("registers custom agent name variants for prompt stripping", () => {
    const config = WeaveConfigSchema.parse({
      custom_agents: {
        "code-reviewer": {
          prompt: "Review code.",
          display_name: "Code Reviewer",
        },
      },
    })

    createManagers({
      ctx: makeMockCtx(fixture.directory),
      pluginConfig: config,
    })

    const text = "Use code-reviewer for reviews\nUse Code Reviewer for reviews\nKeep this"
    const result = stripDisabledAgentReferences(text, new Set(["code-reviewer"]))

    expect(result).not.toContain("code-reviewer")
    expect(result).not.toContain("Code Reviewer")
    expect(result).toContain("Keep this")
  })

  it("auto-generates variants when name and display_name match", () => {
    const config = WeaveConfigSchema.parse({
      custom_agents: {
        helper: {
          prompt: "Help.",
          display_name: "helper",
        },
      },
    })

    createManagers({
      ctx: makeMockCtx(fixture.directory),
      pluginConfig: config,
    })

    const text = "Use helper for tasks\nUse Helper for tasks\nKeep"
    const result = stripDisabledAgentReferences(text, new Set(["helper"]))

    expect(result).not.toContain("helper")
    expect(result).not.toContain("Helper")
    expect(result).toContain("Keep")
  })

  it("forwards categories to createBuiltinAgents — shuttle-frontend exists and tapestry prompt has CategoryRouting", () => {
    const config = WeaveConfigSchema.parse({
      categories: {
        frontend: {
          patterns: ["src/frontend/**"],
          model: "gpt-4o",
          prompt_append: "Focus on React.",
        },
      },
    })

    const managers = createManagers({
      ctx: makeMockCtx(fixture.directory),
      pluginConfig: config,
    })

    // (a) shuttle-frontend agent must exist with category model/prompt
    expect(managers.agents["shuttle-frontend"]).toBeDefined()
    expect(managers.agents["shuttle-frontend"].model).toBe("gpt-4o")
    expect(managers.agents["shuttle-frontend"].prompt).toContain("Focus on React.")

    // (b) tapestry prompt must contain CategoryRouting block, agent name, and glob
    const tapestryPrompt = managers.agents["tapestry"]?.prompt ?? ""
    expect(tapestryPrompt).toContain("<CategoryRouting>")
    expect(tapestryPrompt).toContain("shuttle-frontend")
    expect(tapestryPrompt).toContain("src/frontend/**")
  })

  it("registers workflow-specific custom variants for prompt stripping", () => {
    createManagers({
      ctx: makeMockCtx(fixture.directory),
      pluginConfig: WeaveConfigSchema.parse({
        disabled_agents: ["loom", "tapestry", "shuttle", "pattern", "spindle", "warp", "weft"],
        custom_agents: {
          "pipeline-lead": {
            prompt: "Orchestrate pipeline tasks. Delegate to data-validator for checks.",
            display_name: "Pipeline Lead",
            mode: "primary",
          },
          "data-validator": {
            prompt: "Validate data.",
            display_name: "Data Validator",
            mode: "subagent",
          },
        },
      }),
    })

    const text = [
      "Use data-validator for checking schemas",
      "Use Data Validator for quality checks",
      "Use Pipeline Lead for orchestration",
      "Keep this line",
    ].join("\n")

    const result = stripDisabledAgentReferences(text, new Set(["data-validator"]))
    expect(result).not.toContain("data-validator")
    expect(result).not.toContain("Data Validator")
    expect(result).toContain("Pipeline Lead")
    expect(result).toContain("Keep this line")
  })
})
