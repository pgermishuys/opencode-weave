import type { AgentConfig } from "@opencode-ai/sdk"
import { createLoomAgent, createLoomAgentWithOptions } from "./loom"
import { createTapestryAgent, createTapestryAgentWithOptions } from "./tapestry"
import { createShuttleAgent } from "./shuttle"
import { createPatternAgent } from "./pattern"
import { createThreadAgent } from "./thread"
import { createSpindleAgent } from "./spindle"
import { createWeftAgent } from "./weft"
import { createWarpAgent } from "./warp"
import { resolveAgentModel } from "./model-resolution"
import { buildAgent } from "./agent-builder"
import type { AgentFactory, AgentPromptMetadata, WeaveAgentName } from "./types"
import type { CategoriesConfig, AgentOverrideConfig } from "../config/schema"
import type { ResolvedContinuationConfig } from "../config/continuation"
import type { ResolveSkillsFn } from "./agent-builder"
import type { ProjectFingerprint } from "../features/analytics/types"
import type { AvailableAgent } from "./dynamic-prompt-builder"
import { debug } from "../shared/log"

type AgentConfigWithOptions = AgentConfig & {
  options?: Record<string, unknown>
}

export interface CreateBuiltinAgentsOptions {
  disabledAgents?: string[]
  agentOverrides?: Record<string, AgentOverrideConfig>
  categories?: CategoriesConfig
  uiSelectedModel?: string
  systemDefaultModel?: string
  availableModels?: Set<string>
  disabledSkills?: Set<string>
  resolveSkills?: ResolveSkillsFn
  /** Project fingerprint for injecting project context into agent prompts */
  fingerprint?: ProjectFingerprint | null
  /** Custom agent metadata for Loom's dynamic delegation prompt */
  customAgentMetadata?: AvailableAgent[]
  /** Resolved continuation config for prompt-aware agents */
  continuation?: ResolvedContinuationConfig
}

const AGENT_FACTORIES: Record<WeaveAgentName, AgentFactory> = {
  loom: createLoomAgent,
  tapestry: createTapestryAgent,
  shuttle: createShuttleAgent,
  pattern: createPatternAgent,
  thread: createThreadAgent,
  spindle: createSpindleAgent,
  weft: createWeftAgent,
  warp: createWarpAgent,
}

export const AGENT_METADATA: Record<WeaveAgentName, AgentPromptMetadata> = {
  loom: {
    category: "specialist",
    cost: "EXPENSIVE",
    triggers: [
      { domain: "Orchestration", trigger: "Complex multi-step tasks needing full orchestration" },
      { domain: "Architecture", trigger: "System design and high-level planning" },
    ],
    keyTrigger: "**'ultrawork'** → Maximum effort, parallel agents, deep execution",
  },
  tapestry: {
    category: "specialist",
    cost: "EXPENSIVE",
    triggers: [
      { domain: "Execution", trigger: "Implementation tasks requiring sequential orchestration" },
      { domain: "Integration", trigger: "Wiring multiple systems or modules together" },
    ],
  },
  shuttle: {
    category: "specialist",
    cost: "CHEAP",
    triggers: [
      { domain: "Category Work", trigger: "Domain-specific tasks dispatched via category system" },
    ],
  },
  pattern: {
    category: "advisor",
    cost: "EXPENSIVE",
    triggers: [
      { domain: "Planning", trigger: "Detailed task breakdown and step-by-step planning" },
      { domain: "Strategy", trigger: "Approach selection for complex technical problems" },
    ],
  },
  thread: {
    category: "exploration",
    cost: "FREE",
    triggers: [
      { domain: "Codebase Search", trigger: "Finding patterns, usages, definitions across files" },
      { domain: "Context Gathering", trigger: "Understanding how existing code works" },
    ],
    useWhen: [
      "Pattern/usage is unknown — need to discover it",
      "Multi-file search required",
      "Need to understand code structure before editing",
    ],
    avoidWhen: [
      "File path is already known",
      "Single file, single location",
      "Simple grep would suffice",
    ],
  },
  spindle: {
    category: "exploration",
    cost: "FREE",
    triggers: [
      { domain: "External Research", trigger: "Documentation lookup, library usage, OSS examples" },
      { domain: "Reference Search", trigger: "Official API docs, best practices, external resources" },
    ],
    useWhen: [
      "official docs",
      "external library",
      "how does X work in library Y",
      "best practice for",
    ],
  },
  weft: {
    category: "advisor",
    cost: "EXPENSIVE",
    triggers: [
      { domain: "Code Review", trigger: "After completing significant implementation work" },
      { domain: "Plan Review", trigger: "Validate plans before execution" },
    ],
    useWhen: [
      "After completing a multi-file implementation",
      "Before executing a complex plan",
      "When unsure if work meets acceptance criteria",
      "After 2+ revision attempts on the same task",
    ],
    avoidWhen: [
      "Simple single-file changes",
      "Trivial fixes (typos, formatting)",
      "When user explicitly wants to skip review",
    ],
  },
  warp: {
    category: "advisor",
    cost: "EXPENSIVE",
    triggers: [
      { domain: "Security Review", trigger: "After changes touching auth, crypto, tokens, or input handling" },
      { domain: "Spec Compliance", trigger: "When implementing OAuth, OIDC, WebAuthn, JWT, or similar protocols" },
    ],
    useWhen: [
      "After implementing authentication or authorization logic",
      "When adding/modifying token handling, JWT, or session management",
      "After changes to cryptographic operations or key management",
      "When implementing OAuth2, OIDC, WebAuthn, or similar specs",
      "After modifying CORS, CSP, or security headers",
    ],
    avoidWhen: [
      "Pure documentation or README changes",
      "CSS/styling-only changes with no security implications",
      "Test-only changes that don't modify security test assertions",
    ],
  },
}

