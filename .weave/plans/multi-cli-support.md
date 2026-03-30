# Multi-CLI Support: Adapter Architecture for OpenCode, Claude Code & Copilot CLI

## TL;DR
> **Summary**: Refactor Weave from an OpenCode-only plugin into a CLI-agnostic core with adapter modules, enabling the same 8-agent system, hooks, workflows, and analytics to work across OpenCode, Claude Code (via a native plugin), and GitHub Copilot CLI. The Claude Code adapter is now a **full plugin** (`weave-claude-plugin/`) that leverages Claude Code's plugin system — subagents, skills, hooks.json, and settings.json — rather than the original shell-hook + SKILL.md approach.
> **Estimated Effort**: XL

## Context

### Original Request
Design the architecture for making Weave support multiple AI coding CLIs — OpenCode (current), Claude Code, and GitHub Copilot CLI — via an adapter pattern that normalizes each CLI's extension surface while preserving Weave's full feature set where possible.

### Key Findings

**Current coupling points to `@opencode-ai/plugin`:**
- `src/index.ts` — Exports a `Plugin` type from `@opencode-ai/plugin` (line 1, 11)
- `src/plugin/types.ts` — Types derived from `Plugin` and `ToolDefinition` from `@opencode-ai/plugin` (lines 1-21)
- `src/plugin/plugin-interface.ts` — 651-line monolith that maps ALL Weave functionality to OpenCode's 8 hook points: `tool`, `config`, `chat.message`, `chat.params`, `chat.headers`, `event`, `tool.execute.before`, `tool.execute.after`, `command.execute.before`
- `src/create-managers.ts` — Uses `PluginInput` from `@opencode-ai/plugin` (line 1)
- `src/create-tools.ts` — Uses `PluginInput` from `@opencode-ai/plugin` (line 1)
- `src/config/loader.ts` — Hardcoded paths: `~/.config/opencode/weave-opencode.json`, `{dir}/.opencode/weave-opencode.json`
- `src/features/skill-loader/loader.ts` — Hardcoded paths: `~/.config/opencode/skills/`, `{dir}/.opencode/skills/`; also calls `fetchSkillsFromOpenCode(serverUrl, directory)` where `serverUrl` comes from OpenCode's `PluginInput` (non-OpenCode CLIs have no equivalent server URL)
- `src/features/workflow/constants.ts` — Likely hardcoded `.opencode/workflows/` path
- `src/shared/agent-display-names.ts` — Display names formatted for OpenCode UI
- `src/features/builtin-commands/commands.ts` — Commands assume OpenCode slash-command system

**Files importing `AgentConfig` from `@opencode-ai/sdk` (26 files — ALL must be updated in Phase 0):**

Core agent system:
- `src/agents/types.ts` — `AgentFactory`, `AgentSource`, `AgentOverrideConfig` all reference `AgentConfig`
- `src/agents/builtin-agents.ts` — `createBuiltinAgents()` returns `Record<string, AgentConfig>`
- `src/agents/agent-builder.ts` — `buildAgent()` returns `AgentConfig`, defines `AgentConfigExtended`
- `src/agents/custom-agent-factory.ts` — `buildCustomAgentConfig()` returns `AgentConfig`

Agent factory files (each imports `AgentConfig` and returns it from factory):
- `src/agents/loom/index.ts`, `src/agents/loom/default.ts`
- `src/agents/tapestry/index.ts`, `src/agents/tapestry/default.ts`
- `src/agents/pattern/index.ts`, `src/agents/pattern/default.ts`
- `src/agents/thread/index.ts`, `src/agents/thread/default.ts`
- `src/agents/spindle/index.ts`, `src/agents/spindle/default.ts`
- `src/agents/weft/index.ts`, `src/agents/weft/default.ts`
- `src/agents/warp/index.ts`, `src/agents/warp/default.ts`
- `src/agents/shuttle/index.ts`, `src/agents/shuttle/default.ts`

Manager/plugin files:
- `src/create-managers.ts` — `agents: Record<string, AgentConfig>` parameter
- `src/managers/config-handler.ts` — `agents?: Record<string, AgentConfig>` parameter
- `src/plugin/plugin-interface.ts` — `agents: Record<string, AgentConfig>` in state

Test files (will need updated imports):
- `src/agents/agent-builder.test.ts`
- `src/agents/types.test.ts`
- `src/managers/config-handler.test.ts`
- `src/agents/custom-agent-factory.test.ts`

Reference-only (comment, no import):
- `src/tools/permissions.ts` — JSDoc comment references `AgentConfig.tools` shape

**CLI-agnostic core (already isolated):**
- `src/hooks/` — All hook logic is pure functions (context-window-monitor, write-guards, pattern-md-only, rules-injector, keyword-detector, work-continuation, verification-reminder, start-work-hook)
- `src/features/work-state/` — File-based state at `.weave/state.json` (no OpenCode dependency)
- `src/features/workflow/` — Workflow engine, templates, step management (file-based)
- `src/features/analytics/` — Session tracking, fingerprinting, token reports (file-based)
- `src/agents/` defaults — Pure prompt strings and config objects (only the `AgentConfig` type from SDK)
- `src/config/schema.ts` — Zod schema for `weave.json` (CLI-agnostic already)
- `src/tools/permissions.ts` — Tool permission maps (generic)

**Key architectural insight**: The `src/plugin/plugin-interface.ts` file is the single "adapter" that translates between Weave's internal concepts and OpenCode's plugin hooks. The refactoring strategy is to:
1. Extract a CLI-agnostic `WeaveCore` from the shared logic
2. Keep `plugin-interface.ts` as the OpenCode adapter
3. Build parallel adapters for Claude Code (as a native plugin) and Copilot CLI

---

## Objectives

### Core Objective
Enable Weave to function as a multi-CLI agent system where the same agent definitions, hooks, workflows, analytics, and work-state tracking work across OpenCode, Claude Code, and GitHub Copilot CLI, with graceful degradation where CLIs have fewer capabilities.

### Deliverables
- [ ] `WeaveCore` — CLI-agnostic core module containing all shared logic
- [ ] `CLIAdapter` interface — Abstract contract each CLI adapter must implement
- [ ] `OpenCodeAdapter` — Refactored from current `plugin-interface.ts` (no behavior change)
- [ ] `ClaudeCodeAdapter` — Plugin-based adapter; outputs the `weave-claude-plugin/` directory
- [ ] `CopilotCLIAdapter` — Markdown-agent + MCP-based adapter for Copilot CLI (future work)
- [ ] `CLIDetector` — Auto-detect which CLI is running and select the right adapter
- [ ] `ConfigGenerator` — `weave init` command that generates per-CLI config files / plugin directories
- [ ] Multi-CLI coexistence — Multiple CLI configs can exist simultaneously in a project
- [ ] **Integration test harness** — Shared utilities for testing adapters + per-adapter integration tests
- [ ] **CLI smoke test suite** — End-to-end tests using real CLIs (gated behind `RUN_SMOKE_TESTS=true`)

### Definition of Done
- [ ] `bun test` passes with all existing tests + new adapter tests
- [ ] `bun run typecheck` passes
- [ ] OpenCode behavior is identical to current (zero regression)
- [ ] Claude Code plugin directory structure is valid and passes structural validation
- [ ] Claude Code subagent `.md` files have valid YAML frontmatter
- [ ] Claude Code `hooks/hooks.json` passes JSON parse + structural validation (hook names, matchers)
- [ ] Claude Code hook scripts (in `hooks/`) pass stdin/stdout integration tests (allow/block decisions, JSON protocol)
- [ ] Copilot CLI adapter generates valid `.github/agents/` markdown files
- [ ] Copilot MCP server passes in-process integration tests (`tools/list`, `tools/call`)
- [ ] All generated config files pass structural validation tests (JSON parse, frontmatter parse)
- [ ] A single `weave.json` config drives all three CLIs
- [ ] Smoke tests pass with real CLIs when `RUN_SMOKE_TESTS=true` (optional for CI)

### Guardrails (Must NOT)
- Must NOT break any existing OpenCode functionality
- Must NOT require OpenCode users to change their config
- Must NOT add `@opencode-ai/plugin` or `@opencode-ai/sdk` as dependencies of the core module
- Must NOT duplicate agent prompt definitions across adapters
- Must NOT create adapter-specific agent prompts (prompts are shared, delivery mechanism differs)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                       weave.json                            │
│              (single config, CLI-agnostic)                  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │  WeaveCore  │
                    │             │
                    │ • Agents    │   ← Agent definitions (prompts, metadata, permissions)
                    │ • Hooks     │   ← Hook logic (pure functions)
                    │ • WorkState │   ← Plan execution tracking (.weave/state.json)
                    │ • Workflows │   ← Multi-step workflow engine
                    │ • Analytics │   ← Session tracking, token reports
                    │ • Skills    │   ← Skill loading and resolution
                    │ • Commands  │   ← Command definitions (CLI-agnostic)
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
     ┌────────▼──┐  ┌─────▼──────┐  ┌──▼──────────┐
     │  OpenCode │  │ Claude     │  │  Copilot    │
     │  Adapter  │  │ Code       │  │  CLI        │
     │           │  │ Adapter    │  │  Adapter    │
     │ In-proc   │  │ Native     │  │ Markdown    │
     │ JS plugin │  │ plugin dir │  │ agents +    │
     │           │  │ (subagents │  │ MCP server  │
     │           │  │ + skills   │  │             │
     │           │  │ + hooks)   │  │             │
     └─────┬─────┘  └─────┬──────┘  └──────┬──────┘
           │              │               │
     ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐
     │ OpenCode  │  │  Claude   │  │ Copilot   │
     │   CLI     │  │   Code    │  │   CLI     │
     └───────────┘  └───────────┘  └───────────┘

  Config Generation (weave init):

     ┌──────────────────────────────────────────────────────┐
     │                    ConfigGenerator                    │
     │                                                      │
     │  OpenCode → opencode.json (plugin entry)             │
     │  Claude   → weave-claude-plugin/ (plugin dir)        │
     │              ├── .claude-plugin/plugin.json          │
     │              ├── agents/*.md  (8 subagents)          │
     │              ├── skills/*/SKILL.md (commands)        │
     │              ├── hooks/hooks.json + *.mjs scripts    │
     │              ├── settings.json                       │
     │              └── CLAUDE.md                          │
     │  Copilot  → .github/agents/ (*.md)                  │
     │              + .github/copilot-instructions.md       │
     └──────────────────────────────────────────────────────┘
```

---

## Core Interface Definitions

### 1. WeaveCore — CLI-Agnostic Kernel

```typescript
// src/core/types.ts

/** CLI-agnostic agent definition (mirrors @opencode-ai/sdk AgentConfig without importing it) */
export interface WeaveAgentDefinition {
  name: string
  displayName: string
  description?: string
  prompt?: string
  model?: string
  /** Default model variant for this agent */
  variant?: string
  mode?: "primary" | "subagent" | "all"
  temperature?: number
  top_p?: number
  /** Maximum agentic iterations before forcing text-only response */
  steps?: number
  /** @deprecated Use 'steps' field instead */
  maxSteps?: number
  /** @deprecated Use 'permission' field instead */
  tools?: Record<string, boolean>
  /** Whether this agent is disabled */
  disable?: boolean
  /** Hide from @ autocomplete (subagent only) */
  hidden?: boolean
  /** Hex color code or theme color */
  color?: string
  /** Arbitrary agent-specific options */
  options?: Record<string, unknown>
  /** Per-tool permission rules (replaces deprecated 'tools' map) */
  permission?: WeavePermissionConfig
  metadata: AgentPromptMetadata    // from current types.ts
}

/** CLI-agnostic permission config (mirrors @opencode-ai/sdk PermissionConfig) */
export type WeavePermissionConfig = {
  read?: WeavePermissionRuleConfig
  edit?: WeavePermissionRuleConfig
  glob?: WeavePermissionRuleConfig
  grep?: WeavePermissionRuleConfig
  list?: WeavePermissionRuleConfig
  bash?: WeavePermissionRuleConfig
  task?: WeavePermissionRuleConfig
  external_directory?: WeavePermissionRuleConfig
  [key: string]: WeavePermissionRuleConfig | WeavePermissionActionConfig | undefined
} | WeavePermissionActionConfig

