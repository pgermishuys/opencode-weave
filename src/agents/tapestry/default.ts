import type { AgentConfig } from "@opencode-ai/sdk"
import { composeTapestryPrompt } from "./prompt-composer"

export const TAPESTRY_DEFAULTS: AgentConfig = {
  temperature: 0.1,
  description: "Tapestry (Execution Orchestrator)",
  tools: {
    call_weave_agent: true,
  },
  prompt: composeTapestryPrompt(),
}
