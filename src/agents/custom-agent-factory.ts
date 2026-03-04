import type { AgentConfig } from "@opencode-ai/sdk"
import type { CustomAgentConfig } from "../config/schema"
import type { AgentPromptMetadata } from "./types"
import type { ResolveSkillsFn } from "./agent-builder"
import { loadPromptFile } from "./prompt-loader"
import { resolveAgentModel } from "./model-resolution"
import type { FallbackEntry } from "./model-resolution"
import { registerAgentDisplayName } from "../shared/agent-display-names"

/** Known tool names that can be granted/denied via config */
const KNOWN_TOOL_NAMES = new Set([
  "write",
  "edit",
  "bash",
  "glob",
  "grep",
  "read",
  "task",
  "call_weave_agent",
  "webfetch",
  "todowrite",
  "skill",
])

/** Agent name must be lowercase alphanumeric with hyphens/underscores */
const AGENT_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/

export interface BuildCustomAgentOptions {
  resolveSkills?: ResolveSkillsFn
  disabledSkills?: Set<string>
  availableModels?: Set<string>
  systemDefaultModel?: string
  uiSelectedModel?: string
  /** Base directory for resolving relative prompt_file paths */
  configDir?: string
}

/**
 * Parse a fallback_models array like ["github-copilot/claude-sonnet-4.6", "anthropic/claude-sonnet-4"]
 * into FallbackEntry[] for model resolution.
 */
function parseFallbackModels(models: string[]): FallbackEntry[] {
  return models.map((m) => {
    if (m.includes("/")) {
      const [provider, model] = m.split("/", 2)
      return { providers: [provider], model }
    }
    return { providers: ["github-copilot"], model: m }
  })
}

/**
 * Build an AgentConfig from a custom agent definition.
 * Handles prompt resolution (inline, file, or skills), model resolution,
 * and display name registration.
 */
export function buildCustomAgent(
  name: string,
  config: CustomAgentConfig,
  options: BuildCustomAgentOptions = {},
): AgentConfig {
  // Validate agent name format
  if (!AGENT_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid custom agent name "${name}": must be lowercase alphanumeric, starting with a letter, using only hyphens and underscores`,
    )
  }

  const { resolveSkills, disabledSkills, availableModels = new Set(), systemDefaultModel, uiSelectedModel, configDir } = options

  // Resolve prompt: prompt_file takes priority if both specified
  let prompt = config.prompt ?? ""
  if (config.prompt_file) {
    const fileContent = loadPromptFile(config.prompt_file, configDir)
    if (fileContent) {
      prompt = fileContent
    }
  }

  // Resolve skills and prepend to prompt
  if (config.skills?.length && resolveSkills) {
    const skillContent = resolveSkills(config.skills, disabledSkills)
    if (skillContent) {
      prompt = skillContent + (prompt ? "\n\n" + prompt : "")
    }
  }

  // Resolve model
  const mode = config.mode ?? "subagent"
  const customFallbackChain = config.fallback_models?.length
    ? parseFallbackModels(config.fallback_models)
    : undefined

  const model = resolveAgentModel(name, {
    availableModels,
    agentMode: mode,
    overrideModel: config.model,
    systemDefaultModel,
    uiSelectedModel,
    customFallbackChain,
  })

  // Register display name
  const displayName = config.display_name ?? name
  registerAgentDisplayName(name, displayName)

  // Build the agent config
  const agentConfig: AgentConfig = {
    model,
    prompt: prompt || undefined,
    description: config.description ?? displayName,
    mode,
  }

  if (config.temperature !== undefined) agentConfig.temperature = config.temperature
  if (config.top_p !== undefined) agentConfig.top_p = config.top_p
  if (config.maxTokens !== undefined) agentConfig.maxTokens = config.maxTokens
  if (config.tools) {
    // Validate tool names against known allowlist
    const unknownTools = Object.keys(config.tools).filter((t) => !KNOWN_TOOL_NAMES.has(t))
    if (unknownTools.length > 0) {
      throw new Error(
        `Custom agent "${name}" specifies unknown tool(s): ${unknownTools.join(", ")}. ` +
          `Known tools: ${[...KNOWN_TOOL_NAMES].join(", ")}`,
      )
    }
    agentConfig.tools = config.tools
  }

  return agentConfig
}

/**
 * Build AgentPromptMetadata for a custom agent from its config.
 * Used to integrate custom agents into Loom's delegation table.
 */
export function buildCustomAgentMetadata(
  name: string,
  config: CustomAgentConfig,
): AgentPromptMetadata {
  return {
    category: config.category ?? "utility",
    cost: config.cost ?? "CHEAP",
    triggers: config.triggers ?? [
      { domain: "Custom", trigger: `Tasks delegated to ${config.display_name ?? name}` },
    ],
  }
}