export type WeavePermissionRuleConfig = /* ... rule config ... */
export type WeavePermissionActionConfig = /* ... action config ... */

/** CLI-agnostic command definition */
export interface WeaveCommandDefinition {
  name: string
  description: string
  agent: string           // agent config key (e.g., "tapestry")
  template: string        // prompt template with $SESSION_ID, $TIMESTAMP, $ARGUMENTS
  argumentHint?: string
}

/** CLI-agnostic hook event types (Weave's internal event model) */
export type WeaveHookEvent =
  | "message.before"        // user message about to be sent
  | "message.after"         // assistant response received
  | "tool.before"           // tool about to execute
  | "tool.after"            // tool finished executing
  | "session.idle"          // session went idle (maps to Stop in Claude Code)
  | "session.created"       // new session started
  | "session.deleted"       // session ended
  | "config.init"           // config phase (register agents, commands)
  | "command.execute"       // slash command invoked
  | "params.resolve"        // chat params being resolved (model, limits)
  | "pre.compaction"        // context window compaction about to begin (Claude Code: PreCompact)
  | "post.compaction"       // context window compaction completed (Claude Code: PostCompact)

/** Core initialization result */
export interface WeaveCoreInstance {
  agents: Record<string, WeaveAgentDefinition>
  hooks: CreatedHooks     // from current create-hooks.ts
  commands: Record<string, WeaveCommandDefinition>
  config: WeaveConfig
  analytics: Analytics | null
  directory: string

  // Core operations (CLI-agnostic)
  handleStartWork(promptText: string, sessionId: string): StartWorkResult
  handleWorkflowStart(promptText: string, sessionId: string): WorkflowHookResult
  handleWorkContinuation(sessionId: string): ContinuationResult
  handleWorkflowContinuation(sessionId: string, lastAssistant?: string, lastUser?: string): WorkflowContinuationResult
  checkToolBefore(agentName: string, toolName: string, filePath: string, sessionId: string): ToolCheckResult
  checkToolAfter(toolName: string, sessionId: string, callId: string): void
  handleSessionIdle(sessionId: string): IdleAction
  handlePreCompact(sessionId: string): PreCompactResult   // snapshot todos
  handlePostCompact(sessionId: string): PostCompactResult // restore todos + re-orientation context
  getAgentDisplayName(configKey: string): string
  resolveSkills(names: string[], disabled?: Set<string>): string
  /** Returns true if the given agent name should drive the work-continuation loop.
   *  Currently: only Tapestry. Lives in core so adapter hook scripts don't hardcode "tapestry". */
  isContinuationAgent(agentName: string): boolean
}
```

### 2. CLIAdapter Interface

```typescript
// src/adapters/types.ts

/** Capability flags — what a CLI can and cannot do */
export interface CLICapabilities {
  /** In-process plugin hooks (OpenCode only) */
  inProcessHooks: boolean
  /** Shell command hooks (Claude Code) */
  shellHooks: boolean
  /** Custom agent registration mechanism */
  agentRegistration: "plugin-config" | "plugin-subagents" | "markdown-files" | "none"
  /** Slash commands */
  slashCommands: boolean
  /** Session management API */
  sessionAPI: boolean
  /** Programmatic prompt injection */
  promptInjection: boolean
  /** MCP server support */
  mcpSupport: boolean
  /** Tool permission enforcement */
  toolPermissions: boolean
  /** Idle loop / continuation */
  idleLoop: boolean
  /** Primary continuation mechanism */
  continuationStrategy: "prompt-async" | "stop-hook-exit2" | "autopilot-mode" | "none"
  /** Fleet orchestration (parallel agents) */
  fleetOrchestration: "native" | "mcp-based" | "none"
  /** Todo/sidebar integration */
  todoIntegration: boolean
  /** Dedicated pre/post compaction hooks */
  compactionHooks: boolean
  /** Plugin packaging support */
  pluginSystem: boolean
}

/** Result of adapter initialization */
export interface AdapterInitResult {
  /** Generated config files (path → content) */
  generatedFiles: Map<string, string>
  /** Warnings about features that won't work */
  warnings: string[]
}

/** Abstract CLI adapter */
export interface CLIAdapter {
  /** Human-readable CLI name */
  readonly name: string
  /** CLI identifier for config/detection */
  readonly id: "opencode" | "claude-code" | "copilot-cli"
  /** Capability flags */
  readonly capabilities: CLICapabilities

  /** Initialize the adapter with core instance */
  init(core: WeaveCoreInstance): Promise<AdapterInitResult>

  /** Generate CLI-specific config files */
  generateConfig(core: WeaveCoreInstance, outputDir: string): Promise<GeneratedConfig>

  /** Map a Weave agent to this CLI's agent format */
  mapAgent(agent: WeaveAgentDefinition): CLIAgentManifest

  /** Map a Weave hook to this CLI's hook mechanism.
   *  MUST be an exhaustive switch over WeaveHookEvent — a compile error if a new
   *  event is added to WeaveHookEvent but not handled here. Return null for
   *  events the CLI cannot support (adapter will emit a degradation warning). */
  mapHook(event: WeaveHookEvent): CLIHookManifest | null

  /** Map a Weave command to this CLI's command mechanism.
   *  Derives the skill/command body from WeaveCommandDefinition.template at
   *  generation time — do NOT hardcode command content; read it from the template. */
  mapCommand(command: WeaveCommandDefinition): CLICommandManifest | null

  /** Feature degradation report */
  getDegradationReport(): FeatureDegradation[]
}

export interface GeneratedConfig {
  files: Array<{ path: string; content: string; description: string }>
  instructions: string[]   // human-readable setup instructions
}

export interface CLIAgentManifest {
  /** How the agent is registered in this CLI */
  type: "plugin-agent" | "plugin-subagent" | "markdown-agent" | "system-prompt"
  /** Content for the registration (config object, markdown, etc.) */
  content: string | Record<string, unknown>
  /** File path where this agent's config lives (if file-based) */
  filePath?: string
}

export interface CLIHookManifest {
  /** How the hook is delivered */
  type: "in-process" | "shell-command" | "mcp-tool" | "unsupported"
  /** Hook name in the CLI's native format */
  nativeName?: string
  /** Shell command (for Claude Code) */
  command?: string
  /** MCP tool definition (for Copilot) */
  mcpTool?: Record<string, unknown>
}

export interface CLICommandManifest {
  type: "slash-command" | "skill-file" | "natural-language" | "mcp-tool" | "unsupported"
  nativeName?: string
  content?: string
}

export interface FeatureDegradation {
  feature: string
  status: "full" | "partial" | "unavailable"
  reason: string
  workaround?: string
}
```

### 3. CLI Detection

```typescript
// src/adapters/detect.ts

export interface CLIDetection {
  cli: "opencode" | "claude-code" | "copilot-cli" | "unknown"
  confidence: "high" | "medium" | "low"
  evidence: string[]
}

/**
 * Detection strategy (checked in order):
 * 1. WEAVE_CLI env var (explicit override)
 * 2. Process parent detection (OPENCODE_*, CLAUDE_*, GITHUB_COPILOT_*)
 * 3. Plugin env vars: CLAUDE_PLUGIN_ROOT, CLAUDE_PLUGIN_DATA (definitive for Claude Code plugin)
 * 4. Config file presence (.opencode/, weave-claude-plugin/, .github/copilot-instructions.md)
 * 5. SDK availability (can import @opencode-ai/plugin?)
 */
export function detectCLI(directory: string): CLIDetection
```

---

## Lifecycle Architecture

A critical architectural insight that simplifies the entire design: **static agent identity and dynamic runtime behavior are completely separate concerns**. No drift is possible between them.

### Two Completely Separate Concerns

```
Static (generated at weave init)        Runtime (hook scripts → WeaveCore)
────────────────────────────────        ──────────────────────────────────
agents/loom.md                          hooks/check-continuation.mjs
agents/tapestry.md                      hooks/user-prompt-submit.mjs
agents/pattern.md                       hooks/pre-tool-use.mjs
agents/thread.md                        hooks/post-tool-use.mjs
agents/weft.md                          hooks/on-stop.mjs
skills/start-work/SKILL.md              hooks/session-start.mjs
settings.json                           hooks/pre-compact.mjs
CLAUDE.md                               hooks/post-compact.mjs
```

**Left side**: Regenerated when `weave.json` changes (same cadence as config changes). A `weave.json` edit requires a plugin restart in Claude Code (identical to OpenCode).

**Right side**: Always reads live state from WeaveCore at runtime. No drift possible — these scripts call `createWeaveCore(process.cwd())` on every invocation and read current disk state.

### Why This Matters

All 14 prompt mutation points that compose system prompts run at **config/init time only**. They are driven by:
- `disabledAgents` from `weave.json`
- `customAgents` from `weave.json`
- `ProjectFingerprint` (OS, stack, language)
- `skills` files on disk
- `agentOverrides` (prompt_append, temperature)

None of these change mid-session. Therefore, static `.md` subagent files generated at `weave init` time are a **complete and accurate representation** of agent identity for the lifetime of that session.

Runtime mutations (continuation prompts, start-work injection, workflow steps, compaction recovery, auto-pause, template vars) are handled entirely by hook scripts that call into WeaveCore and read state from disk. They never touch the agent `.md` files. **No prompt staleness is possible**: the static files and the runtime hooks serve different purposes and neither can go stale relative to the other.

### Full Mutation Lifecycle Table

| Lifecycle Moment | Count | Examples | Handled By |
|---|---|---|---|
| Config time (plugin init) | 14 | Loom/Tapestry prompt composition, skill loading, agent overrides, disabled agent stripping | Static `.md` files (regenerated at `weave init`) |
| Per-command | 7 | /start-work injection, /run-workflow, template var substitution | Hook scripts → WeaveCore |
| Per-message | 2 active | Auto-pause, keyword detection | Hook scripts → WeaveCore |
| On-idle | 4 | Work continuation, workflow continuation, todo enforcer | Hook scripts → WeaveCore |
| Per-step-advance | 4 | Workflow step prompt, context header, delegation, template resolution | Hook scripts → WeaveCore |
| On-compaction | 1 | Todo preserver | Hook scripts → WeaveCore |
| Per message.updated | 3 | Context window monitor (logged only), token tracking | Hook scripts → WeaveCore |

### Regeneration Cadence

`weave init --cli claude-code` needs to be re-run **only when `weave.json` changes** — which is the same event that would trigger a plugin restart in OpenCode anyway. There is no background sync needed, no staleness detection needed, no freshness checks needed.

| Trigger | Action Required |
|---|---|
| `weave.json` changes (agent added/disabled/overridden) | Re-run `weave init --cli claude-code`, then reinstall plugin |
| Session starts | Hook scripts auto-read live WeaveCore state — no action needed |
| Plan state changes mid-session | Hook scripts auto-read live `.weave/state.json` — no action needed |
| New task starts | Hook scripts auto-read live state — no action needed |

---

## Per-CLI Adapter Design

### A. OpenCode Adapter (Refactored Current)

**File**: `src/adapters/opencode/index.ts`

This is a thin wrapper around the current `plugin-interface.ts`. The refactoring extracts shared logic into `WeaveCore` and keeps only OpenCode-specific wiring here. **No behavior change for existing OpenCode users.**

**What stays in the OpenCode adapter:**
- The `Plugin` type export and OpenCode's hook signature matching
- `config` hook → registers agents with display names, slash commands
- `chat.message` → OpenCode-specific message mutation (parts array, message.agent)
- `chat.params` → OpenCode-specific model limit capture
- `event` → OpenCode-specific event routing (session.created/deleted, message.updated, message.part.updated, tui.command.execute, session.idle)
- `tool.execute.before/after` → OpenCode's tool hook signature
- `command.execute.before` → OpenCode's command hook
- `client.session.promptAsync()` calls for continuation injection

**What moves to `WeaveCore`:**
- `handleStartWork()` logic (already in `start-work-hook.ts`)
- `handleWorkflowStart()` logic (already in `hook.ts`)
- Work continuation logic (already in `work-continuation.ts`)
- Context window monitoring (already in `context-window-monitor.ts`)
- Write guard tracking (already in `write-existing-file-guard.ts`)
- Pattern MD-only guard (already in `pattern-md-only.ts`)
- Analytics tracking (already in `session-tracker.ts`)
- Todo finalization logic (currently inline in plugin-interface.ts → extract)

**Import dependencies:**
- `@opencode-ai/plugin` — ONLY imported in this adapter
- `@opencode-ai/sdk` — ONLY imported in this adapter (for `AgentConfig` type)

---

### B. Claude Code Adapter — Plugin Architecture

**File**: `src/adapters/claude-code/index.ts`

**MAJOR CHANGE from original plan**: Instead of generating loose hook scripts into `.claude/hooks/weave/` and skill files into `.claude/skills/`, the Claude Code adapter produces a **self-contained plugin directory** (`weave-claude-plugin/`) that users install once with:

```
/plugin install ./weave-claude-plugin
```

Or during development:
```
claude --plugin-dir ./weave-claude-plugin
```

#### Plugin Directory Structure

```
weave-claude-plugin/
├── .claude-plugin/
│   └── plugin.json          # name, version, description, author
├── agents/                   # Weave's 8 agents as Claude Code subagents
│   ├── loom.md              # Loom — main orchestrator (also used as primary via settings.json)
│   ├── tapestry.md          # Tapestry — execution orchestrator
│   ├── pattern.md           # Pattern — strategic planner
│   ├── thread.md            # Thread — codebase explorer
│   ├── spindle.md           # Spindle — external research
│   ├── weft.md              # Weft — code review
│   ├── warp.md              # Warp — security review
│   └── shuttle.md           # Shuttle — domain specialist worker
├── skills/                   # Weave commands as invocable skills
│   ├── start-work/
│   │   └── SKILL.md         # /weave:start-work $ARGUMENTS
│   ├── plan/
│   │   └── SKILL.md         # /weave:plan $ARGUMENTS
│   └── metrics/
│       └── SKILL.md         # /weave:metrics
├── hooks/
│   ├── hooks.json            # Plugin-level hook registrations (auto-merged on install)
│   ├── pre-tool-use.mjs      # Write guard + Pattern MD-only guard
│   ├── post-tool-use.mjs     # Analytics tracking
│   ├── user-prompt-submit.mjs # Start-work detection, keyword detection
│   ├── on-stop.mjs           # Tapestry continuation (exit code 2 or allow)
│   ├── on-session-start.mjs  # Session init, analytics
│   ├── pre-compact.mjs       # Snapshot todos before compaction
│   └── post-compact.mjs      # Restore todos + inject re-orientation after compaction
├── settings.json             # { "agent": "loom" } — sets Loom as default primary agent
└── CLAUDE.md                 # Plugin-level CLAUDE.md (project context + Weave instructions)
```

#### Plugin Metadata

```json
// weave-claude-plugin/.claude-plugin/plugin.json
{
  "name": "weave",
  "version": "0.6.x",
  "description": "Weave — 8-agent AI orchestration system for Claude Code",
  "author": "opencode_weave"
}
```

#### Plugin settings.json

```json
// weave-claude-plugin/settings.json
{
  "agent": "loom"
}
```

This makes Loom the default primary agent when Claude Code launches with this plugin. Users can override with `--agent tapestry` for execution-only sessions.

#### Subagent Frontmatter

Each agent in `agents/` is a markdown file with YAML frontmatter. Plugin subagents do NOT support `hooks`, `mcpServers`, or `permissionMode` in frontmatter (Claude Code security restriction). Tool restrictions are expressed via `tools` or `disallowedTools`:

```markdown
---
name: pattern
description: Strategic planner — creates .md plan files in .weave/plans/. ONLY writes markdown files.
model: claude-opus-4-5
tools: [Read, Glob, Grep, Write]   # Write allowed but constrained by hooks/hooks.json
maxTurns: 10
---

