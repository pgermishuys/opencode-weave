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
      { providers: ["github-copilot"], model: "claude-opus-4.6" },
      { providers: ["anthropic"], model: "claude-opus-4" },
      { providers: ["openai"], model: "gpt-5" },
    ],
  },
  tapestry: {
    fallbackChain: [
      { providers: ["github-copilot"], model: "claude-sonnet-4.6" },
      { providers: ["anthropic"], model: "claude-sonnet-4" },
      { providers: ["openai"], model: "gpt-5" },
    ],
  },
  shuttle: {
    fallbackChain: [
      { providers: ["github-copilot"], model: "claude-sonnet-4.6" },
      { providers: ["anthropic"], model: "claude-sonnet-4" },
      { providers: ["openai"], model: "gpt-5" },
    ],
  },
  pattern: {
    fallbackChain: [
      { providers: ["github-copilot"], model: "claude-opus-4.6" },
      { providers: ["anthropic"], model: "claude-opus-4" },
      { providers: ["openai"], model: "gpt-5" },
    ],
  },
  thread: {
    fallbackChain: [
      { providers: ["github-copilot"], model: "claude-haiku-4.5" },
      { providers: ["anthropic"], model: "claude-haiku-4" },
      { providers: ["google"], model: "gemini-3-flash" },
    ],
  },
  spindle: {
    fallbackChain: [
      { providers: ["github-copilot"], model: "claude-haiku-4.5" },
      { providers: ["anthropic"], model: "claude-haiku-4" },
      { providers: ["google"], model: "gemini-3-flash" },
    ],
  },
  weft: {
    fallbackChain: [
      { providers: ["github-copilot"], model: "claude-sonnet-4.6" },
      { providers: ["anthropic"], model: "claude-sonnet-4" },
      { providers: ["openai"], model: "gpt-5" },
    ],
  },
  warp: {
    fallbackChain: [
      { providers: ["github-copilot"], model: "claude-opus-4.6" },
      { providers: ["anthropic"], model: "claude-opus-4" },
      { providers: ["openai"], model: "gpt-5" },
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
  /** Custom fallback chain for agents not in AGENT_MODEL_REQUIREMENTS */
  customFallbackChain?: FallbackEntry[]
}

/**
 * Resolve the model for an agent. Accepts any string agent name.
 * Built-in agents use AGENT_MODEL_REQUIREMENTS for fallback chains.
 * Custom agents use the customFallbackChain option, or fall through
 * to system default / hardcoded fallback.
 */
export function resolveAgentModel(agentName: string, options: ResolveAgentModelOptions): string {
  const { availableModels, agentMode, uiSelectedModel, categoryModel, overrideModel, systemDefaultModel, customFallbackChain } = options
  const requirement = AGENT_MODEL_REQUIREMENTS[agentName as WeaveAgentName] as AgentModelRequirement | undefined

  // 1. Explicit override always wins
  if (overrideModel) return overrideModel

  // 2. UI-selected model — only for primary or all agents
  if (uiSelectedModel && (agentMode === "primary" || agentMode === "all")) {
    return uiSelectedModel
  }

  // 3. Category default model (only if available)
  if (categoryModel && availableModels.has(categoryModel)) return categoryModel

  // 4. Fallback chain — first available match (built-in or custom)
  const fallbackChain = requirement?.fallbackChain ?? customFallbackChain
  if (fallbackChain) {
    for (const entry of fallbackChain) {
      for (const provider of entry.providers) {
        const qualified = `${provider}/${entry.model}`
        if (availableModels.has(qualified)) return qualified
        if (availableModels.has(entry.model)) return entry.model
      }
    }
  }

  // 5. System default
  if (systemDefaultModel) return systemDefaultModel

  // 6. Best-guess offline: first entry in fallback chain
  if (fallbackChain && fallbackChain.length > 0) {
    const first = fallbackChain[0]
    if (first.providers.length > 0) {
      return `${first.providers[0]}/${first.model}`
    }
  }

  console.warn(
    `[weave] No model resolved for agent "${agentName}" — falling back to default github-copilot/claude-opus-4.6`,
  )
  return "github-copilot/claude-opus-4.6"
}
