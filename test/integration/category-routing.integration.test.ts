import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { join } from "path"
import { resetNameVariants } from "../../src/agents/agent-builder"
import { DEFAULT_CONTINUATION_CONFIG } from "../../src/config/continuation"
import { WeaveConfigSchema } from "../../src/config/schema"
import { createManagers } from "../../src/create-managers"
import { resetDisplayNames } from "../../src/shared/agent-display-names"
import { createProjectFixture, type ProjectFixture } from "../testkit/fixtures/project-fixture"
import { makeMockCtx } from "../testkit/plugin-context"

describe("Integration: category routing setup", () => {
  let fixture: ProjectFixture

  beforeEach(() => {
    fixture = createProjectFixture("weave-integration-category-routing-")
  })

  afterEach(() => {
    fixture.cleanup()
    resetDisplayNames()
    resetNameVariants()
  })

  it("wires category shuttle agents and Tapestry routing hints without exercising runtime dispatch", () => {
    const config = WeaveConfigSchema.parse({
      categories: {
        frontend: {
          patterns: ["src/frontend/**"],
          model: "gpt-4o",
          prompt_append: "Focus on React and UI behavior.",
        },
        backend: {
          patterns: ["src/backend/**"],
          model: "claude-opus-4",
          prompt_append: "Focus on APIs and data flow.",
        },
      },
    })

    const managers = createManagers({
      ctx: makeMockCtx(fixture.directory),
      pluginConfig: config,
      continuation: DEFAULT_CONTINUATION_CONFIG,
      configDir: join(fixture.directory, ".opencode"),
    })

    expect(managers.agents["shuttle-frontend"]).toBeDefined()
    expect(managers.agents["shuttle-backend"]).toBeDefined()
    expect(managers.agents["shuttle"]).toBeDefined()

    const tapestryPrompt = managers.agents["tapestry"]?.prompt ?? ""

    expect(tapestryPrompt).toContain("<CategoryRouting>")
    expect(tapestryPrompt).toContain("Match task's **Files** against category patterns in config declaration order")
    expect(tapestryPrompt).toContain("shuttle-frontend: patterns [src/frontend/**]")
    expect(tapestryPrompt).toContain("shuttle-backend: patterns [src/backend/**]")
    expect(tapestryPrompt).toContain("shuttle: fallback for tasks that match no category patterns")
  })
})
