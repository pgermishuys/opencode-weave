import type { AgentPromptMetadata } from "./types"

export interface AvailableAgent {
  name: string
  description: string
  metadata: AgentPromptMetadata
}

export interface AvailableTool {
  name: string
  category: "lsp" | "ast" | "search" | "session" | "command" | "other"
}

export interface AvailableSkill {
  name: string
  description: string
  location: "user" | "project" | "builtin"
}

export interface AvailableCategory {
  name: string
  description: string
  model?: string
}

export function categorizeTools(toolNames: string[]): AvailableTool[] {
  return toolNames.map((name) => {
    let category: AvailableTool["category"] = "other"
    if (name.startsWith("lsp_")) {
      category = "lsp"
    } else if (name.startsWith("ast_grep")) {
      category = "ast"
    } else if (name === "grep" || name === "glob") {
      category = "search"
    } else if (name.startsWith("session_")) {
      category = "session"
    } else if (name === "skill") {
      category = "command"
    }
    return { name, category }
  })
}

function formatToolsForPrompt(tools: AvailableTool[]): string {
  const lspTools = tools.filter((t) => t.category === "lsp")
  const astTools = tools.filter((t) => t.category === "ast")
  const searchTools = tools.filter((t) => t.category === "search")

  const parts: string[] = []

  if (searchTools.length > 0) {
    parts.push(...searchTools.map((t) => `\`${t.name}\``))
  }

  if (lspTools.length > 0) {
    parts.push("`lsp_*`")
  }

  if (astTools.length > 0) {
    parts.push("`ast_grep`")
  }

  return parts.join(", ")
}

export function buildKeyTriggersSection(agents: AvailableAgent[], _skills: AvailableSkill[] = []): string {
  const keyTriggers = agents
    .filter((a) => a.metadata.keyTrigger)
    .map((a) => `- ${a.metadata.keyTrigger}`)

  if (keyTriggers.length === 0) return ""

  return `### Key Triggers (check BEFORE classification):

${keyTriggers.join("\n")}
- **"Look into" + "create PR"** → Not just research. Full implementation cycle expected.`
}

export function buildToolSelectionTable(
  agents: AvailableAgent[],
  tools: AvailableTool[] = [],
  _skills: AvailableSkill[] = [],
): string {
  const rows: string[] = [
    "### Tool & Agent Selection:",
    "",
  ]

  if (tools.length > 0) {
    const toolsDisplay = formatToolsForPrompt(tools)
    if (toolsDisplay) {
      rows.push(`- ${toolsDisplay} — **FREE** — Not Complex, Scope Clear, No Implicit Assumptions`)
    }
  }

  const costOrder: Record<string, number> = { FREE: 0, CHEAP: 1, EXPENSIVE: 2 }
  const sortedAgents = [...agents]
    .filter((a) => a.metadata.category !== "utility")
    .sort((a, b) => (costOrder[a.metadata.cost] ?? 0) - (costOrder[b.metadata.cost] ?? 0))

  for (const agent of sortedAgents) {
    const shortDesc = agent.description.split(".")[0] || agent.description
    rows.push(`- \`${agent.name}\` agent — **${agent.metadata.cost}** — ${shortDesc}`)
  }

  rows.push("")
  rows.push("**Default flow**: thread/spindle (background) + tools → pattern (if required)")

  return rows.join("\n")
}

export function buildThreadSection(agents: AvailableAgent[]): string {
  const threadAgent = agents.find((a) => a.name === "thread")
  if (!threadAgent) return ""

  const useWhen = threadAgent.metadata.useWhen ?? []
  const avoidWhen = threadAgent.metadata.avoidWhen ?? []

  return `### Thread Agent = Contextual Grep

Use it as a **peer tool**, not a fallback. Fire liberally.

**Use Direct Tools when:**
${avoidWhen.map((w) => `- ${w}`).join("\n")}

**Use Thread Agent when:**
${useWhen.map((w) => `- ${w}`).join("\n")}`
}

export function buildSpindleSection(agents: AvailableAgent[]): string {
  const spindleAgent = agents.find((a) => a.name === "spindle")
  if (!spindleAgent) return ""

  const useWhen = spindleAgent.metadata.useWhen ?? []

  return `### Spindle Agent = Reference Search

Search **external references** (docs, OSS, web). Fire proactively when unfamiliar libraries are involved.

**Contextual Search (Internal)** — search OUR codebase, find patterns in THIS repo, project-specific logic.
**Reference Search (External)** — search EXTERNAL resources, official API docs, library best practices, OSS implementation examples.

**Trigger phrases** (fire spindle immediately):
${useWhen.map((w) => `- "${w}"`).join("\n")}`
}

