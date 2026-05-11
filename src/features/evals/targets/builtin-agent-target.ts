import { LOOM_DEFAULTS } from "../../../agents/loom/default"
import { composeLoomPrompt } from "../../../agents/loom/prompt-composer"
import { TAPESTRY_DEFAULTS } from "../../../agents/tapestry/default"
import { composeTapestryPrompt } from "../../../agents/tapestry/prompt-composer"
import { PATTERN_DEFAULTS } from "../../../agents/pattern/default"
import { THREAD_DEFAULTS } from "../../../agents/thread/default"
import { SPINDLE_DEFAULTS } from "../../../agents/spindle/default"
import { WEFT_DEFAULTS } from "../../../agents/weft/default"
import { WARP_DEFAULTS } from "../../../agents/warp/default"
import { SHUTTLE_DEFAULTS } from "../../../agents/shuttle/default"
import { buildReviewModelVariants } from "../../../agents/review-model-variants"
import type { BuiltinAgentPromptTarget, ResolvedTarget } from "../types"

function cloneTools(tools: Record<string, boolean> | undefined): Record<string, boolean> {
  return tools ? { ...tools } : {}
}

export function resolveBuiltinAgentTarget(target: BuiltinAgentPromptTarget): ResolvedTarget {
  const disabledAgents = new Set(target.variant?.disabledAgents ?? [])
  const agentOverrides = target.variant?.agentOverrides
  const reviewModelVariants = buildReviewModelVariants(agentOverrides, disabledAgents)

  switch (target.agent) {
    case "loom": {
      const renderedPrompt = composeLoomPrompt({
        disabledAgents,
        agentOverrides,
        reviewModelVariants,
      } as Parameters<typeof composeLoomPrompt>[0])
      return {
        target,
        artifacts: {
          renderedPrompt,
          promptLength: renderedPrompt.length,
          toolPolicy: cloneTools(LOOM_DEFAULTS.tools as Record<string, boolean> | undefined),
          agentMetadata: {
            agent: "loom",
            description: LOOM_DEFAULTS.description,
            sourceKind: "composer",
          },
        },
      }
    }
    case "tapestry": {
      const renderedPrompt = composeTapestryPrompt({
        disabledAgents,
        categories: target.variant?.categories,
        agentOverrides,
        reviewModelVariants,
      } as Parameters<typeof composeTapestryPrompt>[0])
      return {
        target,
        artifacts: {
          renderedPrompt,
          promptLength: renderedPrompt.length,
          toolPolicy: cloneTools(TAPESTRY_DEFAULTS.tools as Record<string, boolean> | undefined),
          agentMetadata: {
            agent: "tapestry",
            description: TAPESTRY_DEFAULTS.description,
            sourceKind: "composer",
          },
        },
      }
    }
    case "pattern":
      return {
        target,
        artifacts: {
          renderedPrompt: PATTERN_DEFAULTS.prompt,
          promptLength: PATTERN_DEFAULTS.prompt?.length,
          toolPolicy: cloneTools(PATTERN_DEFAULTS.tools as Record<string, boolean> | undefined),
          agentMetadata: {
            agent: "pattern",
            description: PATTERN_DEFAULTS.description,
            sourceKind: "default",
          },
        },
      }
    case "thread":
      return {
        target,
        artifacts: {
          renderedPrompt: THREAD_DEFAULTS.prompt,
          promptLength: THREAD_DEFAULTS.prompt?.length,
          toolPolicy: cloneTools(THREAD_DEFAULTS.tools as Record<string, boolean> | undefined),
          agentMetadata: {
            agent: "thread",
            description: THREAD_DEFAULTS.description,
            sourceKind: "default",
          },
        },
      }
    case "spindle":
      return {
        target,
        artifacts: {
          renderedPrompt: SPINDLE_DEFAULTS.prompt,
          promptLength: SPINDLE_DEFAULTS.prompt?.length,
          toolPolicy: cloneTools(SPINDLE_DEFAULTS.tools as Record<string, boolean> | undefined),
          agentMetadata: {
            agent: "spindle",
            description: SPINDLE_DEFAULTS.description,
            sourceKind: "default",
          },
        },
      }
    case "weft":
      return {
        target,
        artifacts: {
          renderedPrompt: WEFT_DEFAULTS.prompt,
          promptLength: WEFT_DEFAULTS.prompt?.length,
          toolPolicy: cloneTools(WEFT_DEFAULTS.tools as Record<string, boolean> | undefined),
          agentMetadata: {
            agent: "weft",
            description: WEFT_DEFAULTS.description,
            sourceKind: "default",
          },
        },
      }
    case "warp":
      return {
        target,
        artifacts: {
          renderedPrompt: WARP_DEFAULTS.prompt,
          promptLength: WARP_DEFAULTS.prompt?.length,
          toolPolicy: cloneTools(WARP_DEFAULTS.tools as Record<string, boolean> | undefined),
          agentMetadata: {
            agent: "warp",
            description: WARP_DEFAULTS.description,
            sourceKind: "default",
          },
        },
      }
    case "shuttle":
      return {
        target,
        artifacts: {
          renderedPrompt: SHUTTLE_DEFAULTS.prompt,
          promptLength: SHUTTLE_DEFAULTS.prompt?.length,
          toolPolicy: cloneTools(SHUTTLE_DEFAULTS.tools as Record<string, boolean> | undefined),
          agentMetadata: {
            agent: "shuttle",
            description: SHUTTLE_DEFAULTS.description,
            sourceKind: "default",
          },
        },
      }
  }
}