[Full Pattern system prompt from src/agents/pattern/default.ts]
```

```markdown
---
name: loom
description: Main orchestrator — routes work to specialist agents, delegates via Task tool
model: claude-opus-4-5
maxTurns: 30
---

[Full Loom system prompt]
```

**Important constraint**: Subagents CANNOT spawn other subagents in Claude Code. Loom runs as the primary agent (via `settings.json: { "agent": "loom" }`), and dispatches to subagents via the Task tool. Tapestry can run as a primary agent switch (`--agent tapestry`) or as a subagent dispatched by Loom.

#### Skill Files (Commands)

Weave's slash commands become namespaced skills in `skills/`. When the plugin is installed, skills are invocable as `/weave:start-work`, `/weave:plan`, `/weave:metrics`.

Skill body content is derived at generation time from `WeaveCommandDefinition.template` — `mapCommand()` reads `command.template` and expands it, rather than hardcoding content. This ensures skill files always reflect the canonical command template defined in core.

```markdown
---
name: start-work
description: Start executing a Weave plan file
---

Read the plan file at `$ARGUMENTS` and begin executing it. Load `.weave/state.json` to check
if there's an existing plan in progress. If not, initialize state and start the first task.
```

#### Plugin Hooks — hooks/hooks.json

Plugin hooks are defined in `hooks/hooks.json` and auto-merged into the project's hook configuration when the plugin is installed. **This is the correct way to register hooks for plugin subagents**, since subagent frontmatter cannot contain `hooks`.

```json
// weave-claude-plugin/hooks/hooks.json
{
  "hooks": {
    "PreToolUse": [{
      "hooks": [{
        "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-use.mjs\""
      }]
    }],
    "PostToolUse": [{
      "hooks": [{
        "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/post-tool-use.mjs\""
      }]
    }],
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/user-prompt-submit.mjs\""
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/on-stop.mjs\""
      }]
    }],
    "SubagentStop": [{
      "matcher": "tapestry",
      "hooks": [{
        "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/on-stop.mjs\""
      }]
    }],
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/on-session-start.mjs\""
      }]
    }],
    "PreCompact": [{
      "hooks": [{
        "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/pre-compact.mjs\""
      }]
    }],
    "PostCompact": [{
      "hooks": [{
        "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/post-compact.mjs\""
      }]
    }]
  }
}
```

**Rationale for `Stop` + `SubagentStop` dual registration**: When Loom is the primary agent, `Stop` fires. When Tapestry runs as a subagent dispatched by Loom, its stop event fires as `SubagentStop` with `matcher: "tapestry"`. The same continuation logic handles both.

#### Hook Script Structure

Each hook script reads JSON from stdin, calls WeaveCore, and outputs the appropriate JSON response:

```javascript
// weave-claude-plugin/hooks/pre-tool-use.mjs
// Generated by weave build — do not edit manually
import { createWeaveCore } from '@opencode_weave/weave/core'

const raw = []
for await (const chunk of process.stdin) raw.push(chunk)
const input = JSON.parse(Buffer.concat(raw).toString())

const core = await createWeaveCore(process.cwd())
const result = core.checkToolBefore(
  input.agent_name ?? '',
  input.tool_name,
  input.tool_input?.file_path ?? input.tool_input?.path ?? '',
  input.session_id
)

if (!result.allowed) {
  process.stdout.write(JSON.stringify({
    permissionDecision: "deny",
    reason: result.reason
  }))
  process.exit(2)
}
process.exit(0)
```

```javascript
// weave-claude-plugin/hooks/on-stop.mjs
// Tapestry-only continuation — fires on Stop (primary) and SubagentStop:tapestry
import { createWeaveCore } from '@opencode_weave/weave/core'

const raw = []
for await (const chunk of process.stdin) raw.push(chunk)
const input = JSON.parse(Buffer.concat(raw).toString())

const core = await createWeaveCore(process.cwd())

// Use core.isContinuationAgent() — avoids hardcoding "tapestry" in adapter scripts
const agentName = input.agent_name ?? input.subagent_name ?? ''
if (agentName && !core.isContinuationAgent(agentName)) {
  process.exit(0)
}
const result = core.handleWorkContinuation(input.session_id)

if (result.shouldContinue) {
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: result.continuationPrompt
  }))
  process.exit(2)  // Block stopping; Claude Code will inject the reason as a new user message
}
process.exit(0)
```

```javascript
// weave-claude-plugin/hooks/pre-compact.mjs
// Snapshot todos before context compaction
import { createWeaveCore } from '@opencode_weave/weave/core'

const raw = []
for await (const chunk of process.stdin) raw.push(chunk)
const input = JSON.parse(Buffer.concat(raw).toString())

const core = await createWeaveCore(process.cwd())
await core.handlePreCompact(input.session_id)
// Always allow compaction to proceed
process.exit(0)
```

```javascript
// weave-claude-plugin/hooks/post-compact.mjs
// Restore todos + inject re-orientation context after compaction
import { createWeaveCore } from '@opencode_weave/weave/core'

const raw = []
for await (const chunk of process.stdin) raw.push(chunk)
const input = JSON.parse(Buffer.concat(raw).toString())

const core = await createWeaveCore(process.cwd())
const result = await core.handlePostCompact(input.session_id)

if (result.reOrientationContext) {
  // Inject re-orientation as additional context for the model post-compaction
  process.stdout.write(JSON.stringify({
    additionalContext: result.reOrientationContext
  }))
}
process.exit(0)
```

#### Continuation Strategy — Tapestry-Only

The continuation mechanism is **exclusively needed for Tapestry** during plan execution:
- **Loom** is conversational — no continuation needed
- **Pattern/Thread/Spindle/Weft/Warp/Shuttle** are single-task subagents — no continuation needed
- **Tapestry** executes multi-step plans and must auto-continue after each task completes

Continuation flow:
1. Tapestry finishes a task and stops
2. `Stop` (if Tapestry = primary) or `SubagentStop` with `matcher: tapestry` fires
3. `on-stop.mjs` calls `core.handleWorkContinuation(sessionId)`
4. If remaining tasks exist and all 7 safety checks pass: exit code 2 (block stopping) with continuation prompt in JSON body
5. Claude Code injects the continuation prompt as a new user message and Tapestry continues
6. If plan complete or paused: exit code 0 (allow stopping)

**Safety mechanisms** (same 7 checks as OpenCode):
1. Plan completion check (all tasks done)
2. Stale detection (same task 3 cycles without progress)
3. User message auto-pause (user said "pause" or similar)
4. Manual pause flag in state.json
5. Session interrupt
6. Context window approaching limit
7. Workflow takeover (another workflow supersedes this plan)

#### Compaction Hooks — Improvement Over OpenCode

Claude Code provides dedicated `PreCompact` and `PostCompact` hooks — a direct improvement over OpenCode where re-orientation waits for the next `session.idle` event:

| Hook | Fires When | Weave Action |
|---|---|---|
| `PreCompact` | Before context window compaction starts | Snapshot current todos to `.weave/state.json` |
| `PostCompact` | After compaction completes, before new context | Restore todos + inject re-orientation context: current plan name, file path, progress counts, last completed task, next task, instructions not to forget the plan |

The `PostCompact` injection is more precise than OpenCode's approach because it happens immediately at context restoration time, not at the next idle event.

#### Prompt Composer Handling

Weave's agents (Loom, Tapestry) use dynamic prompt composers that merge base prompts with skill content, workflow instructions, and context-specific additions. Claude Code subagents use static markdown files. Resolution:

1. **At plugin build time**: Generate static subagent `.md` files with all sections fully expanded. Skill content is embedded directly. This is the recommended approach for distribution.
2. **SessionStart hook injection**: The `on-session-start.mjs` hook can inject dynamic context (current plan state, active workflow) into the session at startup time, supplementing the static subagent prompts.
3. **Accept full prompts**: Static prompts include all sections; Claude gracefully ignores inapplicable instructions.

#### Plugin Installation Flow

`weave init --cli claude-code` generates a complete plugin directory. Users install it once and only need to re-run `weave init` when `weave.json` changes.

**Production install**:
```bash
weave init --cli claude-code          # generates weave-claude-plugin/ in project root
# Then in Claude Code:
/plugin install ./weave-claude-plugin
```

**Development mode** (no install needed — reads files directly):
```bash
claude --plugin-dir ./weave-claude-plugin
```

**After a `weave.json` change** (same as "restart OpenCode" for OpenCode users):
```bash
weave init --cli claude-code          # regenerates plugin dir from updated weave.json
/plugin install ./weave-claude-plugin  # reinstall to pick up changes
```

No background sync. No staleness checks. Runtime behavior (hook scripts) always reads live WeaveCore state on every invocation — it cannot go stale.

---

### C. Copilot CLI Adapter (Future Work)

**File**: `src/adapters/copilot-cli/index.ts`

Copilot CLI has the most limited extension model: custom agents as markdown files and MCP servers. This adapter is planned for a future phase.

**Agent mapping:**
- Each Weave agent becomes a markdown file in `.github/agents/`
- The markdown file IS the agent's system prompt
- Copilot routes to agents via `@agent-name` mentions

**Example: `.github/agents/loom.md`**
```markdown
---
name: Loom
description: Main Orchestrator — routes tasks to specialist agents
---

