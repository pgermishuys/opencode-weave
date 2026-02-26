# Weave Agent Orchestration Model — Complete Exploration

## Executive Summary

Weave is an OpenCode plugin that implements a sophisticated multi-agent orchestration system with 8 specialized agents, a plan-execute workflow, and hook-based control flow. Agents switch roles through either **agent mode configuration** (primary vs. subagent) or through explicit **command redirection** via the `/start-work` slash command.

---

## File Structure & Locations

### Configuration Files

#### User-Level Config
- **Location**: `~/.config/opencode/opencode.json`
- **Plugin Config**: `~/.config/opencode/weave-opencode.jsonc` or `~/.config/opencode/weave-opencode.json`
- **Agent Definitions**: `~/.config/opencode/agent/` (contains custom agent markdown files)

#### Project-Level Config
- **Location**: `.opencode/weave-opencode.jsonc` or `.opencode/weave-opencode.json`
- **Work Plans**: `.weave/plans/*.md`
- **Work State**: `.weave/state.json`
- **Rules**: `AGENTS.md` (injectable context)

### Source Code Locations (Weave Plugin)

#### Agent Definitions
| Agent | Type | Files |
|-------|------|-------|
| **Loom** | primary orchestrator | `/Users/pgermishuys/source/weave/src/agents/loom/index.ts`, `default.ts` |
| **Tapestry** | execution orchestrator | `/Users/pgermishuys/source/weave/src/agents/tapestry/index.ts`, `default.ts` |
| **Pattern** | strategic planner | `/Users/pgermishuys/source/weave/src/agents/pattern/index.ts`, `default.ts` |
| **Thread** | codebase explorer | `/Users/pgermishuys/source/weave/src/agents/thread/index.ts`, `default.ts` |
| **Spindle** | external researcher | `/Users/pgermishuys/source/weave/src/agents/spindle/index.ts`, `default.ts` |
| **Weft** | reviewer/auditor | `/Users/pgermishuys/source/weave/src/agents/weft/index.ts`, `default.ts` |
| **Warp** | security auditor | `/Users/pgermishuys/source/weave/src/agents/warp/index.ts`, `default.ts` |
| **Shuttle** | category specialist | `/Users/pgermishuys/source/weave/src/agents/shuttle/index.ts`, `default.ts` |

#### Core Agent Management
- **Agent Metadata**: `/Users/pgermishuys/source/weave/src/agents/builtin-agents.ts` (AGENT_METADATA, AGENT_FACTORIES)
- **Agent Types**: `/Users/pgermishuys/source/weave/src/agents/types.ts` (AgentMode, AgentFactory, WeaveAgentName)
- **Model Resolution**: `/Users/pgermishuys/source/weave/src/agents/model-resolution.ts`
- **Agent Builder**: `/Users/pgermishuys/source/weave/src/agents/agent-builder.ts`
- **Dynamic Prompt Builder**: `/Users/pgermishuys/source/weave/src/agents/dynamic-prompt-builder.ts`

#### Hook System
- **Hook Creation**: `/Users/pgermishuys/source/weave/src/hooks/create-hooks.ts`
- **Start-Work Hook**: `/Users/pgermishuys/source/weave/src/hooks/start-work-hook.ts`
- **Work Continuation Hook**: `/Users/pgermishuys/source/weave/src/hooks/work-continuation.ts`
- **Context Window Monitor**: `/Users/pgermishuys/source/weave/src/hooks/context-window-monitor.ts`
- **Keyword Detector**: `/Users/pgermishuys/source/weave/src/hooks/keyword-detector.ts`
- **Pattern MD-Only Guard**: `/Users/pgermishuys/source/weave/src/hooks/pattern-md-only.ts`
- **Rules Injector**: `/Users/pgermishuys/source/weave/src/hooks/rules-injector.ts`
- **First Message Variant**: `/Users/pgermishuys/source/weave/src/hooks/first-message-variant.ts`
- **Write Existing File Guard**: `/Users/pgermishuys/source/weave/src/hooks/write-existing-file-guard.ts`
- **Verification Reminder**: `/Users/pgermishuys/source/weave/src/hooks/verification-reminder.ts`

#### Commands & Work State
- **Built-in Commands**: `/Users/pgermishuys/source/weave/src/features/builtin-commands/commands.ts`
- **Start-Work Template**: `/Users/pgermishuys/source/weave/src/features/builtin-commands/templates/start-work.ts`
- **Work State Storage**: `/Users/pgermishuys/source/weave/src/features/work-state/storage.ts`
- **Work State Types**: `/Users/pgermishuys/source/weave/src/features/work-state/types.ts`
- **Work State Validation**: `/Users/pgermishuys/source/weave/src/features/work-state/validation.ts`

