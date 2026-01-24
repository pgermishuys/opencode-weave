import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentFactory } from "../types"
import { THREAD_DEFAULTS } from "./default"

export const createThreadAgent: AgentFactory = (model: string): AgentConfig => ({
  ...THREAD_DEFAULTS,
  tools: { ...THREAD_DEFAULTS.tools },
  model,
  mode: "subagent",
})
createThreadAgent.mode = "subagent"