[Full Loom system prompt from src/agents/loom/default.ts]
```

**Hook implementation via MCP:**
Since Copilot CLI has no hook system, Weave exposes an MCP server that Copilot can call:

```json
// .github/copilot-mcp.json
{
  "servers": {
    "weave": {
      "type": "stdio",
      "command": "npx",
      "args": ["@opencode_weave/weave", "mcp-server"]
    }
  }
}
```

The MCP server exposes tools like:
- `weave_start_work` — equivalent of /start-work
- `weave_run_workflow` — equivalent of /run-workflow
- `weave_check_plan_progress` — read plan state
- `weave_pause_work` — pause current plan
- `weave_metrics` — show analytics

**Instructions integration:**
- `.github/copilot-instructions.md` gets a Weave section explaining available agents and MCP tools
- Agents reference each other via `@agent-name` syntax

**Continuation strategy:**
Copilot CLI supports automatic continuation via:
1. **Primary: Autopilot mode** — `copilot --autopilot --yolo --max-autopilot-continues N` enables fully autonomous multi-step execution. Weave's agent prompts include plan-checking instructions so the agent naturally reads `.weave/state.json` and continues with the next task after each step. The MCP tool `weave_check_progress` provides structured task progress with a `shouldContinue` safety signal.
2. **Alternative: ACP server** — Copilot's Agent Client Protocol (ACP) server mode allows programmatic session management for fine-grained continuation control.

**Limitations in Copilot CLI:**
- No lifecycle hooks — cannot intercept tool calls, no write guards
- No session tracking — analytics limited to what MCP server can observe
- Fleet orchestration unavailable (no subagent spawning API)
- Continuation safety coarser-grained — `--max-autopilot-continues` is the primary guard

---

## Agent Mapping Table

| Weave Agent | OpenCode | Claude Code (Plugin) | Copilot CLI |
|---|---|---|---|
| **Loom** (Main Orchestrator) | Primary agent via `config` hook. Display name: "Loom (Main Orchestrator)" | `agents/loom.md` subagent + `settings.json: { "agent": "loom" }` makes it primary. Invoked as `weave:loom` in typeahead. | `.github/agents/loom.md`. Invoked via `@loom`. |
| **Tapestry** (Execution) | Primary agent via `config` hook. Display name: "Tapestry (Execution Orchestrator)" | `agents/tapestry.md` subagent. Dispatched by Loom via Task tool, OR launched as primary with `--agent tapestry`. Continuation hooks scoped to tapestry. | `.github/agents/tapestry.md`. Invoked via `@tapestry`. |
| **Pattern** (Planning) | Subagent. Restricted to .md writes in .weave/. | `agents/pattern.md` with `tools: [Read, Glob, Grep, Write]`. Write guard enforced by `PreToolUse` hook in hooks.json (blocks non-.md writes). | `.github/agents/pattern.md`. Write restriction in prompt only (not enforced). |
| **Thread** (Codebase Explorer) | Subagent. Read-only tools. | `agents/thread.md` with `disallowedTools: [Write, Edit, Bash]`. Read-only enforced via frontmatter. | `.github/agents/thread.md`. Read-only via prompt. |
| **Spindle** (External Research) | Subagent. Read-only tools. | `agents/spindle.md` with `disallowedTools: [Write, Edit, Bash]`. Read-only enforced via frontmatter. | `.github/agents/spindle.md`. Read-only via prompt. |
| **Weft** (Code Review) | Subagent. Review-focused. | `agents/weft.md`. Post-implementation review. | `.github/agents/weft.md`. Invoked via `@weft`. |
| **Warp** (Security Review) | Subagent. Security-focused. | `agents/warp.md`. Security audit. | `.github/agents/warp.md`. Invoked via `@warp`. |
| **Shuttle** (Domain Specialist) | Worker agent. Category system. | `agents/shuttle.md`. Domain dispatch via Task tool. | `.github/agents/shuttle.md`. Invoked via `@shuttle`. |

---

## Hook Mapping Table

| Weave Hook | OpenCode Hook | Claude Code Hook (Plugin) | Copilot CLI Equivalent |
|---|---|---|---|
| **message.before** | `chat.message` | `UserPromptSubmit` (hooks.json → user-prompt-submit.mjs) | ❌ None |
| **tool.before** | `tool.execute.before` | `PreToolUse` (hooks.json → pre-tool-use.mjs); returns `permissionDecision: "deny"` to block | ❌ None |
| **tool.after** | `tool.execute.after` | `PostToolUse` (hooks.json → post-tool-use.mjs) | ❌ None |
| **session.idle / work-continuation** | `event` (session.idle) + `client.session.promptAsync` | `Stop` + `SubagentStop` (matcher: tapestry) → exit code 2 blocks; Tapestry-only | Autopilot mode auto-continues; ACP for programmatic control |
| **session.created** | `event` (session.created) | `SessionStart` (hooks.json → on-session-start.mjs) | ❌ None |
| **session.deleted** | `event` (session.deleted) | ❌ None (no explicit end hook) | ❌ None |
| **config.init** | `config` hook | Plugin `agents/*.md` + `settings.json` (static; loaded at install time) | `.github/agents/*.md` (static) |
| **params.resolve** | `chat.params` | ❌ None | ❌ None |
| **command.execute** | `command.execute.before` | Plugin skills in `skills/` (invoked as `/weave:start-work`, etc.) | MCP tool call |
| **pre.compaction** (NEW) | `experimental.session.compacting` (approximate) | `PreCompact` (hooks.json → pre-compact.mjs) — snapshot todos | ❌ None |
| **post.compaction** (NEW) | `event` (session.idle, delayed) | `PostCompact` (hooks.json → post-compact.mjs) — restore todos + inject re-orientation | ❌ None |
| **context-window-monitor** | `event` (message.updated tokens) | ❌ No token data in hooks | ❌ None |
| **write-guard** | `tool.execute.before` (read tracking) | `PreToolUse` (approximate — checks file extension + path) | ❌ Not enforceable |
| **pattern-md-only** | `tool.execute.before` (agent check) | `PreToolUse` (agent_name check in hook payload) | Prompt instruction only |
| **rules-injector** | `tool.execute.before` (file path) | Plugin `CLAUDE.md` (loaded as project context) | `.github/copilot-instructions.md` |
| **work-continuation** | `event` (session.idle) + `client.session.promptAsync` | `Stop`/`SubagentStop` exit code 2 + continuation prompt (Tapestry-only) | Autopilot + MCP `weave_check_progress shouldContinue` |
| **workflow-continuation** | `event` (session.idle) + `client.session.promptAsync` | `Stop`/`SubagentStop` exit code 2 + workflow continuation prompt (Tapestry-only) | Autopilot mode |
| **start-work** | `chat.message` (command detection) | `/weave:start-work` skill + `UserPromptSubmit` detection fallback | MCP `weave_start_work` tool |
| **analytics** | `event` (message.updated) | `PostToolUse` (partial) + `SessionStart` | MCP server logging |
| **todo-finalize** | `event` (session.idle) + `client.session.todo` | ❌ No todo API in Claude Code | ❌ No todo API |
| **tui.command.execute** (interrupt) | `event` (tui.command.execute) — session.interrupt, session.compact | ❌ No TUI commands; user uses Ctrl+C; prompt-based pause | ❌ None |
| **keyword-detector** | `chat.message` | `UserPromptSubmit` (hooks.json → user-prompt-submit.mjs) | ❌ None |
| **verification-reminder** | `chat.message` | `UserPromptSubmit` (approximate) | Prompt instruction only |
| **workflow-command** | `chat.message` — detects natural language workflow commands | `UserPromptSubmit` | MCP tool (manual trigger) |

---

## Shared vs. CLI-Specific Boundary

### Shared Core (`src/core/`)
| Module | Current Location | Notes |
|---|---|---|
| Agent definitions | `src/agents/*/default.ts` | Prompts, metadata, permissions |
| Agent builder | `src/agents/agent-builder.ts` | Skill resolution, prompt composition |
| Agent metadata | `src/agents/builtin-agents.ts` | AGENT_METADATA, AGENT_FACTORIES |
| Custom agents | `src/agents/custom-agent-factory.ts` | Custom agent building |
| Hook logic | `src/hooks/*.ts` | All pure hook functions |
| Work state | `src/features/work-state/` | Plan tracking (file-based) |
| Workflow engine | `src/features/workflow/` | Workflow management (file-based) |
| Analytics | `src/features/analytics/` | Session tracking, reports |
| Skills | `src/features/skill-loader/` | Skill discovery and resolution |
| Config schema | `src/config/schema.ts` | Zod schema for weave.json |
| Config loader | `src/config/loader.ts` | Needs parameterized paths |
| Config merge | `src/config/merge.ts` | Deep merge logic |
| Tool permissions | `src/tools/permissions.ts` | Permission maps |
| Commands | `src/features/builtin-commands/` | Command definitions |
| Shared utils | `src/shared/` | Logging, version, types |
| Compaction handlers | `src/core/compaction.ts` (new) | Pre/Post compaction logic (CLI-agnostic) |

### CLI-Specific (`src/adapters/{cli}/`)
| Module | OpenCode | Claude Code | Copilot CLI |
|---|---|---|---|
| Plugin entry | `src/adapters/opencode/index.ts` (current `src/index.ts`) | `src/adapters/claude-code/index.ts` | `src/adapters/copilot-cli/index.ts` |
| Hook wiring | In-process callbacks | Plugin `hooks/hooks.json` + generated `.mjs` scripts | MCP server |
| Agent registration | Config mutation via `config` hook | Plugin `agents/*.md` (subagents) | Markdown file generation |
| Command registration | Slash commands via `config` hook | Plugin `skills/*/SKILL.md` (namespaced) | MCP tools |
| Config generation | `opencode.json` plugin entry | `weave-claude-plugin/` directory | `.github/agents/*.md` |
| Session management | `@opencode-ai/sdk` client | Shell I/O (stdin/stdout JSON) | MCP protocol |
| Display names | Formatted with role suffixes | Subagent `name` frontmatter + plugin namespace (`weave:loom`) | Markdown frontmatter |
| Continuation | `client.session.promptAsync` | `Stop`/`SubagentStop` exit code 2 + continuation prompt; Tapestry-only | Autopilot mode (primary) / ACP server (alternative) |
| Compaction | OpenCode experimental.session.compacting | `PreCompact`/`PostCompact` hooks | ❌ Not available |

---

## Configuration Generation (`weave init`)

### New CLI Entry Point

```
npx @opencode_weave/weave init [--cli opencode|claude-code|copilot-cli|all]
```

When `--cli` is omitted, `CLIDetector` is used. When `--cli all`, generates configs for all three.

### Per-CLI Generated Files

**OpenCode:**
```
opencode.json                    → adds plugin entry: { "name": "@opencode_weave/weave" }
.opencode/weave-opencode.json    → symlink to weave.json (or copy)
```

**Claude Code (Plugin Directory):**
```
weave-claude-plugin/
├── .claude-plugin/plugin.json   → name, version, description
├── agents/loom.md               → Loom subagent (primary via settings.json)
├── agents/tapestry.md           → Tapestry subagent (continuation-enabled)
├── agents/pattern.md            → Pattern subagent (write guard via hooks)
├── agents/thread.md             → Thread subagent (read-only via frontmatter)
├── agents/spindle.md            → Spindle subagent (read-only via frontmatter)
├── agents/weft.md               → Weft subagent
├── agents/warp.md               → Warp subagent
├── agents/shuttle.md            → Shuttle subagent
├── skills/start-work/SKILL.md   → /weave:start-work skill
├── skills/plan/SKILL.md         → /weave:plan skill
├── skills/metrics/SKILL.md      → /weave:metrics skill
├── hooks/hooks.json             → auto-merged hook registrations (8 hooks)
├── hooks/pre-tool-use.mjs       → Write guard + Pattern MD-only guard
├── hooks/post-tool-use.mjs      → Analytics tracking
├── hooks/user-prompt-submit.mjs → Start-work detection, keyword detection
├── hooks/on-stop.mjs            → Tapestry continuation (exit 2 or 0)
├── hooks/on-session-start.mjs   → Session init, analytics
├── hooks/pre-compact.mjs        → Snapshot todos before compaction
├── hooks/post-compact.mjs       → Restore todos + re-orientation context
├── settings.json                → { "agent": "loom" }
└── CLAUDE.md                    → Weave project context + agent usage guide
```

After generating the plugin directory, `weave init --cli claude-code` prints:
```
Plugin generated at ./weave-claude-plugin/
Install with: /plugin install ./weave-claude-plugin
  Or for dev:  claude --plugin-dir ./weave-claude-plugin
Re-run `weave init --cli claude-code` only when weave.json changes.
```

**Copilot CLI:**
```
.github/agents/loom.md            → Loom agent
.github/agents/tapestry.md        → Tapestry agent
.github/agents/pattern.md         → Pattern agent
.github/agents/thread.md          → Thread agent
.github/agents/spindle.md         → Spindle agent
.github/agents/weft.md            → Weft agent
.github/agents/warp.md            → Warp agent
.github/agents/shuttle.md         → Shuttle agent
.github/copilot-instructions.md   → append Weave instructions
.github/copilot-mcp.json          → Weave MCP server config (or merge into existing)
```

### Config Path Parameterization

The config loader (`src/config/loader.ts`) currently hardcodes `.opencode/` paths. This must be parameterized:

```typescript
// src/core/paths.ts
export interface WeavePaths {
  /** User-level config dir (~/.config/{cli}/weave-{cli}.json) */
  userConfigBase: string
  /** Project-level config dir ({dir}/.{cli}/weave-{cli}.json) */
  projectConfigBase: string
  /** User-level skills dir */
  userSkillsDir: string
  /** Project-level skills dir */
  projectSkillsDir: string
  /** User-level workflows dir */
  userWorkflowsDir: string
  /** Project-level workflows dir */
  projectWorkflowsDir: string
  /** Weave state dir (always .weave/ — shared across CLIs) */
  weaveStateDir: string
}

