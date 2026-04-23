import type { WeaveConfig } from "./schema"
import type { DeepPartial } from "../shared/types"

function deepMergeObjects(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base }
  for (const key of Object.keys(override)) {
    const overrideVal = override[key]
    const baseVal = base[key]
    if (
      overrideVal !== null &&
      typeof overrideVal === "object" &&
      !Array.isArray(overrideVal) &&
      baseVal !== null &&
      typeof baseVal === "object" &&
      !Array.isArray(baseVal)
    ) {
      result[key] = deepMergeObjects(
        baseVal as Record<string, unknown>,
        overrideVal as Record<string, unknown>,
      )
    } else if (overrideVal !== undefined) {
      result[key] = overrideVal
    }
  }
  return result
}

function mergeStringArrays(
  base?: readonly string[],
  override?: readonly string[],
): string[] | undefined {
  if (!base && !override) return undefined
  return [...new Set([...(base ?? []), ...(override ?? [])])]
}

export function mergeConfigs(
  user: DeepPartial<WeaveConfig>,
  project: DeepPartial<WeaveConfig>,
): DeepPartial<WeaveConfig> {
  const mergedReview =
    user.review || project.review
      ? (deepMergeObjects(
          (user.review ?? {}) as Record<string, unknown>,
          (project.review ?? {}) as Record<string, unknown>,
        ) as DeepPartial<WeaveConfig>["review"])
      : undefined

  // Special-case merge semantics: review.additional_agents is project-overrides-user
  // (not a union), so projects can intentionally clear inherited user reviewers
  // via [] without carrying over user-level entries.
  const mergedReviewAdditionalAgents =
    project.review?.additional_agents !== undefined
      ? project.review.additional_agents
      : user.review?.additional_agents

  return {
    ...user,
    ...project,
    agents:
      user.agents || project.agents
        ? (deepMergeObjects(
            (user.agents ?? {}) as Record<string, unknown>,
            (project.agents ?? {}) as Record<string, unknown>,
          ) as DeepPartial<WeaveConfig>["agents"])
        : undefined,
    custom_agents:
      user.custom_agents || project.custom_agents
        ? (deepMergeObjects(
            (user.custom_agents ?? {}) as Record<string, unknown>,
            (project.custom_agents ?? {}) as Record<string, unknown>,
          ) as DeepPartial<WeaveConfig>["custom_agents"])
        : undefined,
    categories:
      user.categories || project.categories
        ? (deepMergeObjects(
            (user.categories ?? {}) as Record<string, unknown>,
            (project.categories ?? {}) as Record<string, unknown>,
          ) as DeepPartial<WeaveConfig>["categories"])
        : undefined,
    disabled_hooks: mergeStringArrays(user.disabled_hooks, project.disabled_hooks),
    disabled_tools: mergeStringArrays(user.disabled_tools, project.disabled_tools),
    disabled_agents: mergeStringArrays(user.disabled_agents, project.disabled_agents),
    disabled_skills: mergeStringArrays(user.disabled_skills, project.disabled_skills),
    background: project.background ?? user.background,
    review: mergedReview
      ? {
          ...mergedReview,
          ...(mergedReviewAdditionalAgents !== undefined
            ? { additional_agents: mergedReviewAdditionalAgents }
            : {}),
        }
      : undefined,
    tmux: project.tmux ?? user.tmux,
    experimental:
      user.experimental || project.experimental
        ? { ...user.experimental, ...project.experimental }
        : undefined,
  }
}
