import type { AgentMode, WeaveAgentName } from "./types"

export type FallbackEntry = {
  providers: string[]
  model: string
  variant?: string
}

export type AgentModelRequirement = {
  fallbackChain: FallbackEntry[]
}

export const AGENT_MODEL_REQUIREMENTS: Record<WeaveAgentName, AgentModelRequirement> = {
  loom: {
    fallbackChain: [
      { providers: ["anthropic"], model: "claude-opus-4" },
      { providers: ["openai"], model: "gpt-5" },
      { providers: ["google"], model: "gemini-3-pro" },
    ],
  },
  tapestry: {
    fallbackChain: [
      { providers: ["anthropic"], model: "claude-sonnet-4" },
      { providers: ["openai"], model: "gpt-5" },
      { providers: ["google"], model: "gemini-3-pro" },
    ],
  },
  shuttle: {
    fallbackChain: [
      { providers: ["anthropic"], model: "claude-sonnet-4" },
      { providers: ["openai"], model: "gpt-5" },
      { providers: ["google"], model: "gemini-3-pro" },
    ],
  },
  pattern: {
    fallbackChain: [
      { providers: ["anthropic"], model: "claude-opus-4" },
      { providers: ["openai"], model: "gpt-5" },
      { providers: ["google"], model: "gemini-3-pro" },
    ],
  },
  thread: {
    fallbackChain: [
      { providers: ["xai"], model: "grok-code-fast" },
      { providers: ["google"], model: "gemini-3-flash" },
      { providers: ["openai"], model: "gpt-5-mini" },
    ],
  },
  spindle: {
    fallbackChain: [
      { providers: ["zhipu"], model: "glm-4" },
      { providers: ["google"], model: "gemini-3-flash" },
      { providers: ["openai"], model: "gpt-5-mini" },
    ],
  },
  weft: {
    fallbackChain: [
      { providers: ["anthropic"], model: "claude-opus-4" },
      { providers: ["openai"], model: "gpt-5" },
      { providers: ["google"], model: "gemini-3-pro" },
    ],
  },
}

export type ResolveAgentModelOptions = {
  availableModels: Set<string>
  agentMode: AgentMode
  uiSelectedModel?: string
  categoryModel?: string
  overrideModel?: string
  systemDefaultModel?: string
}

export function resolveAgentModel(agentName: WeaveAgentName, options: ResolveAgentModelOptions): string {
  const { availableModels, agentMode, uiSelectedModel, categoryModel, overrideModel, systemDefaultModel } = options
  const requirement = AGENT_MODEL_REQUIREMENTS[agentName]

  // 1. Explicit override always wins
  if (overrideModel) return overrideModel

  // 2. UI-selected model — only for primary or all agents
  if (uiSelectedModel && (agentMode === "primary" || agentMode === "all")) {
    return uiSelectedModel
  }

  // 3. Category default model (only if available)
  if (categoryModel && availableModels.has(categoryModel)) return categoryModel

  // 4. Fallback chain — first available match
  for (const entry of requirement.fallbackChain) {
    for (const provider of entry.providers) {
      const qualified = `${provider}/${entry.model}`
      if (availableModels.has(qualified)) return qualified
      if (availableModels.has(entry.model)) return entry.model
    }
  }

  // 5. System default
  if (systemDefaultModel) return systemDefaultModel

  // 6. Best-guess offline: first entry in fallback chain
  const first = requirement.fallbackChain[0]
  if (first && first.providers.length > 0) {
    return `${first.providers[0]}/${first.model}`
  }

  return "anthropic/claude-opus-4"
}