export function getPathsForCLI(cli: "opencode" | "claude-code" | "copilot-cli"): WeavePaths
```

**Critical**: `.weave/` is ALWAYS shared. WorkState, analytics, and plan files are CLI-agnostic. Only the CLI integration surface (hooks, agent registration) differs. A plan started in OpenCode will be continued by Tapestry in Claude Code — this is desirable cross-CLI behavior.

---

## Fleet / Orchestration Mapping

| Feature | OpenCode | Claude Code | Copilot CLI |
|---|---|---|---|
| **Parallel agents** | Fleet API (`client.session.promptAsync` to new sessions) | Agent teams (worktree-based parallel execution) | ❌ Not available |
| **Background tasks** | BackgroundManager + session spawning | Claude Code `--background` flag or worktree cloning | ❌ Not available |
| **Subagent delegation** | `task()` tool | Claude Code native Task tool (dispatches to plugin subagents as `weave:pattern`, etc.) | `@agent-name` mention in prompt |
| **Continuation loop** | `session.idle` + `promptAsync` | `Stop`/`SubagentStop` exit code 2 (Tapestry-only) | Autopilot mode `--max-autopilot-continues N` |
| **Compaction recovery** | `session.idle` (delayed re-orientation) | `PreCompact` + `PostCompact` (immediate, precise) | ❌ None |

---

## Limitations & Trade-offs

### Feature Support Matrix

| Feature | OpenCode | Claude Code (Plugin) | Copilot CLI |
|---|---|---|---|
| 8 agents | ✅ Full | ✅ Full (as plugin subagents) | ✅ Full (as markdown agents) |
| Tool guards (write, pattern) | ✅ In-process enforcement | ✅ Shell hook via hooks.json (exit code 2 blocks; `permissionDecision: "deny"`) | ❌ Prompt-based only |
| Work continuation (Tapestry) | ✅ Automatic (idle loop) | ✅ Automatic (`Stop`/`SubagentStop` exit code 2) | ✅ Automatic (autopilot mode) / ⚠️ Semi-auto (ACP server) |
| Workflow engine | ✅ Full | ✅ Full (Tapestry-only continuation) | ✅ Full (via autopilot mode) / ⚠️ Partial (ACP) |
| Compaction recovery | ⚠️ Delayed (next idle) | ✅ Immediate (PreCompact/PostCompact) | ❌ Not available |
| Analytics | ✅ Full (tokens, cost, timing) | ⚠️ Partial (no token counts from hooks) | ⚠️ Minimal (MCP call counts) |
| Context window monitor | ✅ Full | ❌ No token data in hook payloads | ❌ No token data |
| Todo sidebar | ✅ Native | ❌ No todo API | ❌ No todo API |
| Slash commands | ✅ Native | ✅ Plugin skills (`/weave:start-work`, namespaced) | ⚠️ MCP tools |
| Custom agents | ✅ Full | ✅ Full (as additional plugin subagents) | ✅ Full (as additional .md files) |
| Fleet orchestration | ✅ Full | ⚠️ Limited (worktrees) | ❌ None |
| Skill system | ✅ Full | ✅ Native plugin skills | ⚠️ Embedded in agent prompts |
| Config hot-reload | ✅ Plugin reload | ❌ Requires `weave init` re-run + plugin reinstall (only on `weave.json` changes) | ❌ Requires restart |
| Agent typeahead | ✅ @ autocomplete | ✅ Plugin subagents appear as `weave:loom` etc. | ❌ @mention in prompt |
| Packaged distribution | N/A (npm package) | ✅ `/plugin install <path-or-url>` | ❌ Manual file copy |

### Key Trade-offs

1. **Shell hooks have cold-start overhead** — Each Claude Code hook invocation spawns a new Node.js process. For frequently-fired hooks (PreToolUse), this adds ~100-200ms latency. Mitigation: Use a persistent background process with IPC, or cache `WeaveCore` initialization in module scope.

2. **Copilot CLI agents can't enforce constraints** — Without lifecycle hooks, Pattern's .md-only restriction and write guards are prompt-based only. Acceptable trade-off since Copilot CLI is the most basic integration tier.

3. **Analytics coverage varies** — OpenCode provides rich token/cost data via events. Claude Code provides tool-level data via shell hooks but no token counts. Copilot CLI only sees MCP tool invocations. Analytics will have different fidelity per CLI.

4. **Dual-CLI projects** — When multiple team members use different CLIs, all generated configs coexist but `.weave/` state is shared. This is intentional — a plan started in OpenCode is continued by Tapestry in Claude Code.

5. **Plugin reinstall on `weave.json` changes** — When `weave.json` changes (new agent, disabled agent, override), re-running `weave init --cli claude-code` regenerates the plugin directory. Users must re-run `/plugin install ./weave-claude-plugin` to pick up those changes. This is equivalent to the "restart plugin" flow OpenCode requires after a config change. Development mode (`--plugin-dir`) picks up file changes immediately without reinstall. Importantly, **no reinstall is needed for session-to-session runtime changes** — hook scripts always read live WeaveCore state.

6. **Subagents cannot spawn subagents** — In Claude Code, Loom (running as primary) dispatches to Pattern/Thread/etc. via the native Task tool. Pattern et al. cannot recursively spawn further subagents. This matches Weave's existing delegation model (Loom → subagent, not subagent → subagent) so it's not a practical limitation.

7. **Tapestry duality** — Tapestry can run as a primary agent (user launches with `--agent tapestry`) or as a subagent dispatched by Loom. The `Stop` + `SubagentStop` dual hook registration handles both cases. However, the Tapestry subagent prompt must work correctly in both roles.

---

## Migration Path

The migration is designed as a series of **non-breaking refactoring steps** where each step leaves the OpenCode integration working identically.

### Phase 0: Prerequisite — Decouple Type Dependencies
Before any structural changes, remove `@opencode-ai/sdk` types from core modules.

### Phase 1: Extract WeaveCore (OpenCode still works identically)
1. Create `src/core/` module with CLI-agnostic types
2. Move pure logic from `plugin-interface.ts` into core
3. Add compaction handlers to core (`handlePreCompact`, `handlePostCompact`)
4. `plugin-interface.ts` becomes a thin OpenCode adapter calling core methods
5. All existing tests pass unchanged

### Phase 2: Adapter Interface + Config Generator CLI
1. Define `CLIAdapter` interface (updated with `pluginSystem` capability, `compactionHooks`)
2. Wrap existing OpenCode code as `OpenCodeAdapter`
3. Build `CLIDetector` (updated to detect `CLAUDE_PLUGIN_ROOT` env var)
4. Build `ConfigGenerator` scaffolding
5. Create integration test harness and shared utilities

### Phase 3: Claude Code Plugin Adapter
1. Build Claude Code plugin adapter
2. Generate plugin directory: `agents/*.md`, `skills/*/SKILL.md`, `hooks/hooks.json`, hook scripts, `settings.json`, `CLAUDE.md`
3. Claude Code hook stdin/stdout integration tests (Layer 1 — no CLI needed)
4. Plugin structure validation tests
5. Document feature degradation

### Phase 4: Copilot CLI Adapter (Future Work)
1. Build Copilot CLI adapter
2. Generate agent markdown files, MCP server
3. Build MCP server entry point
4. MCP server in-process integration tests (Layer 1 — no CLI needed)
5. Document feature degradation

### Phase 5: Polish & Documentation
1. Unified `weave init` experience
2. Multi-CLI coexistence testing
3. README and docs updates
4. Package exports for core + adapters
5. CLI smoke tests (Layer 2 — requires real CLIs + API keys)

---

## TODOs

### Phase 0: Decouple Type Dependencies

- [ ] 1. **Create CLI-agnostic agent type**
  **What**: Define `WeaveAgentDefinition` and `WeavePermissionConfig` in `src/core/types.ts` that mirror `AgentConfig` and `PermissionConfig` from `@opencode-ai/sdk` without importing them. Add a mapping function `toOpenCodeAgentConfig(agent: WeaveAgentDefinition): AgentConfig` in the OpenCode adapter. Update all 26 files that import `AgentConfig` from `@opencode-ai/sdk` to use `WeaveAgentDefinition` instead, keeping the SDK import only in the OpenCode adapter's mapper.
  **Files**:
    - Create `src/core/types.ts` — `WeaveAgentDefinition`, `WeavePermissionConfig`
    - Create `src/core/index.ts` — re-exports
    - Modify `src/agents/types.ts` — `AgentFactory` and `AgentSource` use `WeaveAgentDefinition`
    - Modify `src/agents/builtin-agents.ts` — returns `Record<string, WeaveAgentDefinition>`
    - Modify `src/agents/agent-builder.ts` — `buildAgent()` returns `WeaveAgentDefinition`
    - Modify `src/agents/custom-agent-factory.ts` — `buildCustomAgentConfig()` returns `WeaveAgentDefinition`
    - Modify `src/agents/loom/index.ts` + `src/agents/loom/default.ts`
    - Modify `src/agents/tapestry/index.ts` + `src/agents/tapestry/default.ts`
    - Modify `src/agents/pattern/index.ts` + `src/agents/pattern/default.ts`
    - Modify `src/agents/thread/index.ts` + `src/agents/thread/default.ts`
    - Modify `src/agents/spindle/index.ts` + `src/agents/spindle/default.ts`
    - Modify `src/agents/weft/index.ts` + `src/agents/weft/default.ts`
    - Modify `src/agents/warp/index.ts` + `src/agents/warp/default.ts`
    - Modify `src/agents/shuttle/index.ts` + `src/agents/shuttle/default.ts`
    - Modify `src/create-managers.ts` — `agents: Record<string, WeaveAgentDefinition>`
    - Modify `src/managers/config-handler.ts` — `agents?: Record<string, WeaveAgentDefinition>`
    - Modify `src/plugin/plugin-interface.ts` — use `WeaveAgentDefinition` internally, convert to `AgentConfig` via adapter mapper at the OpenCode boundary
    - Modify `src/agents/agent-builder.test.ts` — update type references
    - Modify `src/agents/types.test.ts` — update type references
    - Modify `src/managers/config-handler.test.ts` — update type references
    - Modify `src/agents/custom-agent-factory.test.ts` — update type references
    - Update `src/tools/permissions.ts` — update JSDoc reference
  **Acceptance**: `bun run typecheck` passes. No `@opencode-ai/sdk` imports outside `src/adapters/opencode/`. All 26 files compile against `WeaveAgentDefinition`.

- [ ] 2. **Parameterize config paths and skill loading**
  **What**: Replace hardcoded `.opencode/` paths in config loader and skill loader with a `WeavePaths` configuration. Default to OpenCode paths for backward compatibility. **Critically**, make `serverUrl` optional in `LoadSkillsOptions` — the current `loadSkills()` requires `serverUrl` (from OpenCode's `PluginInput`) and calls `fetchSkillsFromOpenCode(serverUrl, directory)` as the primary skill source. For non-OpenCode CLIs there is no server URL, so skill loading must fall back to filesystem-only mode. When `serverUrl` is undefined, skip the API call entirely and use only `scanFilesystemSkills()`. The filesystem paths themselves must also be parameterized (currently hardcoded to `~/.config/opencode/skills/` and `{dir}/.opencode/skills/`).
  **Files**:
    - Create `src/core/paths.ts`
    - Modify `src/config/loader.ts` — accept `WeavePaths` parameter, default to OpenCode
    - Modify `src/features/skill-loader/loader.ts` — make `serverUrl` optional in `LoadSkillsOptions`, skip `fetchSkillsFromOpenCode()` when absent, parameterize filesystem skill directories via `WeavePaths`
    - Modify `src/features/skill-loader/discovery.ts` — accept paths parameter
    - Modify `src/features/workflow/constants.ts` — parameterize workflow dirs
  **Acceptance**: All existing tests pass. Config loading works with explicit paths for any CLI. `loadSkills({ directory })` (no `serverUrl`) returns only filesystem skills without error.

- [ ] 3. **Parameterize rules file detection**
  **What**: `src/hooks/rules-injector.ts` hardcodes `RULES_FILENAMES = ["AGENTS.md", ".rules", "CLAUDE.md"]`. Make this configurable per-CLI so each adapter specifies which instruction files to discover.
  **Files**:
    - Modify `src/hooks/rules-injector.ts` — accept filenames parameter
    - Modify `src/hooks/create-hooks.ts` — pass filenames through
  **Acceptance**: Rules injector can be told to look for `CLAUDE.md` or `AGENTS.md` or `.github/copilot-instructions.md`.

### Phase 1: Extract WeaveCore

- [ ] 4. **Extract core initialization**
  **What**: Create `createWeaveCore()` function that performs all CLI-agnostic initialization (config loading, agent building, hook creation, skill loading, analytics setup) and returns a `WeaveCoreInstance`. The current `src/index.ts` becomes a thin wrapper: `WeavePlugin = async (ctx) => { const core = createWeaveCore(...); return OpenCodeAdapter.init(core); }`. Include `isContinuationAgent(agentName: string): boolean` on `WeaveCoreInstance` — returns true for agents that drive the work-continuation loop (currently: only Tapestry). This keeps adapter hook scripts free of hardcoded agent names.
  **Files**:
    - Create `src/core/create-core.ts` — include `isContinuationAgent()` implementation
    - Modify `src/index.ts` — delegate to core + OpenCode adapter
    - Modify `src/create-managers.ts` — remove `PluginInput` dependency, accept generic context
    - Modify `src/create-tools.ts` — remove `PluginInput` dependency
  **Acceptance**: `bun test` passes. OpenCode behavior identical. No regression. `isContinuationAgent("tapestry")` returns true, `isContinuationAgent("loom")` returns false.

- [ ] 5. **Extract todo finalization from plugin-interface.ts**
  **What**: The todo finalization logic (lines 501-539 of `plugin-interface.ts`) is inline and depends on `client.session.todo()` and `client.session.promptAsync()`. Extract the decision logic (should we finalize?) into core, keep the OpenCode-specific `client` calls in the adapter.
  **Files**:
    - Create `src/core/todo-finalization.ts`
    - Modify `src/plugin/plugin-interface.ts` — call core for decision, adapter for execution
  **Acceptance**: Todo finalization works identically in OpenCode.

- [ ] 6. **Extract session idle orchestration**
  **What**: The `session.idle` handler in `plugin-interface.ts` (lines 440-539) orchestrates workflow continuation → work continuation → todo finalization. Extract this priority chain into core as `handleSessionIdle()` that returns an action discriminated union (`{ type: "workflow-continue" | "work-continue" | "todo-finalize" | "none", ... }`).
  **Files**:
    - Create `src/core/idle-orchestrator.ts`
    - Modify `src/plugin/plugin-interface.ts` — call orchestrator, execute action
  **Acceptance**: Idle behavior identical in OpenCode. Core function is testable independently.

- [ ] 7. **Extract event routing from plugin-interface.ts**
  **What**: The `event` handler (lines 278-539) is a massive switch over event types. Extract the core logic for each event type into separate core functions. The adapter just routes events to the right core function and handles CLI-specific side effects (like `client.session.promptAsync`).
  **Files**:
    - Modify `src/core/create-core.ts` — add event handling methods
    - Create `src/core/event-handlers.ts`
    - Modify `src/plugin/plugin-interface.ts` — thin event routing
  **Acceptance**: All event handling works identically.

- [ ] 8. **Extract message handling from plugin-interface.ts**
  **What**: The `chat.message` handler (lines 78-253) handles start-work, workflow-start, workflow-commands, user message tracking, and auto-pause. Extract the decision logic into core. The adapter handles OpenCode-specific mutations (parts array, message.agent, `_output` mutation).
  **Files**:
    - Create `src/core/message-handler.ts`
    - Modify `src/plugin/plugin-interface.ts` — thin message routing
  **Acceptance**: Message handling works identically.

- [ ] 8a. **Add compaction handlers to WeaveCore**
  **What**: Implement `handlePreCompact(sessionId)` and `handlePostCompact(sessionId)` in `WeaveCoreInstance`. `handlePreCompact` snapshots the current todo list and plan state to `.weave/compaction-snapshot.json`. `handlePostCompact` restores todos (if any were snapshotted) and constructs a re-orientation context string containing: current plan name, plan file path, progress counts (N of M tasks completed), last completed task name, next task name and description, and instructions reminding the agent not to forget the active plan. This context is returned for the `PostCompact` hook to inject as `additionalContext`.
  **Files**:
    - Create `src/core/compaction.ts` — `handlePreCompact`, `handlePostCompact`, `CompactionSnapshot` type
    - Modify `src/core/create-core.ts` — expose `handlePreCompact`, `handlePostCompact` on `WeaveCoreInstance`
    - Create `src/core/compaction.test.ts`
  **Acceptance**: `handlePreCompact` writes snapshot. `handlePostCompact` returns correct re-orientation context for an in-progress plan. No-op when no plan is active.

### Phase 2: Adapter Interface + OpenCode Adapter

- [ ] 9. **Define CLIAdapter interface**
  **What**: Create the `CLIAdapter` interface, `CLICapabilities` (with `compactionHooks: boolean` and `pluginSystem: boolean` fields), `CLIAgentManifest`, `CLIHookManifest`, `CLICommandManifest`, and `FeatureDegradation` types as specified in the Core Interface Definitions section above. Update `CLICommandManifest.type` to include `"skill-file"`. Implement `mapHook()` as an exhaustive switch over `WeaveHookEvent` in every adapter — returning null for unsupported events, and adding to the degradation report. Implement `mapCommand()` to derive skill/command body from `WeaveCommandDefinition.template`.
  **Files**:
    - Create `src/adapters/types.ts`
    - Create `src/adapters/index.ts`
  **Acceptance**: Types compile. No runtime code yet. The exhaustive switch pattern is documented with a comment indicating it must be kept in sync with `WeaveHookEvent`.

- [ ] 10. **Implement OpenCodeAdapter**
  **What**: Wrap the refactored `plugin-interface.ts` as a class implementing `CLIAdapter`. The `init()` method returns the current `PluginInterface` object. `generateConfig()` outputs the `opencode.json` plugin entry. `mapAgent()` converts `WeaveAgentDefinition` to OpenCode's `AgentConfig`.
  **Files**:
    - Create `src/adapters/opencode/index.ts`
    - Create `src/adapters/opencode/agent-mapper.ts`
    - Create `src/adapters/opencode/hook-wiring.ts` (refactored plugin-interface.ts)
    - Modify `src/index.ts` — use OpenCodeAdapter
    - Modify `src/plugin/plugin-interface.ts` — becomes thin re-export or is absorbed
  **Acceptance**: `bun test` passes. OpenCode behavior identical.

- [ ] 11. **Implement CLIDetector**
  **What**: Implement `detectCLI()` function. Detection priority: (1) `WEAVE_CLI` env var, (2) `CLAUDE_PLUGIN_ROOT` env var → claude-code with high confidence, (3) `OPENCODE_*` env vars → opencode, (4) config file presence (`weave-claude-plugin/` directory → claude-code, `.opencode/` → opencode, `.github/agents/` → copilot-cli), (5) SDK availability.
  **Files**:
    - Create `src/adapters/detect.ts`
    - Create `src/adapters/detect.test.ts`
  **Acceptance**: Detection returns correct CLI for known environment setups. `CLAUDE_PLUGIN_ROOT` set → detects claude-code with high confidence. Tests cover all detection strategies.

- [ ] 12. **Build ConfigGenerator scaffolding**
  **What**: Create the `weave init` CLI entry point that accepts `--cli` flag, runs detection, and delegates to the selected adapter's `generateConfig()` method. Initially only supports OpenCode. Output includes feature degradation report.
  **Files**:
    - Create `src/cli/init.ts`
    - Create `src/cli/index.ts`
    - Modify `package.json` — add `bin` entry for `weave` CLI
  **Acceptance**: `npx @opencode_weave/weave init --cli opencode` generates correct config.

- [ ] 13. **Create integration test harness and shared utilities**
  **What**: Create shared test infrastructure for adapter integration testing. Includes: (a) `runHookScript()` — spawns a Node.js process with JSON on stdin, captures exit code + stdout; (b) `validatePluginDir()` — validates the complete plugin directory structure (plugin.json, agents/*.md, skills/*/SKILL.md, hooks/hooks.json, settings.json); (c) `validateSubagentMd()` — validates YAML frontmatter in agent files (name, description required; tools/disallowedTools/maxTurns optional; `hooks`/`mcpServers`/`permissionMode` must be ABSENT since they're security-restricted in plugin subagents); (d) `validateHooksJson()` — validates hooks.json structure (hook names, matchers, command entries with `${CLAUDE_PLUGIN_ROOT}` references); (e) `mcpTestClient()` — connects to Weave MCP server in-process; (f) `createTestProject()` — temp directory with weave.json, optional state.json, optional plan files.
  **Files**:
    - Create `src/test-utils/hook-runner.ts` — `runHookScript(scriptPath, input): Promise<{ exitCode, stdout, stderr }>`
    - Create `src/test-utils/plugin-validator.ts` — `validatePluginDir(path)`, `validateSubagentMd(path)`, `validateHooksJson(path)`, `validateSkillMd(path)`
    - Create `src/test-utils/mcp-client.ts` — `createMCPTestClient(serverCommand, args): Promise<MCPTestClient>`
    - Create `src/test-utils/config-validator.ts` — `validateCopilotAgentMd(path)` (for future Copilot adapter)
    - Create `src/test-utils/test-project.ts` — `createTestProject(opts): Promise<{ dir, cleanup }>`
    - Create `src/test-utils/index.ts` — re-exports
    - Modify `package.json` — add `@modelcontextprotocol/sdk` as devDependency
  **Acceptance**: All utilities work in isolation. `runHookScript()` can execute a trivial echo script. `validateSubagentMd()` rejects files containing `hooks:` frontmatter field. `validateHooksJson()` verifies `${CLAUDE_PLUGIN_ROOT}` in command strings.

### Phase 3: Claude Code Plugin Adapter

- [ ] 14. **Implement ClaudeCodeAdapter**
  **What**: Implement `CLIAdapter` for Claude Code. `capabilities.pluginSystem = true`, `capabilities.compactionHooks = true`, `capabilities.agentRegistration = "plugin-subagents"`, `capabilities.slashCommands = true` (via skills). `mapAgent()` generates subagent `.md` content with YAML frontmatter. `mapHook()` maps Weave hooks to Claude Code hook events. `mapCommand()` generates SKILL.md content. `generateConfig()` produces the complete `weave-claude-plugin/` directory.
  **Files**:
    - Create `src/adapters/claude-code/index.ts`
    - Create `src/adapters/claude-code/agent-mapper.ts` (generates subagent .md with frontmatter)
    - Create `src/adapters/claude-code/skill-mapper.ts` (generates SKILL.md content)
    - Create `src/adapters/claude-code/hook-mapper.ts` (maps Weave hooks to hooks.json entries)
    - Create `src/adapters/claude-code/plugin-generator.ts` (orchestrates plugin dir generation)
    - Create `src/adapters/claude-code/index.test.ts`
  **Acceptance**: `generateConfig()` produces a valid plugin directory passing `validatePluginDir()`.

- [ ] 15. **Generate Claude Code subagent files**
  **What**: For each of the 8 Weave agents, generate a subagent `.md` file with correct YAML frontmatter:
  - `name`: the agent's config key (e.g., "loom", "pattern")
  - `description`: concise description for typeahead
  - `model`: from `WeaveAgentDefinition.model` (if set)
  - `maxTurns`: from `WeaveAgentDefinition.steps` (if set)
  - `tools` or `disallowedTools`: from permission config (Thread/Spindle get `disallowedTools: [Write, Edit, Bash]`; Pattern gets `tools: [Read, Glob, Grep, Write]`)
  - Body: full agent system prompt from `WeaveAgentDefinition.prompt`
  - **Must NOT include**: `hooks`, `mcpServers`, `permissionMode` (security restriction for plugin subagents)
  **Files**:
    - Modify `src/adapters/claude-code/agent-mapper.ts`
    - Create `src/adapters/claude-code/agent-mapper.test.ts`
  **Acceptance**: All 8 generated subagent files pass `validateSubagentMd()`. No forbidden frontmatter fields present.

- [ ] 16. **Generate plugin skills (SKILL.md files)**
  **What**: Generate `skills/{name}/SKILL.md` files for each Weave command. Skills support `$ARGUMENTS` substitution and are namespaced as `/weave:start-work`, `/weave:plan`, `/weave:metrics`. Frontmatter includes `name` and `description`. Body is derived from `WeaveCommandDefinition.template` at generation time — `mapCommand()` reads `command.template` and expands/renders it rather than hardcoding any skill body content.
  **Files**:
    - Modify `src/adapters/claude-code/skill-mapper.ts`
    - Create `src/adapters/claude-code/skill-mapper.test.ts`
  **Acceptance**: Generated SKILL.md files have valid YAML frontmatter. `/weave:start-work` skill body is derived from `WeaveCommandDefinition.template` (not hardcoded). All skills have non-empty descriptions.

- [ ] 17. **Generate plugin hooks.json and hook scripts**
  **What**: Generate `hooks/hooks.json` with 8 hook registrations (PreToolUse, PostToolUse, UserPromptSubmit, Stop, SubagentStop with matcher "tapestry", SessionStart, PreCompact, PostCompact). All commands reference `${CLAUDE_PLUGIN_ROOT}/hooks/*.mjs`. Generate each hook script as a Node.js ESM `.mjs` file that: (1) reads stdin JSON, (2) imports WeaveCore via `createWeaveCore(process.cwd())`, (3) calls the appropriate core method, (4) writes JSON response to stdout, (5) exits with correct code.
  
  Key scripts:
  - `pre-tool-use.mjs` — calls `core.checkToolBefore(agent_name, tool_name, file_path, session_id)` → exit 2 + `{ permissionDecision: "deny", reason }` to block
  - `on-stop.mjs` — calls `core.isContinuationAgent(agentName)` to gate Tapestry-only logic; then calls `core.handleWorkContinuation(session_id)` → if `shouldContinue`: exit 2 + `{ decision: "block", reason: continuationPrompt }`
  - `pre-compact.mjs` — calls `core.handlePreCompact(session_id)` → always exit 0
  - `post-compact.mjs` — calls `core.handlePostCompact(session_id)` → if re-orientation context: `{ additionalContext: ... }`; always exit 0
  **Files**:
    - Modify `src/adapters/claude-code/hook-mapper.ts`
    - Create `src/adapters/claude-code/scripts/pre-tool-use.mjs.ts` (template)
    - Create `src/adapters/claude-code/scripts/post-tool-use.mjs.ts` (template)
    - Create `src/adapters/claude-code/scripts/user-prompt-submit.mjs.ts` (template)
    - Create `src/adapters/claude-code/scripts/on-stop.mjs.ts` (template — Tapestry-only gate)
    - Create `src/adapters/claude-code/scripts/on-session-start.mjs.ts` (template)
    - Create `src/adapters/claude-code/scripts/pre-compact.mjs.ts` (template)
    - Create `src/adapters/claude-code/scripts/post-compact.mjs.ts` (template)
    - Create `src/adapters/claude-code/script-generator.ts` (bundles/renders templates)
  **Acceptance**: `hooks/hooks.json` passes `validateHooksJson()`. Hook scripts are valid Node.js ESM. `on-stop.mjs` exits 0 for non-tapestry agents. `post-compact.mjs` outputs `additionalContext` when plan is active.

- [ ] 18. **Generate plugin.json, settings.json, and CLAUDE.md**
  **What**: Generate the remaining plugin files:
  - `.claude-plugin/plugin.json` — `{ name, version, description, author }`; version read from `package.json`
  - `settings.json` — `{ "agent": "loom" }` (makes Loom the default primary agent)
  - `CLAUDE.md` — Weave overview: what it is, the 8 agents (names + roles), how to invoke skills (`/weave:start-work`), where to find plan state (`.weave/state.json`), cross-agent delegation patterns
  **Files**:
    - Modify `src/adapters/claude-code/plugin-generator.ts`
    - Create `src/adapters/claude-code/claude-md-generator.ts`
  **Acceptance**: `plugin.json` has all required fields. `settings.json` sets `agent: "loom"`. `CLAUDE.md` body is non-empty and mentions all 8 agents.

- [ ] 19. **Claude Code plugin adapter integration tests (Layer 1)**
  **What**: Write integration tests that verify the Claude Code plugin adapter end-to-end WITHOUT Claude Code installed. Uses utilities from task 13.

  **(a) Plugin structure validation tests** — Run `ClaudeCodeAdapter.generateConfig()` against a test project, then validate:
  - `validatePluginDir()` passes for the generated directory
  - All 8 subagent `.md` files exist in `agents/` with valid YAML frontmatter
  - No subagent file contains forbidden frontmatter fields (`hooks`, `mcpServers`, `permissionMode`)
  - All 3 skill files exist in `skills/` with valid YAML frontmatter and non-empty bodies
  - `hooks/hooks.json` passes `validateHooksJson()` with all 8 hook registrations present
  - All 7 hook scripts exist in `hooks/` as `.mjs` files
  - `settings.json` contains `{ "agent": "loom" }`
  - `.claude-plugin/plugin.json` has `name`, `version`, `description` fields

  **(b) Hook stdin/stdout protocol tests** — For each hook script:
  - `pre-tool-use.mjs`: normal tool → exit 0; Pattern agent writing `.ts` file → exit 2 + JSON with `permissionDecision: "deny"`; Pattern agent writing `.md` in `.weave/` → exit 0
  - `on-stop.mjs`: non-tapestry agent → exit 0 (guard fires correctly); no active plan → exit 0; active plan with remaining Tapestry tasks → exit 2 + JSON with `decision: "block"` and continuation prompt; completed plan → exit 0; paused plan → exit 0
  - `post-compact.mjs`: no active plan → exit 0, no stdout; active plan → exit 0 + stdout contains `additionalContext` with plan name and next task
  - `pre-compact.mjs`: always exit 0; `.weave/compaction-snapshot.json` written
  - `user-prompt-submit.mjs`: `/start-work` message → stdout contains work context injection; plain message → exit 0
  - Malformed JSON on stdin → graceful error (exit 1), not crash

  **(c) Compaction round-trip test** — Create test project with active plan. Run `pre-compact.mjs`, verify snapshot written. Run `post-compact.mjs`, verify `additionalContext` includes correct plan name, progress counts, next task name.

  **(d) Tapestry-only guard test** — Run `on-stop.mjs` with `agent_name: "loom"` → exit 0 (no continuation). Run with `agent_name: "pattern"` → exit 0. Run with `agent_name: "tapestry"` and active plan → exit 2.

  **Files**:
    - Create `src/adapters/claude-code/plugin-structure.test.ts`
    - Create `src/adapters/claude-code/hooks-integration.test.ts`
    - Create `src/adapters/claude-code/compaction.test.ts`
    - Create `src/adapters/claude-code/fixtures/` — sample hook payloads per hook type
  **Acceptance**: All tests pass with `bun test`. No Claude Code binary or API key required.

### Phase 4: Copilot CLI Adapter (Future Work)

- [ ] 20. **Implement CopilotCLIAdapter**
  **What**: Implement `CLIAdapter` for Copilot CLI. `mapAgent()` generates markdown agent file content. `generateConfig()` produces `.github/agents/*.md` files and MCP config.
  **Files**:
    - Create `src/adapters/copilot-cli/index.ts`
    - Create `src/adapters/copilot-cli/agent-mapper.ts`
    - Create `src/adapters/copilot-cli/config-generator.ts`
    - Create `src/adapters/copilot-cli/index.test.ts`
  **Acceptance**: `generateConfig()` produces valid `.github/agents/*.md` files.

- [ ] 21. **Build Weave MCP server for Copilot CLI**
  **What**: Create an MCP server that exposes Weave commands as MCP tools. This runs as a stdio server that Copilot CLI connects to. Implements: `weave_start_work`, `weave_run_workflow`, `weave_check_progress` (with `shouldContinue` flag), `weave_pause_work`, `weave_metrics`.
  **Files**:
    - Create `src/adapters/copilot-cli/mcp-server.ts`
    - Create `src/adapters/copilot-cli/mcp-tools.ts`
    - Create `src/adapters/copilot-cli/mcp-server.test.ts`
    - Modify `package.json` — add `bin` entry for `weave mcp-server`
  **Acceptance**: MCP server starts, responds to tool list requests, and executes `weave_start_work` correctly. `weave_check_progress` returns `shouldContinue` flag.

- [ ] 22. **Copilot CLI agent markdown and instructions generation**
  **What**: Generate markdown files for `.github/agents/` with proper frontmatter and complete agent prompts, including instructions about available MCP tools and agent cross-references. Generate or append `.github/copilot-instructions.md` Weave section.
  **Files**:
    - Modify `src/adapters/copilot-cli/agent-mapper.ts`
    - Create `src/adapters/copilot-cli/agent-mapper.test.ts`
    - Modify `src/adapters/copilot-cli/config-generator.ts`
  **Acceptance**: Generated agents include proper frontmatter, full prompts, MCP tool references. Instructions file accurately describes the Weave agent system.

- [ ] 23. **Copilot CLI adapter integration tests (Layer 1)**
  **What**: Write integration tests without Copilot CLI installed. Uses `mcpTestClient()` and `createTestProject()` from task 13.

  **(a) MCP server protocol tests** — `tools/list` returns all 5 expected tools; `weave_check_progress` returns correct task counts and `shouldContinue`; `weave_pause_work` sets paused flag; safety signals tested (completed/paused/stale → `shouldContinue: false`).

  **(b) Generated config validation tests** — All 8 `.github/agents/*.md` files have valid frontmatter; MCP config JSON has valid `weave` server entry.

  **Files**:
    - Create `src/adapters/copilot-cli/mcp-integration.test.ts`
    - Create `src/adapters/copilot-cli/config-validation.test.ts`
    - Create `src/adapters/copilot-cli/fixtures/`
  **Acceptance**: All tests pass with `bun test`. No Copilot CLI binary or API key required.

### Phase 5: Polish & Multi-CLI Coexistence

- [ ] 24. **Multi-CLI coexistence testing**
  **What**: Test that `weave init --cli all` generates configs for all three CLIs simultaneously without conflicts. Verify that `.weave/` state is shared correctly. Test generated configs don't overwrite each other.
  **Files**:
    - Create `src/adapters/coexistence.test.ts`
    - Modify `src/cli/init.ts` — support `--cli all`
  **Acceptance**: All three CLI configs can coexist. Plan state is shared. No config conflicts.

- [ ] 25. **Package exports for adapters**
  **What**: Update `package.json` exports to expose core and adapter modules separately.
  **Files**:
    - Modify `package.json` — add exports for `./core`, `./adapters/opencode`, `./adapters/claude-code`, `./adapters/copilot-cli`
    - Modify `tsconfig.json` — ensure declaration generation covers new paths
  **Acceptance**: `import { createWeaveCore } from '@opencode_weave/weave/core'` works.

- [ ] 26. **Feature degradation documentation**
  **What**: Each adapter implements `getDegradationReport()` that returns a structured list of features with their support status. The `weave init` command displays this after generating config.
  **Files**:
    - Modify each adapter's `index.ts` — implement `getDegradationReport()`
    - Modify `src/cli/init.ts` — display degradation report
  **Acceptance**: `weave init --cli copilot-cli` shows which features are unavailable and suggests workarounds. `weave init --cli claude-code` shows `compactionHooks: full` (improvement over OpenCode).

- [ ] 27. **`weave init` re-run UX improvements**
  **What**: Improve `weave init` to detect an existing generated directory and offer a clean regeneration path. When `weave-claude-plugin/` already exists, print a diff summary of what changed (agents added/removed, hooks updated). After regeneration, print the reinstall reminder. Add a `--force` flag to overwrite without prompting.
  **Files**:
    - Modify `src/cli/init.ts` — detect existing plugin dir, show diff summary, `--force` flag
  **Acceptance**: `weave init --cli claude-code` on an existing plugin dir shows what changed and prints the reinstall reminder. `--force` skips the diff prompt.

- [ ] 28. **CLI smoke tests (Layer 2 — requires real CLIs + API keys)**
  **What**: End-to-end smoke tests gated behind `RUN_SMOKE_TESTS=true`. Each uses cheapest possible model and minimal turns.

  **(a) OpenCode smoke test** — Run `opencode run --format json "respond with just OK"` in temp project with Weave plugin. Assert: `.weave/analytics/session-summaries.jsonl` written (plugin loaded + analytics hook fired).

  **(b) Claude Code smoke test** — Run `claude -p "respond with just OK" --output-format json --max-turns 1 --plugin-dir ./weave-claude-plugin` in temp project. Assert: `on-session-start.mjs` breadcrumb file written to `.weave/smoke-test-marker`.

  **(c) Copilot CLI smoke test** — Run `copilot -p "@loom respond with just OK" --allow-all-tools` in temp project with `.github/agents/` and MCP config. Assert: process exits 0, output non-empty.

  **(d) Cross-CLI state sharing (Layer 3)** — Start plan via OpenCode, verify `.weave/state.json` exists, then run Claude Code with `--plugin-dir ./weave-claude-plugin` and query plan progress, verify it reads same state.

  **Files**:
    - Create `src/adapters/smoke-tests/opencode.smoke.test.ts`
    - Create `src/adapters/smoke-tests/claude-code.smoke.test.ts`
    - Create `src/adapters/smoke-tests/copilot-cli.smoke.test.ts`
    - Create `src/adapters/smoke-tests/cross-cli.smoke.test.ts`
    - Create `src/adapters/smoke-tests/fixtures/smoke-test-plan.md` — minimal 2-task plan
    - Create `src/adapters/smoke-tests/helpers.ts`
  **Acceptance**: All smoke tests pass when `RUN_SMOKE_TESTS=true` + CLI installed + API keys valid. Skipped (not failed) when `RUN_SMOKE_TESTS` unset. Each costs < $0.05 per run.

---

## "Add a Feature" Walkthrough

### Adding a New Agent

1. Define the agent in `src/agents/{name}/default.ts` (prompt, metadata, permissions)
2. Register it in `src/agents/builtin-agents.ts`
3. Run `weave init --cli claude-code` — the adapter calls `mapAgent()` for each agent in core, generating a new `agents/{name}.md` automatically
4. Reinstall: `/plugin install ./weave-claude-plugin`

No sync command needed. No separate Claude Code–specific agent file to maintain. The static `.md` file is a direct projection of the agent definition at init time.

### Adding a New Hook Event

1. Add the new event to `WeaveHookEvent` in `src/core/types.ts`
2. Add handler logic to `WeaveCoreInstance` (e.g., `handleNewEvent(sessionId): Result`)
3. **Every adapter's `mapHook()` will now produce a compile error** because it must be an exhaustive switch over `WeaveHookEvent`. Fix each adapter:
   - `OpenCodeAdapter.mapHook()` — map to the appropriate OpenCode hook or return null + add to degradation report
   - `ClaudeCodeAdapter.mapHook()` — map to a Claude Code hook event or return null
   - `CopilotCLIAdapter.mapHook()` — almost certainly returns null (add to degradation report)
4. If the Claude Code adapter maps it to a new hook, add the script to `hooks/` templates and add an entry to `hooks/hooks.json` generation
5. Run `weave init --cli claude-code` — new hook script and hooks.json entry generated automatically
6. Reinstall: `/plugin install ./weave-claude-plugin`

The exhaustive `mapHook()` switch is the compile-time safety net: no new `WeaveHookEvent` can be silently dropped by any adapter.

### Adding a New Command (Skill)

1. Add `WeaveCommandDefinition` to `src/features/builtin-commands/commands.ts` — set `name`, `description`, `agent`, and `template`
2. Run `weave init --cli claude-code` — the adapter calls `mapCommand()` which reads `command.template` at generation time and writes `skills/{name}/SKILL.md`
3. The skill is immediately available as `/weave:{name}` after reinstall

---

## Verification

### Layer 0: Existing Tests (regression)
- [ ] All existing tests pass (`bun test`) — zero regression
- [ ] TypeScript compiles cleanly (`bun run typecheck`)
- [ ] OpenCode integration is byte-for-byte identical behavior

### Layer 1: Adapter Integration Tests (no CLI, no API key)

**Claude Code Plugin:**
- [ ] `ClaudeCodeAdapter.generateConfig()` produces a directory passing full `validatePluginDir()` check
- [ ] All 8 subagent `.md` files have valid YAML frontmatter with no forbidden fields (`hooks`, `mcpServers`, `permissionMode`)
- [ ] `hooks/hooks.json` has all 8 hook registrations (PreToolUse, PostToolUse, UserPromptSubmit, Stop, SubagentStop[tapestry], SessionStart, PreCompact, PostCompact)
- [ ] All `hooks/*.mjs` scripts are valid Node.js ESM
- [ ] `pre-tool-use.mjs`: exits 2 + `permissionDecision: "deny"` when Pattern writes non-.md file; exits 0 for Pattern writing `.md` in `.weave/`
- [ ] `on-stop.mjs`: exits 0 for non-tapestry agents (uses `core.isContinuationAgent()` — not hardcoded); exits 2 with continuation prompt when tapestry has remaining tasks; exits 0 when plan complete or paused; exits 0 when stale (3 cycles)
- [ ] `pre-compact.mjs`: always exits 0; writes `.weave/compaction-snapshot.json`
- [ ] `post-compact.mjs`: exits 0 + outputs `additionalContext` with correct plan name, progress, next task when plan active; exits 0, no stdout when no active plan
- [ ] `user-prompt-submit.mjs`: injects work context for `/start-work` messages; exits 0 for plain messages
- [ ] All hook scripts handle malformed JSON input gracefully (exit 1, not crash)
- [ ] `settings.json` contains `{ "agent": "loom" }`
- [ ] `.claude-plugin/plugin.json` has all required fields including version
- [ ] Skills `start-work/SKILL.md`, `plan/SKILL.md`, `metrics/SKILL.md` have valid frontmatter + non-empty bodies derived from `WeaveCommandDefinition.template` (not hardcoded strings)
- [ ] Compaction round-trip: `pre-compact` → snapshot → `post-compact` → correct `additionalContext`

**Copilot CLI (future):**
- [ ] Copilot MCP server `tools/list` returns all 5 expected tools with valid JSON Schemas
- [ ] Copilot MCP server `weave_check_progress` returns correct task counts + `shouldContinue` flag
- [ ] Copilot MCP server `weave_pause_work` sets paused flag in state.json
- [ ] All `.github/agents/*.md` files have valid frontmatter and non-empty prompts (all 8 agents)
- [ ] MCP config JSON has valid `weave` server entry

**General:**
- [ ] All adapter `generateConfig()` outputs can be round-tripped (generate → validate → no errors)
- [ ] `weave init --cli all` generates all three CLI configs without conflicts in same directory
- [ ] No `@opencode-ai/plugin` or `@opencode-ai/sdk` imports in `src/core/`
- [ ] `core.isContinuationAgent("tapestry")` returns true; `core.isContinuationAgent("loom")` returns false
- [ ] All hook scripts call `core.isContinuationAgent()` rather than hardcoding agent name strings
- [ ] All adapter `mapHook()` implementations are exhaustive switches over `WeaveHookEvent` (no implicit fall-through)

### Layer 2: CLI Smoke Tests (requires real CLIs + API keys)
- [ ] `RUN_SMOKE_TESTS=true` — OpenCode loads Weave plugin and writes analytics
- [ ] `RUN_SMOKE_TESTS=true` — Claude Code fires `SessionStart` hook and writes breadcrumb marker when `--plugin-dir ./weave-claude-plugin` used
- [ ] `RUN_SMOKE_TESTS=true` — Claude Code `pre-tool-use.mjs` hook is invoked (verify via hook output log or breadcrumb)
- [ ] `RUN_SMOKE_TESTS=true` — Copilot CLI discovers agents and connects to MCP server
- [ ] `RUN_SMOKE_TESTS=true` — Cross-CLI state: plan started in OpenCode is readable from Claude Code session

### General
- [ ] `.weave/` state directory is shared across all CLIs (plan started in one CLI, continued in another)
- [ ] Config loader accepts parameterized paths for all CLIs
- [ ] Each adapter's `getDegradationReport()` is accurate and complete
- [ ] `weave init --cli claude-code` prints plugin install instructions after generation
- [ ] Re-running `weave init --cli claude-code` on an existing plugin dir shows a change summary and reinstall reminder
