import { readFile } from "fs/promises"

import { describe, expect, it } from "bun:test"

import { getWeaveVersion } from "../shared/version"
import {
  generateWeaveConfigJsonSchema,
  getWeaveConfigJsonSchemaArtifactPath,
  SAFE_RELATIVE_PATH_DESCRIPTION,
  SAFE_RELATIVE_PATH_PATTERN,
  stringifyWeaveConfigJsonSchema,
  WEAVE_CONFIG_JSON_SCHEMA_DESCRIPTION,
  WEAVE_CONFIG_JSON_SCHEMA_DRAFT,
  WEAVE_CONFIG_JSON_SCHEMA_ROOT_NAME,
  WEAVE_CONFIG_JSON_SCHEMA_TITLE,
} from "./json-schema"

const EXPECTED_PUBLIC_SCHEMA_ID =
  "https://raw.githubusercontent.com/pgermishuys/opencode-weave/main/schema/weave-config.schema.json"

type JsonSchemaObject = Record<string, unknown>

function getGeneratedSchema() {
  return generateWeaveConfigJsonSchema({ version: getWeaveVersion() })
}

function getRootSchema() {
  const schema = getGeneratedSchema()
  const defs = schema.$defs as Record<string, JsonSchemaObject> | undefined
  const root = defs?.[WEAVE_CONFIG_JSON_SCHEMA_ROOT_NAME]

  if (!root) {
    throw new Error("Expected generated schema root definition to exist")
  }

  return { schema, root }
}

function getProperty(schema: JsonSchemaObject, key: string) {
  const properties = schema.properties as Record<string, JsonSchemaObject> | undefined
  return properties?.[key]
}

describe("generateWeaveConfigJsonSchema", () => {
  it("applies the root metadata contract", () => {
    const schema = getGeneratedSchema()

    expect(schema.$schema).toBe(WEAVE_CONFIG_JSON_SCHEMA_DRAFT)
    expect(schema.$id).toBe(EXPECTED_PUBLIC_SCHEMA_ID)
    expect(schema.title).toBe(WEAVE_CONFIG_JSON_SCHEMA_TITLE)
    expect(schema.description).toBe(WEAVE_CONFIG_JSON_SCHEMA_DESCRIPTION)
    expect(schema["x-weave-version"]).toBe(getWeaveVersion())
    expect(schema.$ref).toBe(`#/$defs/${WEAVE_CONFIG_JSON_SCHEMA_ROOT_NAME}`)
  })

  it("includes the expected top-level sections and enums", () => {
    const { root } = getRootSchema()

    expect(Object.keys((root.properties as Record<string, unknown>) ?? {})).toEqual([
      "$schema",
      "agents",
      "custom_agents",
      "categories",
      "disabled_hooks",
      "disabled_tools",
      "disabled_agents",
      "disabled_skills",
      "skill_directories",
      "background",
      "analytics",
      "review",
      "continuation",
      "tmux",
      "experimental",
      "workflows",
      "log_level",
    ])

    expect(root.required).toBeUndefined()
    expect(getProperty(root, "log_level")?.enum).toEqual([
      "DEBUG",
      "INFO",
      "WARN",
      "ERROR",
    ])
  })

  it("keeps optional top-level sections optional", () => {
    const { root } = getRootSchema()

    expect(root.required).toBeUndefined()
    expect(getProperty(root, "agents")?.type).toBe("object")
    expect(getProperty(root, "background")?.type).toBe("object")
    expect(getProperty(root, "log_level")?.enum).toEqual([
      "DEBUG",
      "INFO",
      "WARN",
      "ERROR",
    ])
  })

  it("preserves nested sections and dictionary-style config", () => {
    const { root } = getRootSchema()
    const agents = getProperty(root, "agents")
    const customAgents = getProperty(root, "custom_agents")
    const review = getProperty(root, "review")
    const continuation = getProperty(root, "continuation")
    const tmux = getProperty(root, "tmux")
    const agentOverride = agents?.additionalProperties as JsonSchemaObject

    expect(agents?.type).toBe("object")
    expect(agentOverride?.type).toBe("object")
    expect(getProperty(agentOverride, "model")?.type).toBe("string")
    expect(getProperty(agentOverride, "tools")?.type).toBe("object")
    expect(getProperty(agentOverride, "temperature")?.type).toBe("number")

    expect(customAgents?.type).toBe("object")
    expect((customAgents?.additionalProperties as JsonSchemaObject)?.type).toBe("object")

    expect(review?.type).toBe("object")
    expect(getProperty(review as JsonSchemaObject, "additional_agents")?.type).toBe("array")
    expect(
      ((getProperty(review as JsonSchemaObject, "additional_agents") as JsonSchemaObject)
        ?.items as JsonSchemaObject)?.type,
    ).toBe("string")

    expect(getProperty(continuation as JsonSchemaObject, "idle")?.type).toBe("object")
    expect(getProperty(tmux as JsonSchemaObject, "layout")?.enum).toEqual([
      "main-horizontal",
      "main-vertical",
      "tiled",
      "even-horizontal",
      "even-vertical",
    ])
  })

  it("post-processes safe relative path restrictions for directory arrays", () => {
    const { root } = getRootSchema()
    const skillDirectories = getProperty(root, "skill_directories")
    const workflows = getProperty(root, "workflows")
    const workflowDirectories = getProperty(workflows as JsonSchemaObject, "directories")

    expect((skillDirectories?.items as JsonSchemaObject)?.pattern).toBe(SAFE_RELATIVE_PATH_PATTERN)
    expect((workflowDirectories?.items as JsonSchemaObject)?.pattern).toBe(
      SAFE_RELATIVE_PATH_PATTERN,
    )
    expect((skillDirectories?.items as JsonSchemaObject)?.description).toContain(
      SAFE_RELATIVE_PATH_DESCRIPTION,
    )
    expect((workflowDirectories?.items as JsonSchemaObject)?.description).toContain(
      SAFE_RELATIVE_PATH_DESCRIPTION,
    )
  })

  it("matches the committed artifact byte-for-byte", async () => {
    const artifactPath = getWeaveConfigJsonSchemaArtifactPath(process.cwd())
    const artifact = await readFile(artifactPath, "utf8")
    const generated = stringifyWeaveConfigJsonSchema(getGeneratedSchema())

    expect(artifact).toBe(generated)
  })
})
