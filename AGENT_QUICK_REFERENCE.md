# Weave Agent Orchestration — Quick Reference

## The 8 Agents at a Glance

| Agent | Role | Mode | Tools | Key Files |
|-------|------|------|-------|-----------|
| **Loom** | Main Orchestrator | primary | All | `loom/default.ts` |
| **Tapestry** | Execution Engine | primary | All except Task | `tapestry/default.ts` |
| **Pattern** | Strategic Planner | subagent | Read + .weave/*.md write | `pattern/default.ts` |
| **Thread** | Code Explorer | subagent | Read-only | `thread/default.ts` |
| **Spindle** | External Researcher | subagent | Read-only | `spindle/default.ts` |
| **Weft** | Reviewer | subagent | Read-only | `weft/default.ts` |
| **Warp** | Security Auditor | subagent | Read-only | `warp/default.ts` |
| **Shuttle** | Category Specialist | all | All | `shuttle/default.ts` |

---

## Agent Invocation Mechanisms

### Mechanism 1: Task Tool (Subagent Delegation)

```
Active Agent (Loom)
    ↓
calls Task tool → { subagent_type: "pattern" }
    ↓
Pattern executes in BACKGROUND
    ↓
Results appear as tool output
    ↓
Loom remains visible in UI
```

**When**: Loom needs exploration (Thread), planning (Pattern), review (Weft), research (Spindle)
**Files**: 
- Plugin detection: `plugin-interface.ts:240-250`
- Tool invocation logging: `logDelegation()` call

### Mechanism 2: /start-work Command (Agent Switch)

```
User: /start-work oauth2-login
    ↓
start-work-hook detects command
    ↓
Resolves plan file from .weave/plans/oauth2-login.md
    ↓
Creates .weave/state.json
    ↓
Returns { switchAgent: "tapestry" }
    ↓
Plugin mutates: message.agent = "Tapestry (Execution Orchestrator)"
    ↓
OpenCode routes to TAPESTRY (primary agent)
    ↓
Tapestry becomes visible in UI, executes plan
```

**When**: Ready to execute a plan
**Files**:
- Command definition: `builtin-commands/commands.ts:5-15`
- Command template: `builtin-commands/templates/start-work.ts`
- Hook logic: `hooks/start-work-hook.ts`
- Agent switch: `plugin-interface.ts:88-104`

---

## Agent Display Names (UI Mapping)

```typescript
loom           → "Loom (Main Orchestrator)"
tapestry       → "Tapestry (Execution Orchestrator)"
pattern        → "pattern"                    // Lowercase in UI
thread         → "thread"
spindle        → "spindle"
weft           → "weft"
warp           → "warp"
shuttle        → "shuttle"
```

**File**: `shared/agent-display-names.ts`

---

## Agent Modes & Model Selection

### Primary Agents (Loom, Tapestry)
- Respect **user-selected model** from OpenCode UI
- If user picks GPT-5, both Loom & Tapestry use GPT-5
- Can override via config: `agents.loom.model = "anthropic/claude-opus-4"`

### Subagents (Pattern, Thread, Spindle, Weft, Warp)
- **Ignore** user UI selection (deterministic behavior)
- Use **config override** → **category model** → **fallback chain**
- Each agent has own fallback: anthropic → openai → google → …
- File: `agents/model-resolution.ts`

### Shuttle (All Mode)
- Switches behavior based on context
- As primary: respects UI selection
- As subagent: uses own model chain

---

## Configuration Pipeline (6 Phases)

```
Input: pluginConfig (merged .opencode/ + ~/.config/opencode/ + defaults)
    ↓
Phase 1: Provider Config (no-op v1)
Phase 2: Agent Config
    - Merge overrides from pluginConfig.agents.*
    - Filter disabled_agents
    - Remap keys: "loom" → "Loom (Main Orchestrator)"
    → output: agents with display names as keys
Phase 3: Tool Config
    - Filter disabled_tools
Phase 4: MCP Config (empty v1)
Phase 5: Command Config
    - Remap command agents: "tapestry" → "Tapestry (Execution Orchestrator)"
Phase 6: Skill Config (no-op v1)
    ↓
Output: { agents, defaultAgent, tools, mcps, commands }
    ↓
Applied to OpenCode config:
  config.agent = agents
  config.command = commands
  config.default_agent = "Loom (Main Orchestrator)"
```

**File**: `managers/config-handler.ts`

---

## Work State Lifecycle

```
User: /start-work oauth2
    ↓
start-work-hook.handleStartWork()
    ↓
findPlans(".weave/plans/")
    ↓
Match: .weave/plans/oauth2.md found
    ↓
createWorkState(planPath, sessionId, agent="tapestry")
    ↓
writeWorkState(directory, state)
    ↓ state.json created
{
  active_plan: "/absolute/path/to/.weave/plans/oauth2.md",
  started_at: "2025-02-26T12:34:56Z",
  session_ids: ["sess_abc123"],
  plan_name: "oauth2",
  agent: "tapestry"
}
    ↓
Tapestry executes:
  - Read first unchecked - [ ] task
  - Execute (write code, run tests)
  - Mark - [x]
  - Repeat
    ↓
getPlanProgress(planPath)
    - Count [ ] → total
    - Count [x] → completed
    - isComplete = (completed === total)
    ↓
On completion:
  clearWorkState(directory)
  state.json deleted
  Control returns to Loom
```

**Files**: `features/work-state/storage.ts`, `types.ts`

---

## Hook Execution Order (Per Message)

```
chat.message hook fires
    ↓
1. firstMessageVariant.shouldApplyVariant(sessionID)
   └─ Applies prompt variant on first message
    ↓
2. processMessageForKeywords()
   └─ Detects "ultrawork" / "ulw"
    ↓
3. startWork hook ← AGENT SWITCH HAPPENS HERE
   - Detects: <session-context> marker
   - Extracts plan name from <user-request>
   - Resolves plan file
   - Creates/updates .weave/state.json
   - Returns { switchAgent: "tapestry", contextInjection: "..." }
   - Plugin mutates message.agent
    ↓
4. Tool execution hooks (tool.execute.before)
   ├─ writeGuard.trackRead()
   ├─ patternMdOnly() — blocks non-.md files outside .weave/
   ├─ rulesInjector() — injects AGENTS.md
   └─ Tool proceeds or blocks
    ↓
5. Event hooks
   ├─ session.idle → workContinuation.checkContinuation()
   ├─ session.deleted → token cleanup
   └─ message.updated → contextWindowMonitor.checkContextWindow()
```

**File**: `hooks/create-hooks.ts`

---

## Permission Matrix

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

✓ = allowed    ✗ = denied    * = .weave/*.md only
```

**Enforcement**: `hooks/pattern-md-only.ts` (blocks Pattern writes outside .weave/*.md)

---

## Key Files by Function

### Agent Definition
- `/src/agents/builtin-agents.ts` — AGENT_FACTORIES, AGENT_METADATA
- `/src/agents/types.ts` — AgentMode, AgentFactory, WeaveAgentName
- `/src/agents/{agent}/index.ts` — Factory with mode property
- `/src/agents/{agent}/default.ts` — Prompt and config

### Agent Switching
- `/src/plugin/plugin-interface.ts` — message.agent mutation (lines 88-104)
- `/src/hooks/start-work-hook.ts` — Command detection & plan resolution
- `/src/features/builtin-commands/commands.ts` — /start-work definition

### Configuration
- `/src/config/schema.ts` — Zod validation
- `/src/config/merge.ts` — Two-level merge logic
- `/src/managers/config-handler.ts` — 6-phase pipeline
- `/src/shared/agent-display-names.ts` — Key remapping

### Work State
- `/src/features/work-state/storage.ts` — Read/write .weave/state.json
- `/src/features/work-state/types.ts` — WorkState, PlanProgress
- `/src/features/work-state/validation.ts` — Plan structure validation

### Tool Restrictions
- `/src/tools/permissions.ts` — Tool allow/deny per agent
- `/src/tools/registry.ts` — Tool definitions
- `/src/hooks/pattern-md-only.ts` — Pattern write guard

### Documentation
- `/docs/configuration.md` — Full schema reference
- `/docs/agent-interactions.md` — Workflow diagrams & state machines
- `/README.md` — High-level overview

---

## Config Example

```jsonc
// .opencode/weave-opencode.jsonc

{
  // Override specific agent models
  "agents": {
    "loom": { 
      "model": "anthropic/claude-opus-4", 
      "temperature": 0.1 
    },
    "pattern": {
      "model": "openai/gpt-4o",
      "temperature": 0.3
    }
  },

  // Define domain-specific model groups
  "categories": {
    "frontend": {
      "model": "google/gemini-2-pro",
      "temperature": 0.5
    },
    "security": {
      "model": "anthropic/claude-opus-4",
      "temperature": 0.0
    }
  },

  // Disable features
  "disabled_agents": ["spindle"],
  "disabled_hooks": ["context-window-monitor"],
  "disabled_tools": ["webfetch"],

  // Concurrency limits for background agents
  "background": {
    "defaultConcurrency": 3,
    "providerConcurrency": {
      "anthropic": 5,
      "openai": 3
    }
  }
}
```

---

## Common Questions

### Q: How do I activate a different agent?
**A**: Two ways:
- **Task tool** (Loom calling Pattern): `Task(subagent_type: "pattern", ...)`
- **Slash command** (/start-work): User types `/start-work plan-name` → switches to Tapestry

### Q: Why doesn't my UI-selected model apply to Pattern?
**A**: Pattern is a `subagent` mode agent. Subagents ignore UI selection for deterministic behavior. Override via config:
```json
{ "agents": { "pattern": { "model": "openai/gpt-4o" } } }
```

### Q: Where does Pattern save plans?
**A**: `.weave/plans/{kebab-case-name}.md`. Pattern is restricted by hook to ONLY write `.weave/*.md` files.

### Q: What is .weave/state.json?
**A**: Work state file created by `/start-work` to track progress. Stores active plan path, progress, and session IDs. Enables resumption on session restart.

### Q: Can Tapestry call subagents?
**A**: **No**. Tapestry `mode: "primary"` and `tools.task = false` (disabled). It only executes plans directly.

### Q: How does work resume?
**A**: 
1. User runs `/start-work` again
2. start-work-hook reads existing `.weave/state.json`
3. getPlanProgress() counts checked/unchecked tasks
4. If incomplete, creates resume context: "Resuming from first unchecked task"
5. Appends session ID to state
6. Tapestry finds first `- [ ]` task and continues

---

## Visual: Plan Execution Flow

```
Plan Creation
├─ Loom delegates to Pattern
├─ Pattern researches codebase
└─ Pattern writes .weave/plans/oauth2.md
     └─ - [ ] Task 1: Setup routes
     └─ - [ ] Task 2: Add OAuth callback
     └─ - [ ] Task 3: Write tests

Plan Review (Optional)
├─ Loom delegates to Weft
└─ Weft validates plan references

Plan Execution
├─ User: /start-work oauth2
├─ start-work-hook creates .weave/state.json
├─ Plugin switches to Tapestry (UI agent changes)
└─ Tapestry loop:
     ├─ Read first unchecked - [ ]
     ├─ Execute
     ├─ Verify
     ├─ Mark - [x]
     └─ Repeat for all tasks

Plan Complete
├─ All tasks checked - [x]
├─ clearWorkState() deletes .weave/state.json
└─ Control returns to Loom (default agent)
```

