import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrideConfig } from "../config/schema"

export type ReviewBaseAgent = "weft" | "warp"

export interface ReviewModelVariant {
  baseAgent: ReviewBaseAgent
  key: string
  model: string
  label: string
}

type AgentConfigWithOptions = AgentConfig & {
  options?: Record<string, unknown>
}

const REVIEW_BASE_AGENTS = ["weft", "warp"] as const

/**
 * Build visible subagent variants from agents.weft/warp.review_models.
 *
 * Example:
 *   agents.weft.review_models = ["opencode-go/kimi-k2.6"]
 *   -> subagent_type "weft-review-opencode-go-kimi-k2-6"
 */
export function buildReviewModelVariants(
  agentOverrides: Record<string, AgentOverrideConfig> | undefined,
  disabledAgents: Set<string> = new Set(),
): ReviewModelVariant[] {
  const seenKeys = new Set<string>()
  const variants: ReviewModelVariant[] = []

  for (const baseAgent of REVIEW_BASE_AGENTS) {
    if (disabledAgents.has(baseAgent)) continue

    const override = agentOverrides?.[baseAgent]
    const reviewModels = override?.review_models ?? []
    const primaryModel = override?.model
    const seenModels = new Set<string>()

    for (const model of reviewModels) {
      if (model === primaryModel) continue
      if (seenModels.has(model)) continue
      seenModels.add(model)

      const key = buildUniqueVariantKey(baseAgent, model, seenKeys)
      if (disabledAgents.has(key)) continue

      seenKeys.add(key)
      variants.push({
        baseAgent,
        key,
        model,
        label: `${baseAgent} @ ${model}`,
      })
    }
  }

  return variants
}

export function buildReviewModelVariantAgent(
  baseConfig: AgentConfig,
  variant: ReviewModelVariant,
): AgentConfig {
  const { options: _baseModelOptions, ...baseWithoutOptions } = baseConfig as AgentConfigWithOptions
  const boundary = variant.baseAgent === "weft"
    ? "You are a Weft code-quality/plan reviewer, not Warp. Do NOT label your work as a security audit. Security audits must use Warp or a warp-review-* variant."
    : "You are a Warp security reviewer, not Weft. Focus on security/specification concerns and self-triage as Warp normally does."
  const prompt = [
    baseWithoutOptions.prompt,
    `<ReviewVariant>
You are ${variant.label}, a visible independent ${variant.baseAgent.toUpperCase()} review variant.
Review the same input independently using model ${variant.model}.
Return a complete standalone review with your own APPROVE or REJECT verdict.
${boundary}
Do not mention or wait for other review variants.
</ReviewVariant>`,
  ].filter(Boolean).join("\n\n")

  return {
    ...baseWithoutOptions,
    model: variant.model,
    mode: "subagent",
    description: `${variant.label} (visible multi-review variant)`,
    prompt,
  }
}

export function reviewVariantsFor(
  variants: ReviewModelVariant[] | undefined,
  baseAgent: ReviewBaseAgent,
): ReviewModelVariant[] {
  return (variants ?? []).filter((variant) => variant.baseAgent === baseAgent)
}

export function formatReviewVariantList(variants: ReviewModelVariant[]): string {
  return variants
    .map((variant) => `${variant.label} (subagent_type "${variant.key}")`)
    .join(", ")
}

function buildUniqueVariantKey(baseAgent: ReviewBaseAgent, model: string, seenKeys: Set<string>): string {
  const baseKey = sanitizeAgentKey(`${baseAgent}-review-${model.replace("/", "-")}`)
  let key = baseKey
  let suffix = 2

  while (seenKeys.has(key)) {
    key = `${baseKey}-${suffix++}`
  }

  return key
}

function sanitizeAgentKey(value: string): string {
  const key = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")

  return /^[a-z]/.test(key) ? key : `review-${key}`
}
