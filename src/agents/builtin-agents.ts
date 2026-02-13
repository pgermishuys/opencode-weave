import type { AgentConfig } from "@opencode-ai/sdk"
import { createLoomAgent } from "./loom"
import { createTapestryAgent } from "./tapestry"
import { createShuttleAgent } from "./shuttle"
import { createPatternAgent } from "./pattern"
import { createThreadAgent } from "./thread"
import { createSpindleAgent } from "./spindle"
import { createWeftAgent } from "./weft"
import { resolveAgentModel } from "./model-resolution"
import { buildAgent } from "./agent-builder"
import type { AgentFactory, AgentPromptMetadata, WeaveAgentName } from "./types"
import type { CategoriesConfig, AgentOverrideConfig } from "../config/schema"
import type { ResolveSkillsFn } from "./agent-builder"

export interface CreateBuiltinAgentsOptions {
  disabledAgents?: string[]
  agentOverrides?: Record<string, AgentOverrideConfig>
  categories?: CategoriesConfig
  uiSelectedModel?: string
  systemDefaultModel?: string
  availableModels?: Set<string>
  disabledSkills?: Set<string>
  resolveSkills?: ResolveSkillsFn
}

const AGENT_FACTORIES: Record<WeaveAgentName, AgentFactory> = {
  loom: createLoomAgent,
  tapestry: createTapestryAgent,
  shuttle: createShuttleAgent,
  pattern: createPatternAgent,
  thread: createThreadAgent,
  spindle: createSpindleAgent,
  weft: createWeftAgent,
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
  } = options

  const disabledSet = new Set(disabledAgents)
  const result: Record<string, AgentConfig> = {}

  for (const [name, factory] of Object.entries(AGENT_FACTORIES) as [WeaveAgentName, AgentFactory][]) {
    if (disabledSet.has(name)) continue

    const override = agentOverrides[name]
    const overrideModel = override?.model

    const resolvedModel = resolveAgentModel(name, {
      availableModels,
      agentMode: factory.mode,
      uiSelectedModel,
      systemDefaultModel,
      overrideModel,
    })

    const built = buildAgent(factory, resolvedModel, {
      categories,
      disabledSkills,
      resolveSkills,
    })

    if (override) {
      if (override.prompt_append) {
        built.prompt = (built.prompt ? built.prompt + "\n\n" : "") + override.prompt_append
      }
      if (override.temperature !== undefined) {
        built.temperature = override.temperature
      }
    }

    result[name] = built
  }

  return result
}
