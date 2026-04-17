import { z } from "zod"
import { isAbsolute } from "path"
import { hasLeadingBackslash, hasWindowsDrivePrefix } from "../shared/path-helpers"

/**
 * Zod schema for a safe relative directory path.
 * Rejects absolute paths, Windows drive roots / UNC-style paths, and paths
 * containing `..` traversal segments.
 * This is defense-in-depth — runtime resolution in resolveSafePath also sandboxes.
 */
const SafeRelativePathSchema = z.string().refine(
  (p) =>
    !isAbsolute(p) &&
    !hasWindowsDrivePrefix(p) &&
    !hasLeadingBackslash(p) &&
    !p.split(/[/\\]/).includes(".."),
  {
    message:
      "Directory paths must be relative, must not start with a drive root or backslash, and must not contain '..' segments",
  },
)

const ModelOptionsSchema = z.record(z.string(), z.unknown())

export const AgentOverrideConfigSchema = z.object({
  model: z.string().optional(),
  fallback_models: z.array(z.string()).optional(),
  variant: z.string().optional(),
  category: z.string().optional(),
  skills: z.array(z.string()).optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  prompt: z.string().optional(),
  prompt_append: z.string().optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  modelOptions: ModelOptionsSchema.optional(),
  disable: z.boolean().optional(),
  mode: z.enum(["subagent", "primary", "all"]).optional(),
  maxTokens: z.number().optional(),
  /** Custom display name shown in UI (overrides the default builtin name) */
  display_name: z.string().optional(),
})

export const AgentOverridesSchema = z.record(z.string(), AgentOverrideConfigSchema)

export const CategoryConfigSchema = z.object({
  description: z.string().optional(),
  model: z.string().optional(),
  fallback_models: z.array(z.string()).optional(),
  variant: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  maxTokens: z.number().optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  prompt_append: z.string().optional(),
  disable: z.boolean().optional(),
  /** Glob patterns for file-based task routing to this category's Shuttle agent */
  patterns: z.array(z.string()).optional(),
})

export const CategoriesConfigSchema = z.record(z.string(), CategoryConfigSchema)

export const BackgroundConfigSchema = z.object({
  defaultConcurrency: z.number().min(1).optional(),
  providerConcurrency: z.record(z.string(), z.number().min(0)).optional(),
  modelConcurrency: z.record(z.string(), z.number().min(0)).optional(),
  staleTimeoutMs: z.number().min(60000).optional(),
})

export const TmuxConfigSchema = z.object({
  enabled: z.boolean().optional(),
  layout: z
    .enum(["main-horizontal", "main-vertical", "tiled", "even-horizontal", "even-vertical"])
    .optional(),
  main_pane_size: z.number().optional(),
})

export const ExperimentalConfigSchema = z.object({
  plugin_load_timeout_ms: z.number().min(1000).optional(),
  context_window_warning_threshold: z.number().min(0).max(1).optional(),
  context_window_critical_threshold: z.number().min(0).max(1).optional(),
})

export const DelegationTriggerSchema = z.object({
  domain: z.string(),
  trigger: z.string(),
})

export const CustomAgentConfigSchema = z.object({
  /** System prompt — either inline text or path to a .md file (resolved relative to config) */
  prompt: z.string().optional(),
  /** Path to a .md file containing the system prompt */
  prompt_file: z.string().optional(),
  /** Model to use (required for custom agents with no fallback chain) */
  model: z.string().optional(),
  /** Display name shown in UI */
  display_name: z.string().optional(),
  /** Agent mode: subagent (default), primary, or all */
  mode: z.enum(["subagent", "primary", "all"]).optional(),
  /** Fallback model chain for model resolution */
  fallback_models: z.array(z.string()).optional(),
  /** Agent category for grouping */
  category: z.enum(["exploration", "specialist", "advisor", "utility"]).optional(),
  /** Cost classification for tool selection table */
  cost: z.enum(["FREE", "CHEAP", "EXPENSIVE"]).optional(),
  /** Sampling temperature */
  temperature: z.number().min(0).max(2).optional(),
  /** Top-p sampling */
  top_p: z.number().min(0).max(1).optional(),
  /** Max tokens */
  maxTokens: z.number().optional(),
  /** Provider/model-specific passthrough options (e.g. reasoningEffort, reasoning) */
  modelOptions: ModelOptionsSchema.optional(),
  /** Tool permissions (true = enabled, false = denied) */
  tools: z.record(z.string(), z.boolean()).optional(),
  /** Skills to load for this agent */
  skills: z.array(z.string()).optional(),
  /** Delegation triggers for Loom prompt integration */
  triggers: z.array(DelegationTriggerSchema).optional(),
  /** Description shown alongside the agent name */
  description: z.string().optional(),
})

