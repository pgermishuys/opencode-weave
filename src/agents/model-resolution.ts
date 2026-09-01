import type { AgentMode, WeaveAgentName } from "./types"
import { debug, warn } from "../shared/log"

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
      { providers: ["github-copilot"], model: "claude-opus-4.8" },
      { providers: ["anthropic"], model: "claude-opus-4" },
      { providers: ["openai"], model: "gpt-5" },
    ],
  },
  tapestry: {
    fallbackChain: [
      { providers: ["github-copilot"], model: "claude-sonnet-5" },
      { providers: ["anthropic"], model: "claude-sonnet-4" },
      { providers: ["openai"], model: "gpt-5" },
    ],
  },
  shuttle: {
    fallbackChain: [
      { providers: ["github-copilot"], model: "claude-sonnet-5" },
      { providers: ["anthropic"], model: "claude-sonnet-4" },
      { providers: ["openai"], model: "gpt-5" },
    ],
  },
  pattern: {
    fallbackChain: [
      { providers: ["github-copilot"], model: "claude-opus-4.8" },
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
      { providers: ["github-copilot"], model: "claude-sonnet-5" },
      { providers: ["anthropic"], model: "claude-sonnet-4" },
      { providers: ["openai"], model: "gpt-5" },
    ],
  },
  warp: {
    fallbackChain: [
      { providers: ["github-copilot"], model: "claude-opus-4.8" },
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
  if (overrideModel) {
    debug(`Model resolved for "${agentName}"`, { via: "override", model: overrideModel })
    return overrideModel
  }

  // 2. UI-selected model — only for primary or all agents
  if (uiSelectedModel && (agentMode === "primary" || agentMode === "all")) {
    debug(`Model resolved for "${agentName}"`, { via: "ui-selection", model: uiSelectedModel, agentMode })
    return uiSelectedModel
  }

  // 3. Category default model (only if available)
  if (categoryModel && availableModels.has(categoryModel)) {
    debug(`Model resolved for "${agentName}"`, { via: "category", model: categoryModel })
    return categoryModel
  }

  // 4. Fallback chain — first available match (built-in or custom)
  const fallbackChain = requirement?.fallbackChain ?? customFallbackChain
  if (fallbackChain) {
    for (const entry of fallbackChain) {
      for (const provider of entry.providers) {
        const qualified = `${provider}/${entry.model}`
        if (availableModels.has(qualified)) {
          debug(`Model resolved for "${agentName}"`, { via: "fallback-chain", model: qualified })
          return qualified
        }
        if (availableModels.has(entry.model)) {
          debug(`Model resolved for "${agentName}"`, { via: "fallback-chain", model: entry.model })
          return entry.model
        }
      }
    }
  }

  // 5. System default
  if (systemDefaultModel) {
    debug(`Model resolved for "${agentName}"`, { via: "system-default", model: systemDefaultModel })
    return systemDefaultModel
  }

  // 6. Best-guess offline: first entry in fallback chain
  if (fallbackChain && fallbackChain.length > 0) {
    const first = fallbackChain[0]
    if (first.providers.length > 0) {
      const guessed = `${first.providers[0]}/${first.model}`
      debug(`Model resolved for "${agentName}" (offline best-guess — no available models matched)`, { via: "offline-guess", model: guessed })
      return guessed
    }
  }

  warn(`No model resolved for agent "${agentName}" — falling back to default github-copilot/claude-opus-4.8`, { agentName })
  return "github-copilot/claude-opus-4.8"
}