export function buildWeftSection(agents: AvailableAgent[]): string {
  const weftAgent = agents.find((a) => a.name === "weft")
  if (!weftAgent) return ""

  const useWhen = weftAgent.metadata.useWhen ?? []
  const avoidWhen = weftAgent.metadata.avoidWhen ?? []

  return `### Weft Agent = Quality Gate

Invoke after significant work for a read-only review. Approval-biased — rejects only for real blockers.

**Use Weft when:**
${useWhen.map((w) => `- ${w}`).join("\n")}

**Skip Weft when:**
${avoidWhen.map((w) => `- ${w}`).join("\n")}`
}

export function buildDelegationTable(agents: AvailableAgent[]): string {
  const rows: string[] = [
    "### Delegation Table:",
    "",
  ]

  for (const agent of agents) {
    for (const trigger of agent.metadata.triggers) {
      rows.push(`- **${trigger.domain}** → \`${agent.name}\` — ${trigger.trigger}`)
    }
  }

  return rows.join("\n")
}

export function buildCategorySkillsDelegationGuide(
  categories: AvailableCategory[],
  skills: AvailableSkill[],
): string {
  if (categories.length === 0 && skills.length === 0) return ""

  const categoryRows = categories.map((c) => {
    const desc = c.description || c.name
    return `- \`${c.name}\` — ${desc}`
  })

  const builtinSkills = skills.filter((s) => s.location === "builtin")
  const customSkills = skills.filter((s) => s.location !== "builtin")

  const builtinNames = builtinSkills.map((s) => s.name).join(", ")
  const customNames = customSkills
    .map((s) => {
      const source = s.location === "project" ? "project" : "user"
      return `${s.name} (${source})`
    })
    .join(", ")

  let skillsSection: string

  if (customSkills.length > 0 && builtinSkills.length > 0) {
    skillsSection = `#### Available Skills (via \`skill\` tool)

**Built-in**: ${builtinNames}
**⚡ YOUR SKILLS (PRIORITY)**: ${customNames}

> User-installed skills OVERRIDE built-in defaults. ALWAYS prefer YOUR SKILLS when domain matches.
> Full skill descriptions → use the \`skill\` tool to check before EVERY delegation.`
  } else if (customSkills.length > 0) {
    skillsSection = `#### Available Skills (via \`skill\` tool)

**⚡ YOUR SKILLS (PRIORITY)**: ${customNames}

> User-installed skills OVERRIDE built-in defaults. ALWAYS prefer YOUR SKILLS when domain matches.
> Full skill descriptions → use the \`skill\` tool to check before EVERY delegation.`
  } else if (builtinSkills.length > 0) {
    skillsSection = `#### Available Skills (via \`skill\` tool)

**Built-in**: ${builtinNames}

> Full skill descriptions → use the \`skill\` tool to check before EVERY delegation.`
  } else {
    skillsSection = ""
  }

  return `### Category + Skills Delegation System

**task() combines categories and skills for optimal task execution.**

#### Available Categories (Domain-Optimized Models)

Each category is configured with a model optimized for that domain. Read the description to understand when to use it.

${categoryRows.join("\n")}

${skillsSection}

---

### MANDATORY: Category + Skill Selection Protocol

**STEP 1: Select Category**
- Read each category's description
- Match task requirements to category domain
- Select the category whose domain BEST fits the task

**STEP 2: Evaluate ALL Skills**
Check the \`skill\` tool for available skills and their descriptions. For EVERY skill, ask:
> "Does this skill's expertise domain overlap with my task?"

- If YES → INCLUDE in \`load_skills=[...]\`
- If NO → OMIT (no justification needed)
${customSkills.length > 0 ? `
> **User-installed skills get PRIORITY.** When in doubt, INCLUDE rather than omit.` : ""}

---

### Delegation Pattern

\`\`\`typescript
task(
  category="[selected-category]",
  load_skills=["skill-1", "skill-2"],  // Include ALL relevant skills — ESPECIALLY user-installed ones
  prompt="..."
)
\`\`\`

**ANTI-PATTERN (will produce poor results):**
\`\`\`typescript
task(category="...", load_skills=[], run_in_background=false, prompt="...")  // Empty load_skills without justification
\`\`\``
}