export const CustomAgentsConfigSchema = z.record(z.string(), CustomAgentConfigSchema)

export const AnalyticsConfigSchema = z.object({
  /** Whether analytics is enabled. Defaults to false (opt-in). */
  enabled: z.boolean().optional(),
  /**
   * Whether to inject the project fingerprint (platform, stack, etc.) into
   * agent prompts. Requires analytics.enabled to also be true. Defaults to
   * false (opt-in) to avoid unexpected token usage.
   */
  use_fingerprint: z.boolean().optional(),
})

export const ContinuationRecoveryConfigSchema = z.object({
  /** Whether Weave should inject a resume prompt after session compaction/context restoration. */
  compaction: z.boolean().optional(),
})

export const ContinuationIdleConfigSchema = z.object({
  /** Master switch for generic session.idle prompt injection. */
  enabled: z.boolean().optional(),
  /** Idle prompt for active /start-work plans with remaining tasks. */
  work: z.boolean().optional(),
  /** Idle prompt for active workflows waiting to continue. */
  workflow: z.boolean().optional(),
  /** Prompt fallback for lingering in_progress todos when silent repair is unavailable. */
  todo_prompt: z.boolean().optional(),
})

export const ContinuationConfigSchema = z.object({
  recovery: ContinuationRecoveryConfigSchema.optional(),
  idle: ContinuationIdleConfigSchema.optional(),
})

export const WorkflowConfigSchema = z.object({
  disabled_workflows: z.array(z.string()).optional(),
  /** Additional directories to scan for workflow definitions (alongside .opencode/workflows/) */
  directories: z.array(SafeRelativePathSchema).optional(),
})

export const WeaveConfigSchema = z.object({
  $schema: z.string().optional(),
  agents: AgentOverridesSchema.optional(),
  custom_agents: CustomAgentsConfigSchema.optional(),
  categories: CategoriesConfigSchema.optional(),
  disabled_hooks: z.array(z.string()).optional(),
  disabled_tools: z.array(z.string()).optional(),
  disabled_agents: z.array(z.string()).optional(),
  disabled_skills: z.array(z.string()).optional(),
  /** Additional directories to scan for skills (alongside .opencode/skills/) */
  skill_directories: z.array(SafeRelativePathSchema).optional(),
  background: BackgroundConfigSchema.optional(),
  analytics: AnalyticsConfigSchema.optional(),
  continuation: ContinuationConfigSchema.optional(),
  tmux: TmuxConfigSchema.optional(),
  experimental: ExperimentalConfigSchema.optional(),
  workflows: WorkflowConfigSchema.optional(),
  /** Log level for Weave's structured logger. Overrides WEAVE_LOG_LEVEL env var. */
  log_level: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).optional(),
})

export type AgentOverrideConfig = z.infer<typeof AgentOverrideConfigSchema>
export type AgentOverrides = z.infer<typeof AgentOverridesSchema>
export type CustomAgentConfig = z.infer<typeof CustomAgentConfigSchema>
export type CustomAgentsConfig = z.infer<typeof CustomAgentsConfigSchema>
export type CategoryConfig = z.infer<typeof CategoryConfigSchema>
export type CategoriesConfig = z.infer<typeof CategoriesConfigSchema>
export type BackgroundConfig = z.infer<typeof BackgroundConfigSchema>
export type AnalyticsConfig = z.infer<typeof AnalyticsConfigSchema>
export type ContinuationRecoveryConfig = z.infer<typeof ContinuationRecoveryConfigSchema>
export type ContinuationIdleConfig = z.infer<typeof ContinuationIdleConfigSchema>
export type ContinuationConfig = z.infer<typeof ContinuationConfigSchema>
export type TmuxConfig = z.infer<typeof TmuxConfigSchema>
export type ExperimentalConfig = z.infer<typeof ExperimentalConfigSchema>
export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>
export type WeaveConfig = z.infer<typeof WeaveConfigSchema>
