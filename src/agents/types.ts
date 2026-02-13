import type { AgentConfig } from "@opencode-ai/sdk"

/**
 * Agent mode determines UI model selection behavior:
 * - "primary": Respects user's UI-selected model (loom, tapestry)
 * - "subagent": Uses own fallback chain, ignores UI selection (pattern, thread, spindle)
 * - "all": Available in both contexts (shuttle)
 */
export type AgentMode = "primary" | "subagent" | "all"

/**
 * Agent factory function with static mode property.
 * Mode is exposed as static property for pre-instantiation access.
 */
export type AgentFactory = ((model: string) => AgentConfig) & {
  mode: AgentMode
}

/**
 * Agent source is either a factory (called with model) or a static config (cloned)
 */
export type AgentSource = AgentFactory | AgentConfig

/**
 * Agent category for grouping in Loom prompt sections
 */
export type AgentCategory = "exploration" | "specialist" | "advisor" | "utility"

/**
 * Cost classification for Tool Selection table
 */
export type AgentCost = "FREE" | "CHEAP" | "EXPENSIVE"

/**
 * Delegation trigger for Loom prompt's Delegation Table
 */
export interface DelegationTrigger {
  /** Domain of work (e.g., "Frontend UI/UX") */
  domain: string
  /** When to delegate (e.g., "Visual changes only...") */
  trigger: string
}

/**
 * Metadata for generating Loom prompt sections dynamically.
 * Allows adding/removing agents without manually updating the Loom prompt.
 */
export interface AgentPromptMetadata {
  /** Category for grouping in prompt sections */
  category: AgentCategory

  /** Cost classification for Tool Selection table */
  cost: AgentCost

  /** Domain triggers for Delegation Table */
  triggers: DelegationTrigger[]

  /** When to use this agent (for detailed sections) */
  useWhen?: string[]

  /** When NOT to use this agent */
  avoidWhen?: string[]

  /** Optional dedicated prompt section (markdown) */
  dedicatedSection?: string

  /** Nickname/alias used in prompt (e.g., "Pattern" instead of "pattern") */
  promptAlias?: string

  /** Key trigger that should appear in Phase 0 quick checks */
  keyTrigger?: string
}

/**
 * The 7 built-in Weave agent names
 */
export type WeaveAgentName =
  | "loom"
  | "tapestry"
  | "shuttle"
  | "pattern"
  | "thread"
  | "spindle"
  | "weft"

/**
 * Override config for a single agent — all fields optional
 */
export type AgentOverrideConfig = Partial<AgentConfig> & {
  prompt_append?: string
  variant?: string
  fallback_models?: string | string[]
}

/**
 * Map of agent name to override config
 */
export type AgentOverrides = Partial<Record<WeaveAgentName, AgentOverrideConfig>>

function extractModelName(model: string): string {
  return model.includes("/") ? (model.split("/").pop() ?? model) : model
}

const GPT_MODEL_PREFIXES = ["gpt-", "gpt4", "o1", "o3", "o4"]

/**
 * Returns true if the model string identifies a GPT/OpenAI model.
 */
export function isGptModel(model: string): boolean {
  if (model.startsWith("openai/") || model.startsWith("github-copilot/gpt-"))
    return true
  const modelName = extractModelName(model).toLowerCase()
  return GPT_MODEL_PREFIXES.some((prefix) => modelName.startsWith(prefix))
}

/**
 * Type guard: returns true if source is an AgentFactory (callable with .mode).
 */
export function isFactory(source: AgentSource): source is AgentFactory {
  return typeof source === "function"
}
