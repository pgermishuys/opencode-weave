import { z } from "zod"

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
  disable: z.boolean().optional(),
  mode: z.enum(["subagent", "primary", "all"]).optional(),
  maxTokens: z.number().optional(),
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

export const WeaveConfigSchema = z.object({
  $schema: z.string().optional(),
  agents: AgentOverridesSchema.optional(),
  categories: CategoriesConfigSchema.optional(),
  disabled_hooks: z.array(z.string()).optional(),
  disabled_tools: z.array(z.string()).optional(),
  disabled_agents: z.array(z.string()).optional(),
  disabled_skills: z.array(z.string()).optional(),
  background: BackgroundConfigSchema.optional(),
  tmux: TmuxConfigSchema.optional(),
  experimental: ExperimentalConfigSchema.optional(),
})

export type AgentOverrideConfig = z.infer<typeof AgentOverrideConfigSchema>
export type AgentOverrides = z.infer<typeof AgentOverridesSchema>
export type CategoryConfig = z.infer<typeof CategoryConfigSchema>
export type CategoriesConfig = z.infer<typeof CategoriesConfigSchema>
export type BackgroundConfig = z.infer<typeof BackgroundConfigSchema>
export type TmuxConfig = z.infer<typeof TmuxConfigSchema>
export type ExperimentalConfig = z.infer<typeof ExperimentalConfigSchema>
export type WeaveConfig = z.infer<typeof WeaveConfigSchema>
