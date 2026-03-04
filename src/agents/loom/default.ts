import type { AgentConfig } from "@opencode-ai/sdk"
import { composeLoomPrompt } from "./prompt-composer"

export const LOOM_DEFAULTS: AgentConfig = {
  temperature: 0.1,
  description: "Loom (Main Orchestrator)",
  prompt: composeLoomPrompt(),
}