/**
 * Separate map for custom agent metadata — avoids unsafe mutation of the
 * strongly-typed AGENT_METADATA record.
 */
const CUSTOM_AGENT_METADATA: Record<string, AgentPromptMetadata> = {}

/**
 * Register metadata for a custom agent. Used by create-managers.ts
 * to integrate custom agents into Loom's dynamic prompt builder.
 */
export function registerCustomAgentMetadata(name: string, metadata: AgentPromptMetadata): void {
  CUSTOM_AGENT_METADATA[name] = metadata
}

/**
 * Get all agent metadata — builtins + registered custom agents.
 * Returns a new merged record on each call.
 */
export function getAllAgentMetadata(): Record<string, AgentPromptMetadata> {
  return { ...AGENT_METADATA, ...CUSTOM_AGENT_METADATA }
}

export function createBuiltinAgents(options: CreateBuiltinAgentsOptions = {}): Record<string, AgentConfig> {
  const {
    disabledAgents = [],
    agentOverrides = {},
    categories,
    uiSelectedModel,
    systemDefaultModel,
    availableModels = new Set<string>(),
    disabledSkills,
    resolveSkills,
    fingerprint,
    customAgentMetadata,
    continuation,
  } = options

  const disabledSet = new Set(disabledAgents)

  const result: Record<string, AgentConfig> = {}

  for (const [name, factory] of Object.entries(AGENT_FACTORIES) as [WeaveAgentName, AgentFactory][]) {
    if (disabledSet.has(name)) {
      debug(`Builtin agent "${name}" is disabled — skipping`)
      continue
    }

    const override = agentOverrides[name]
    const overrideModel = override?.model

    const resolvedModel = resolveAgentModel(name, {
      availableModels,
      agentMode: factory.mode,
      uiSelectedModel,
      systemDefaultModel,
      overrideModel,
    })

    if (overrideModel) {
      debug(`Builtin agent "${name}" model overridden via config`, { model: resolvedModel })
    }

    // Use prompt-composer-aware constructors for loom and tapestry
    // so their prompts conditionally omit references to disabled agents
    let built: AgentConfigWithOptions
    if (name === "loom") {
      built = createLoomAgentWithOptions(resolvedModel, disabledSet, fingerprint, customAgentMetadata)
    } else if (name === "tapestry") {
      built = createTapestryAgentWithOptions(resolvedModel, disabledSet, continuation, categories)
    } else {
      built = buildAgent(factory, resolvedModel, {
        categories,
        disabledSkills,
        resolveSkills,
        disabledAgents: disabledSet,
      })
    }

    if (override) {
      if (override.skills?.length && resolveSkills) {
        const skillContent = resolveSkills(override.skills, disabledSkills)
        if (skillContent) {
          built.prompt = skillContent + (built.prompt ? "\n\n" + built.prompt : "")
        }
      }
      if (override.prompt_append) {
        built.prompt = (built.prompt ? built.prompt + "\n\n" : "") + override.prompt_append
      }
      if (override.temperature !== undefined) {
        built.temperature = override.temperature
      }
      if (override.modelOptions !== undefined) {
        built.options = override.modelOptions
      }
    }

    result[name] = built
  }

  // Register category-specific Shuttle agents for categories that have patterns defined.
  // Each category with patterns gets a `shuttle-{categoryName}` agent variant with the
  // category's model and prompt_append baked in. The base `shuttle` agent remains as fallback.
  if (categories && result["shuttle"]) {
    const baseShuttle = result["shuttle"]
    for (const [categoryName, categoryConfig] of Object.entries(categories)) {
      if (!categoryConfig.patterns?.length) continue

      const categoryAgentName = `shuttle-${categoryName}`
      if (disabledSet.has(categoryAgentName)) {
        debug(`Category shuttle agent "${categoryAgentName}" is disabled — skipping`)
        continue
      }

      const categoryModel = categoryConfig.model
        ? resolveAgentModel(categoryAgentName, {
            availableModels,
            agentMode: "all",
            uiSelectedModel,
            systemDefaultModel,
            overrideModel: categoryConfig.model,
          })
        : baseShuttle.model

      let categoryPrompt = baseShuttle.prompt as string | undefined
      if (categoryConfig.prompt_append) {
        categoryPrompt = (categoryPrompt ? categoryPrompt + "\n\n" : "") + categoryConfig.prompt_append
      }

      const categoryToolOverrides = categoryConfig.tools
      const categoryShuttle: AgentConfig = {
        ...baseShuttle,
        model: categoryModel,
        prompt: categoryPrompt,
        ...(categoryConfig.temperature !== undefined && { temperature: categoryConfig.temperature }),
        // Categories always inherit Shuttle's base tool policy. When `tools` is present,
        // even as `{}`, treat it as "merge no overrides" rather than "clear all tools" so
        // the category agent keeps the base permissions unless explicit boolean overrides are set.
        ...(categoryToolOverrides !== undefined && { tools: { ...baseShuttle.tools, ...categoryToolOverrides } }),
      }

      result[categoryAgentName] = categoryShuttle
      debug(`Registered category shuttle agent "${categoryAgentName}"`, {
        model: categoryModel,
        patterns: categoryConfig.patterns,
      })
    }
  }

  return result
}