#### Configuration & Plugin
- **Config Schema**: `/Users/pgermishuys/source/weave/src/config/schema.ts`
- **Config Merge**: `/Users/pgermishuys/source/weave/src/config/merge.ts`
- **Config Handler**: `/Users/pgermishuys/source/weave/src/managers/config-handler.ts`
- **Plugin Interface**: `/Users/pgermishuys/source/weave/src/plugin/plugin-interface.ts`

#### Shared Utilities
- **Agent Display Names**: `/Users/pgermishuys/source/weave/src/shared/agent-display-names.ts`
- **Tool Registry**: `/Users/pgermishuys/source/weave/src/tools/registry.ts`
- **Tool Permissions**: `/Users/pgermishuys/source/weave/src/tools/permissions.ts`

#### Documentation
- **Configuration Reference**: `/Users/pgermishuys/source/weave/docs/configuration.md`
- **Agent Interactions**: `/Users/pgermishuys/source/weave/docs/agent-interactions.md`
- **README**: `/Users/pgermishuys/source/weave/README.md`

---

## Agent System Architecture

### 1. Agent Modes (Determines UI Behavior & Model Selection)

Each agent has a `mode` property that controls how it respects user-selected models:

| Mode | Agents | Behavior | Model Resolution |
|------|--------|----------|------------------|
| **primary** | Loom, Tapestry | Respects user's UI-selected model | UI selection → category model → fallback chain |
| **subagent** | Pattern, Thread, Spindle, Weft, Warp | Ignores UI selection; uses own chain | Config override → category model → agent-specific fallback chain |
| **all** | Shuttle | Available in both contexts | Respects UI when used as primary; uses own chain when used as subagent |

**File**: `/Users/pgermishuys/source/weave/src/agents/types.ts` (lines 4-9)
**Factory Examples**:
- Loom: `createLoomAgent.mode = "primary"` (/src/agents/loom/index.ts:10)
- Pattern: `createPatternAgent.mode = "subagent"` (/src/agents/pattern/index.ts:8)
- Thread: `createThreadAgent.mode = "subagent"` (/src/agents/thread/index.ts:9)

### 2. Agent Definitions & Capabilities

#### Display Names (UI Registration)
**File**: `/Users/pgermishuys/source/weave/src/shared/agent-display-names.ts`

- `loom` → `"Loom (Main Orchestrator)"`
- `tapestry` → `"Tapestry (Execution Orchestrator)"`
- `pattern`, `thread`, `spindle`, `weft`, `warp`, `shuttle` → lowercase (unchanged)

This mapping is used in the config pipeline (Phase 2) to remap agent keys for OpenCode UI registration.

#### Metadata & Triggers
**File**: `/Users/pgermishuys/source/weave/src/agents/builtin-agents.ts` (lines 38-142)

