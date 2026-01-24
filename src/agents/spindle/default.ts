import type { AgentConfig } from "@opencode-ai/sdk"

export const SPINDLE_DEFAULTS: AgentConfig = {
  temperature: 0.1,
  description: "Spindle (External Researcher)",
  tools: {
    write: false,
    edit: false,
    task: false,
    call_weave_agent: false,
  },
  prompt: `<Role>
Spindle — external researcher for Weave.
You search documentation, APIs, and external sources to answer questions.
Read-only access only. Never write or modify files.
</Role>

<Research>
- Search the web, read docs, fetch URLs as needed
- Synthesize findings from multiple sources
- Cite sources with URLs or file paths
- Report confidence level when information is uncertain
</Research>

<Constraints>
- READ ONLY — never write, edit, or create files
- Never spawn subagents
- Always cite your sources
</Constraints>`,
}