Each agent has metadata defining:
- `category`: exploration, specialist, advisor, utility
- `cost`: FREE, CHEAP, EXPENSIVE
- `triggers`: domain-based delegation rules
- `useWhen`, `avoidWhen`: contextual guidance
- `keyTrigger`: phase 0 quick checks (e.g., Loom's "ultrawork")

**Example (Loom)**:
```typescript
loom: {
  category: "specialist",
  cost: "EXPENSIVE",
  triggers: [
    { domain: "Orchestration", trigger: "Complex multi-step tasks needing full orchestration" },
    { domain: "Architecture", trigger: "System design and high-level planning" },
  ],
  keyTrigger: "**'ultrawork'** → Maximum effort, parallel agents, deep execution",
},
```

#### Tool Permissions
**File**: `/Users/pgermishuys/source/weave/src/agents/agent-interactions.md` (lines 291-301)

```
                 Read  Write  Edit  Task  WebFetch  Glob  Grep  Bash
Loom              ✓     ✓      ✓     ✓      ✓       ✓     ✓     ✓
Tapestry          ✓     ✓      ✓     ✗      ✓       ✓     ✓     ✓
Pattern           ✓    .md*   .md*   ✗      ✓       ✓     ✓     ✓
Thread            ✓     ✗      ✗     ✗      ✓       ✓     ✓     ✓
Spindle           ✓     ✗      ✗     ✗      ✓       ✓     ✓     ✓
Weft              ✓     ✗      ✗     ✗      ✓       ✓     ✓     ✓
Warp              ✓     ✗      ✗     ✗      ✓       ✓     ✓     ✓
Shuttle           ✓     ✓      ✓     ✓      ✓       ✓     ✓     ✓
```

Pattern's tool restrictions enforced by hook:
**File**: `/Users/pgermishuys/source/weave/src/hooks/pattern-md-only.ts` (checks write/edit only allowed for .weave/*.md)

---

## Agent Switching & Control Flow

### 3. How Agents Switch Roles

There are **TWO DISTINCT MECHANISMS** for agent switching:

#### Mechanism A: Subagent Invocation via Task Tool (Default)

**Scenario**: Loom delegates to Pattern, Thread, etc.

```
Loom message
    ↓
Loom calls Task tool: { subagent_type: "pattern", description: "..." }
    ↓
OpenCode spawns Pattern in background
    ↓
Pattern executes, returns results
    ↓
Results appear in Loom's message as tool output
    ↓
User sees Loom still as active agent, Pattern as background subagent
```

**File**: `/Users/pgermishuys/source/weave/src/plugin/plugin-interface.ts` (lines 240-250)

Delegation logging hooks in:
```typescript
if (input.tool === "task" && args) {
  const agentArg = (args.subagent_type as string | undefined) ?? (args.description as string | undefined) ?? "unknown"
  logDelegation({
    phase: "start",
    agent: agentArg,
    sessionId: input.sessionID,
    toolCallId: input.callID,
```

#### Mechanism B: Agent Switch via `/start-work` Command (Explicit)

**Scenario**: User runs `/start-work` to activate Tapestry for plan execution.

```
User: /start-work oauth2-login
    ↓
Command template injected with placeholders ($SESSION_ID, $TIMESTAMP, $ARGUMENTS)
    ↓
Plugin's chat.message hook fires (/src/plugin/plugin-interface.ts:48)
    ↓
start-work-hook detects command and resolves plan
    ↓
Hook returns { switchAgent: "tapestry", contextInjection: "..." }
    ↓
Plugin mutates message.agent = getAgentDisplayName("tapestry") = "Tapestry (Execution Orchestrator)"
    ↓
OpenCode routes message to Tapestry (primary agent) instead of Loom
    ↓
Tapestry executes plan, marks checkboxes, progresses through tasks
    ↓
When done, work state cleared, user is back at Loom
```

**Files**:
- Command Definition: `/Users/pgermishuys/source/weave/src/features/builtin-commands/commands.ts` (lines 5-15)
- Command Template: `/Users/pgermishuys/source/weave/src/features/builtin-commands/templates/start-work.ts`
- Start-Work Hook: `/Users/pgermishuys/source/weave/src/hooks/start-work-hook.ts`
- Agent Switching Logic: `/Users/pgermishuys/source/weave/src/plugin/plugin-interface.ts` (lines 88-104)

**Key Difference from Task tool**:
- `Task` tool → subagent runs in **background** (no message.agent mutation)
- `/start-work` command → **switchAgent field** → message.agent is mutated → OpenCode **routes message to new primary agent**

---

### 4. Slash Commands & /start-work Implementation

**Slash Command Definition** (in builtin-commands):
```typescript
{
  "start-work": {
    name: "start-work",
    description: "Start executing a Weave plan created by Pattern",
    agent: "tapestry",  // ← Tells OpenCode which agent handles this command
    template: `<command-instruction>\n${START_WORK_TEMPLATE}\n</command-instruction>\n<session-context>Session ID: $SESSION_ID  Timestamp: $TIMESTAMP</session-context>\n<user-request>$ARGUMENTS</user-request>`,
    argumentHint: "[plan-name]",
  },
}
```

**Flow**:

1. **User types** `/start-work oauth2-login`

2. **Command routing** (in ConfigHandler):
   - File: `/Users/pgermishuys/source/weave/src/managers/config-handler.ts` (Phase 5, lines 131-139)
   - Command agent key `"tapestry"` is remapped to display name `"Tapestry (Execution Orchestrator)"`
   - OpenCode exposes the command and knows to route it to Tapestry

3. **Hook execution** (chat.message hook):
   - File: `/Users/pgermishuys/source/weave/src/hooks/start-work-hook.ts`
   - Detects command by checking for `<session-context>` marker in prompt
   - Extracts plan name from `<user-request>` tags (lines 89-94)
   - Resolves the plan file from `.weave/plans/`
   - Creates/updates work state at `.weave/state.json`
   - Returns `{ switchAgent: "tapestry", contextInjection: "..." }`

4. **Agent switch** (plugin-interface):
   - File: `/Users/pgermishuys/source/weave/src/plugin/plugin-interface.ts` (lines 88-104)
   - If `switchAgent` is set, mutate `message.agent = getAgentDisplayName(switchAgent)`
   - If `contextInjection` is set, append to prompt parts

5. **Message routing**:
   - OpenCode sees `message.agent = "Tapestry (Execution Orchestrator)"`
   - Routes the message to Tapestry instead of default agent (Loom)
   - Tapestry receives injected context with plan path, progress, and startup instructions

6. **Tapestry execution**:
   - Reads `.weave/state.json` to check if resuming or starting fresh
   - Reads plan file from path in state
   - Finds first unchecked `- [ ]` task
   - Executes task, verifies, marks `- [x]`, repeats
   - On completion, clears work state

---

## Configuration Pipeline & Agent Registration

**File**: `/Users/pgermishuys/source/weave/src/managers/config-handler.ts`

### 6 Phases of Config Pipeline:

```
Phase 1: applyProviderConfig() — no-op in v1

Phase 2: applyAgentConfig(agents)
  - Input: agents = { loom: AgentConfig, pattern: AgentConfig, ... }
  - Merge per-agent overrides from pluginConfig.agents.*
  - Filter out agents in pluginConfig.disabled_agents
  - Remap keys: "loom" → "Loom (Main Orchestrator)", "pattern" → "pattern"
  - Output: result agents with display names as keys

Phase 3: applyToolConfig(toolNames)
  - Filter out tools in pluginConfig.disabled_tools

Phase 4: applyMcpConfig() — empty for v1

Phase 5: applyCommandConfig()
  - Clone BUILTIN_COMMANDS
  - Remap command agent fields: "tapestry" → "Tapestry (Execution Orchestrator)"

Phase 6: applySkillConfig() — no-op in v1

Output applied to OpenCode config:
  - config.agent = result.agents           // Agent registry with display names
  - config.command = result.commands       // Slash command registry
  - config.default_agent = result.defaultAgent  // Default = Loom (Main Orchestrator)
```

---

## Work State & Plan Lifecycle

### Work State Storage
**File**: `/Users/pgermishuys/source/weave/src/features/work-state/types.ts`

```typescript
interface WorkState {
  active_plan: string          // Absolute path to plan file
  started_at: string           // ISO timestamp
  session_ids: string[]        // Sessions that have touched this work
  plan_name: string            // Plan name (from filename)
  agent?: string               // Resume agent ("tapestry")
}

interface PlanProgress {
  total: number                // Total checkboxes
  completed: number            // Checked checkboxes
  isComplete: boolean          // All done?
}
```

### Plan Lifecycle
**File**: `/Users/pgermishuys/source/weave/docs/agent-interactions.md` (lines 236-286)

```
[*] → Created (Pattern writes .md to .weave/plans/)
  → Reviewed (Weft validates, optional)
  → Active (/start-work command)
  → InProgress (Tapestry executes, marks - [ ] → - [x])
  → Paused (session idle)
  → InProgress (resume via /start-work)
  → Complete (all checkboxes marked)
  → Cleared (state.json deleted)
```

---

## Hooks & Request Processing Pipeline

**File**: `/Users/pgermishuys/source/weave/src/hooks/create-hooks.ts`

### Hook Order in chat.message Event:

```
1. firstMessageVariant.shouldApplyVariant(sessionID)
   └─ Applies variant on first message of session

2. processMessageForKeywords()
   └─ Detects "ultrawork" / "ulw" keywords

3. startWork hook
   └─ Detects /start-work command
   └─ Returns { switchAgent, contextInjection }
   └─ Mutates message.agent and parts

4. Tool execution hooks (tool.execute.before)
   ├─ writeGuard.trackRead()
   ├─ patternMdOnly() — blocks Pattern from writing non-.md files outside .weave/
   ├─ rulesInjector() — injects AGENTS.md context if needed
   └─ Tool execution proceeds or is blocked

5. event hooks (session.idle, session.deleted, message.updated)
   ├─ workContinuation.checkContinuation()
   │  └─ If active plan with remaining tasks, inject continuation prompt
   ├─ contextWindowMonitor.checkContextWindow()
   │  └─ Track token usage and warn
   └─ Token state cleanup on session.deleted
```

---

## Visibility & UX Model

### When Loom is Active (Default)

**User sees**:
- Loom as the active agent in the UI
- Loom's chat messages with delegation descriptions
- Todo sidebar created by Loom (via todowrite)
- When Loom calls Task tool → subagent runs in background, no UI agent switch
- Results from subagents appear as tool outputs in Loom's response

**Example**:
```
User: Build an OAuth2 system
  ↓
Loom: I'll explore the auth module first...
      [delegates to Thread via Task tool]
  ↓
Thread (background): Exploring... found 3 files
  ↓
Loom: Thread found auth files. Now asking Pattern for a plan...
      [delegates to Pattern via Task tool]
  ↓
Pattern (background): Creating plan... saved to .weave/plans/oauth2.md
  ↓
Loom: Plan ready. Run /start-work oauth2 to begin.
```

**Sidebar state**: Loom's todos visible throughout

### When Tapestry is Active (After /start-work)

**User sees**:
- **Tapestry replaces Loom** as active agent in the UI
- Tapestry's execution loop messages: "Executing task 1/5...", "Verified ✓", "Completed 3/5"
- Tapestry's todo sidebar (via todowrite)
- Plan progress counter: "3 of 5 tasks complete"

**No streaming chat**:
- Tapestry is **not** a streaming multi-turn conversation agent
- It's an execution orchestrator that reads the plan, executes tasks, and reports progress
- Once all tasks are done, work state is cleared
- Control returns to Loom (default agent)

### When Pattern/Thread/Spindle/Weft Are Subagents (Task Tool)

**User sees**:
- **Background execution** — no UI agent switch
- Tool output showing results (e.g., "Pattern created plan at .weave/plans/...")
- Loom remains the active agent in chat

**Result**: Subagent work is **invisible to the UI** except as tool outputs in Loom's messages

---

## Configuration Merge Strategy

**File**: `/Users/pgermishuys/source/weave/src/config/merge.ts`

### Two-Level Hierarchy

```
~/.config/opencode/weave-opencode.jsonc  (User level, lowest priority)
        ↓ deep merge
.opencode/weave-opencode.jsonc  (Project level, highest priority)
        ↓ merge
Built-in defaults
        ↓
Final config passed to ConfigHandler
```

### Merge Rules

- **Nested objects** (agents, categories): deep merge — project keys override user keys recursively
- **Arrays** (disabled_*): union with deduplication — both sets combined
- **Scalars**: project value wins

### Config Schema Validation

**File**: `/Users/pgermishuys/source/weave/src/config/schema.ts`

Validates:
```typescript
{
  agents?: Record<string, AgentOverrideConfig>
  categories?: Record<string, CategoriesConfig>
  disabled_hooks?: string[]
  disabled_agents?: string[]
  disabled_tools?: string[]
  disabled_skills?: string[]
  background?: { defaultConcurrency: number; ... }
  tmux?: { enabled: boolean; layout: string }
  skills?: { paths: string[]; recursive: boolean }
  experimental?: { plugin_load_timeout_ms: number; ... }
}
```

---

## Summary: Agent Orchestration Model

### Three Levels of Agent Operation

1. **Primary Active Agent** (Loom or Tapestry)
   - Defined by config.default_agent initially (Loom)
   - Can be switched via `/start-work` command → switchAgent field
   - User sees this agent in the UI and chat

2. **Subagents** (Pattern, Thread, Spindle, Weft, Warp, Shuttle)
   - Invoked via Task tool by the active primary agent
   - Run in **background** with own model/config (ignoring UI selection)
   - Results returned as tool outputs
   - Active agent (Loom) remains visible in UI

3. **Special: Shuttle** (all mode)
   - Can be used as primary agent (respects UI model)
   - Can be used as subagent (ignores UI model)
   - Dispatched via category system in Task tool

### Key Differences: Task Tool vs. /start-work Command

| Aspect | Task Tool Delegation | /start-work Command |
|--------|----------------------|-------------------|
| **Triggering Agent** | Loom (or any active primary) | User text input |
| **Target Agent** | Subagent (pattern, thread, etc.) | Tapestry (primary) |
| **UI Agent Switch** | **No** — Loom remains active | **Yes** — message.agent mutated |
| **Visibility** | Background; results as tool output | Foreground; agent switches in UI |
| **Model Selection** | Subagent's own model | Tapestry respects UI selection |
| **Duration** | Single execution | Multi-turn execution loop |

---

## All File Paths Found

### Configuration
- `/Users/pgermishuys/.config/opencode/opencode.json`
- `/Users/pgermishuys/.config/opencode/weave-opencode.jsonc` (expected, not found)
- `/Users/pgermishuys/source/weave/.weave/plans/` (plan storage)

### Core Agent Files
- `/Users/pgermishuys/source/weave/src/agents/builtin-agents.ts`
- `/Users/pgermishuys/source/weave/src/agents/types.ts`
- `/Users/pgermishuys/source/weave/src/agents/model-resolution.ts`
- `/Users/pgermishuys/source/weave/src/agents/agent-builder.ts`
- `/Users/pgermishuys/source/weave/src/agents/dynamic-prompt-builder.ts`
- `/Users/pgermishuys/source/weave/src/agents/loom/index.ts` + `default.ts`
- `/Users/pgermishuys/source/weave/src/agents/tapestry/index.ts` + `default.ts`
- `/Users/pgermishuys/source/weave/src/agents/pattern/index.ts` + `default.ts`
- `/Users/pgermishuys/source/weave/src/agents/thread/index.ts` + `default.ts`
- `/Users/pgermishuys/source/weave/src/agents/spindle/index.ts` + `default.ts`
- `/Users/pgermishuys/source/weave/src/agents/weft/index.ts` + `default.ts`
- `/Users/pgermishuys/source/weave/src/agents/warp/index.ts` + `default.ts`
- `/Users/pgermishuys/source/weave/src/agents/shuttle/index.ts` + `default.ts`

### Hook Files
- `/Users/pgermishuys/source/weave/src/hooks/create-hooks.ts`
- `/Users/pgermishuys/source/weave/src/hooks/start-work-hook.ts`
- `/Users/pgermishuys/source/weave/src/hooks/work-continuation.ts`
- `/Users/pgermishuys/source/weave/src/hooks/context-window-monitor.ts`
- `/Users/pgermishuys/source/weave/src/hooks/keyword-detector.ts`
- `/Users/pgermishuys/source/weave/src/hooks/pattern-md-only.ts`
- `/Users/pgermishuys/source/weave/src/hooks/rules-injector.ts`
- `/Users/pgermishuys/source/weave/src/hooks/first-message-variant.ts`
- `/Users/pgermishuys/source/weave/src/hooks/write-existing-file-guard.ts`
- `/Users/pgermishuys/source/weave/src/hooks/verification-reminder.ts`

### Commands & Work State
- `/Users/pgermishuys/source/weave/src/features/builtin-commands/commands.ts`
- `/Users/pgermishuys/source/weave/src/features/builtin-commands/templates/start-work.ts`
- `/Users/pgermishuys/source/weave/src/features/work-state/storage.ts`
- `/Users/pgermishuys/source/weave/src/features/work-state/types.ts`
- `/Users/pgermishuys/source/weave/src/features/work-state/validation.ts`

### Configuration & Plugin
- `/Users/pgermishuys/source/weave/src/config/schema.ts`
- `/Users/pgermishuys/source/weave/src/config/merge.ts`
- `/Users/pgermishuys/source/weave/src/managers/config-handler.ts`
- `/Users/pgermishuys/source/weave/src/plugin/plugin-interface.ts`

### Shared Utilities
- `/Users/pgermishuys/source/weave/src/shared/agent-display-names.ts`
- `/Users/pgermishuys/source/weave/src/tools/registry.ts`
- `/Users/pgermishuys/source/weave/src/tools/permissions.ts`

### Documentation
- `/Users/pgermishuys/source/weave/docs/configuration.md`
- `/Users/pgermishuys/source/weave/docs/agent-interactions.md`
- `/Users/pgermishuys/source/weave/README.md`

---

## Key Insights

1. **Agent modes** determine UI behavior — not how agents are invoked
2. **Subagent invocation** (Task tool) ≠ **agent switching** (/start-work command)
3. **Plan-execute workflow** uses `/start-work` to explicitly switch from Loom to Tapestry
4. **Work state** (`.weave/state.json`) persists progress and enables resumption
5. **Hooks** intercept every message to detect commands, switch agents, inject context
6. **Display names** are remapped at config-time — OpenCode UI sees "Loom (Main Orchestrator)", not "loom"
7. **Pattern is write-restricted** to `.weave/*.md` only via pattern-md-only hook
8. **Warp is mandatory for security** changes; Loom's prompt includes security rules
