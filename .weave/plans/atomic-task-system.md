# Atomic Task System — Replace todowrite with Atomic Task Tools

## TL;DR
> **Summary**: Replace Weave's fragile `todowrite` (full-replacement array) with four atomic task tools (`task_create`, `task_update`, `task_list`, `task_get`) that sync to OpenCode's todo sidebar via merge logic. Kill the `FINALIZE_TODOS_MARKER` safety net, block direct `todowrite` access, add a gentle task reminder hook, and simplify all prompt instructions.
> **Estimated Effort**: Large

## Context

### Original Request
The current `todowrite` tool is destructive — every call sends the entire array, and if the AI forgets an item, it's silently destroyed. A finalize callback in `plugin-interface.ts` (lines 499-539) wastes tokens by injecting prompts when sessions go idle with `in_progress` todos. Prompt instructions (~30 lines per agent) try to compensate for the tool's broken design. OmO (oh-my-openagent) solved this with atomic task tools that sync to the sidebar via merge logic.

### Key Findings

**1. Weave's architecture differs fundamentally from OmO:**
- Weave registers **zero custom tools** — `createTools()` in `src/create-tools.ts` returns `tools: {}`. All tools come from OpenCode built-ins.
- The plugin SDK's `Hooks.tool` property (`{ [key: string]: ToolDefinition }`) is how plugins register custom tools with OpenCode. Weave already has the plumbing (`PluginInterface.tool` → returned via `createPluginInterface`).
- The `@opencode-ai/plugin/tool` module exports `tool()` and `tool.schema` (zod) for defining tools.

**2. OpenCode's todo system:**
- `todowrite` is a **built-in OpenCode tool** exposed to the LLM. It takes a full array and replaces all todos.
- `client.session.todo({ path: { id: sessionID } })` is a **read-only** SDK method returning `Array<Todo>` where `Todo = { id, content, status, priority }`.
- There is **no SDK write method** for todos. OmO uses a dynamic import of `"opencode/session/todo"` to resolve `Todo.update` (a Bun-internal module). This same approach works for Weave since both run as OpenCode plugins.

**3. The finalize callback (lines 499-539 of `plugin-interface.ts`):**
- Fires on `session.idle` when no continuation was injected.
- Reads all todos via `client.session.todo()`, checks for `in_progress` items.
- Injects a one-shot prompt telling the agent to `todowrite` everything to completed.
- Guarded by `todoFinalizedSessions` (Set) and re-armed when real user messages arrive (line 183).
- With atomic task tools, this entire mechanism becomes unnecessary — `task_update` handles individual status transitions.

**4. Files referencing `todowrite` in prompts (all must be updated):**

| File | Location | What it says |
|------|----------|-------------|
| `src/agents/loom/prompt-composer.ts` | `buildDisciplineSection()` line 34 | "2+ steps → todowrite FIRST" |
| `src/agents/loom/prompt-composer.ts` | `buildSidebarTodosSection()` lines 43-72 | Full 30-line `<SidebarTodos>` block |
| `src/agents/loom/prompt-composer.ts` | `buildDelegationNarrationSection()` line 140 | "todowrite call MUST appear BEFORE" |
| `src/agents/tapestry/prompt-composer.ts` | `buildTapestrySidebarTodosSection()` lines 37-72 | Full 36-line `<SidebarTodos>` block |
| `src/hooks/start-work-hook.ts` | `buildFreshContext()` line 310, `buildResumeContext()` line 333 | "use todowrite to populate/restore the sidebar" |
| `src/hooks/work-continuation.ts` | `checkContinuation()` line 90 | "Use todowrite to restore sidebar" |
| `src/hooks/context-window-monitor.ts` | `buildWarningMessage()` line 46, `buildRecoveryMessage()` line 59 | "use todowrite to create a todo" |

**5. OmO's approach (reference architecture):**
- **File-based storage**: Each task is a JSON file (`T-{uuid}.json`) in a config-relative directory, with file-level locking (`acquireLock`). This provides durability and cross-session visibility.
- **Merge sync**: `syncTaskTodoUpdate()` reads current todos, removes the matching todo, pushes the updated version, then writes via `Todo.update`. Non-task todos (manually added by the user) are preserved.
- **todowrite disabler**: `tool.execute.before` hook throws an `Error` with a redirect message when `todowrite` or `todoread` is called while task system is enabled.
- **Task reminder**: `tool.execute.after` hook counts non-task tool calls per session, appends a reminder to tool output after 10 consecutive calls without task tool usage.

**6. Config gating in OmO:**
- Task system is behind `experimental.task_system` (boolean). When false, task tools aren't registered and `todowrite` is not blocked.
- Weave should adopt the same pattern for safe rollout.

## Design Decisions

### D1: Storage — File-based (like OmO) vs. in-memory
**Decision: File-based, following OmO's pattern.**
- File storage survives process restarts and is visible to multiple sessions.
- The task directory lives under the OpenCode config dir (e.g., `~/.config/opencode/tasks/{project-slug}/`).
- Adapt OmO's `storage.ts` (atomic writes, file locking, UUID-based IDs).
- The `getTaskDir()` logic should use `ctx.directory` (project path) to derive a stable project slug.

### D2: Source of truth — Task files vs. OpenCode todo API
**Decision: Task files are the source of truth; OpenCode's todo sidebar is a projection.**
- Task tools read/write JSON files. After each mutation, sync to the sidebar via `Todo.update`.
- The sidebar is a view — it reflects task state but does not own it.
- This matches OmO's architecture exactly.

### D3: Tool registration — Custom tools via plugin `tool` property
**Decision: Register task tools in `createTools()` and return them via `PluginInterface.tool`.**
- Weave's `createTools()` currently returns `tools: {}`. Add task tool definitions here.
- The `PluginInterface.tool` property is already wired to the plugin return value.
- Tools are gated by a new `experimental.task_system` config flag.

### D4: Schema simplification — Full OmO schema vs. simplified
**Decision: Start with a simplified schema, add fields as needed.**
- Core fields: `id`, `subject`, `description`, `status`, `threadID`
- Keep `blockedBy`/`blocks` for future parallel execution support
- Drop `activeForm`, `owner`, `repoURL`, `parentID` initially (can be added later)
- Keep `metadata` as an escape hatch

### D5: Feature flag approach
**Decision: Use `experimental.task_system` in `weave.json`, defaulting to `false`.**
- When `false`: no task tools registered, todowrite not blocked, finalize callback active.
- When `true`: task tools registered, todowrite blocked, finalize callback skipped, simplified prompts injected.
- This allows gradual rollout and easy rollback.

### D6: Todo sync — Bun internal module vs. SDK
**Decision: Use `"opencode/session/todo"` dynamic import (same as OmO).**
- The SDK has no write method for todos.
- The Bun-internal `opencode/session/todo` module provides `Todo.update` which accepts `{ sessionID, todos }`.
- This is the same approach OmO uses and it works reliably in production.

## Objectives

### Core Objective
Replace the destructive `todowrite` tool with atomic task operations that sync to OpenCode's sidebar, eliminating data loss, the finalize callback, and verbose prompt instructions.

### Deliverables
- [ ] Four atomic task tools: `task_create`, `task_update`, `task_list`, `task_get`
- [ ] File-based task storage with atomic writes and locking
- [ ] Todo sync layer that projects task state to OpenCode's sidebar
- [ ] `todowrite` disabler hook that blocks direct access when task system is active
- [ ] Task reminder hook that nudges agents after N tool calls without task usage
- [ ] Simplified prompt instructions across all agents and hooks
- [ ] `experimental.task_system` config flag for safe rollout
- [ ] Removal of the `FINALIZE_TODOS_MARKER` finalize callback (gated behind feature flag)
- [ ] Tests for all new modules

### Definition of Done
- [ ] `bun test` passes with no regressions
- [ ] `bun run build` succeeds (if applicable)
- [ ] Task tools are registered when `experimental.task_system: true`
- [ ] `todowrite` throws error when task system is active
- [ ] Creating/updating a task updates the sidebar
- [ ] Finalize callback is skipped when task system is active
- [ ] Prompt instructions reference task tools (not todowrite) when task system is active

### Guardrails (Must NOT)
- Must NOT break existing behavior when `experimental.task_system` is `false` (default)
- Must NOT remove `todowrite` from `KNOWN_TOOL_NAMES` — it remains a valid tool when task system is off
- Must NOT introduce new npm dependencies (zod is already available via `@opencode-ai/plugin`)
- Must NOT change the OpenCode SDK or plugin framework
- Must NOT modify any files outside `src/` and `test/`

## TODOs

### Phase 1: Foundation — Task storage and types

- [ ] 1. Create task types and schemas
  **What**: Define the `TaskObject` schema, status enum, and input schemas for create/update/list/get operations. Simplified from OmO (drop `activeForm`, `owner`, `repoURL`, `parentID` initially).
  **Files**: Create `src/features/task-system/types.ts`
  **Acceptance**: Types compile, schema validates a minimal task object `{ id, subject, description, status, threadID, blocks, blockedBy, metadata }`

- [ ] 2. Create file-based task storage
  **What**: Adapt OmO's `storage.ts` for Weave. Implement `getTaskDir()` (using project directory slug), `readJsonSafe()`, `writeJsonAtomic()`, `acquireLock()`, `generateTaskId()`, `listTaskFiles()`, `ensureDir()`. The task directory should default to `{opencode-config-dir}/tasks/{project-slug}/`.
  **Files**: Create `src/features/task-system/storage.ts`
  **Acceptance**: Unit tests verify atomic write, lock acquire/release, stale lock recovery, task ID format (`T-{uuid}`)

- [ ] 3. Create todo sync layer
  **What**: Adapt OmO's `todo-sync.ts`. Implement `syncTaskToTodo()` (maps task → todo), `syncTaskTodoUpdate()` (reads current todos, removes matching, pushes updated, writes via `Todo.update`), and `syncAllTasksToTodos()` (bulk sync). Use dynamic import of `"opencode/session/todo"` for the writer.
  **Files**: Create `src/features/task-system/todo-sync.ts`
  **Acceptance**: Unit tests verify status mapping (pending→pending, in_progress→in_progress, completed→completed, deleted→removed), merge logic preserves non-task todos, handles missing writer gracefully

### Phase 2: Task tools

- [ ] 4. Create `task_create` tool
  **What**: Tool that creates a single task with auto-generated ID, writes to file storage, syncs to sidebar. Accepts `subject` (required), `description`, `blockedBy`, `blocks`, `metadata`. Returns `{ task: { id, subject } }`.
  **Files**: Create `src/features/task-system/tools/task-create.ts`
  **Acceptance**: Unit test creates a task, verifies file written, verifies sync called

- [ ] 5. Create `task_update` tool
  **What**: Tool that updates a single task by ID. Supports updating `subject`, `description`, `status`, `addBlocks`, `addBlockedBy`, `metadata` (merge semantics, null deletes). Syncs to sidebar after update. Returns `{ task: <updated object> }`.
  **Files**: Create `src/features/task-system/tools/task-update.ts`
  **Acceptance**: Unit test updates status, verifies file updated, verifies sync called

- [ ] 6. Create `task_list` tool
  **What**: Read-only tool listing active tasks (excludes completed and deleted). For each task's `blockedBy`, filters to only show unresolved blockers. Returns summary format: `{ tasks: [{ id, subject, status, blockedBy }] }`.
  **Files**: Create `src/features/task-system/tools/task-list.ts`
  **Acceptance**: Unit test lists tasks, verifies filtering, verifies blocker resolution

- [ ] 7. Create `task_get` tool
  **What**: Read-only tool that retrieves a single task by ID. Returns full task object or `null`.
  **Files**: Create `src/features/task-system/tools/task-get.ts`
  **Acceptance**: Unit test retrieves task, verifies full object returned, handles missing task

- [ ] 8. Create task tools index and registration
  **What**: Create barrel export for task tools. Wire into `createTools()` so tools are conditionally registered when `experimental.task_system` is true. Add the feature flag to `ExperimentalConfigSchema`.
  **Files**:
  - Create `src/features/task-system/tools/index.ts` (barrel)
  - Create `src/features/task-system/index.ts` (barrel)
  - Modify `src/create-tools.ts` — conditionally create and return task tools
  - Modify `src/config/schema.ts` — add `task_system: z.boolean().optional()` to `ExperimentalConfigSchema`
  **Acceptance**: When `experimental.task_system: true`, tools appear in `PluginInterface.tool`. When false (default), no task tools registered.

- [ ] 9. Add `task_create`, `task_update`, `task_list`, `task_get` to KNOWN_TOOL_NAMES
  **What**: Update the `KNOWN_TOOL_NAMES` set in `custom-agent-factory.ts` so custom agents can grant/deny task tools.
  **Files**: Modify `src/agents/custom-agent-factory.ts` — add 4 new names to the set
  **Acceptance**: Custom agent configs can reference task tools without validation errors

### Phase 3: Kill the finalize callback

- [ ] 10. Gate the finalize callback behind feature flag
  **What**: When `experimental.task_system` is true, skip the entire finalize block (lines 499-539 in `plugin-interface.ts`). The `todoFinalizedSessions` Set, `FINALIZE_TODOS_MARKER` constant, and the re-arm guard in `chat.message` (line 183) should all be conditional. Pass the feature flag through to `createPluginInterface`.
  **Files**:
  - Modify `src/plugin/plugin-interface.ts` — wrap finalize block in `!taskSystemEnabled` check, pass flag via args
  - Modify `src/index.ts` — pass `experimental.task_system` flag through to `createPluginInterface`
  **Acceptance**: With `task_system: true`, `session.idle` does not inject finalize prompts. With `task_system: false`, behavior is unchanged.

- [ ] 11. Clean up finalize-related guards in chat.message
  **What**: The `FINALIZE_TODOS_MARKER` check on line 183 (`!userText.includes(FINALIZE_TODOS_MARKER)`) and line 239 (`isTodoFinalize`) should be skipped when task system is active (there will be no finalize markers to detect).
  **Files**: Modify `src/plugin/plugin-interface.ts`
  **Acceptance**: No functional change to non-task-system paths; cleaner code when task system is active

### Phase 4: Block direct todowrite access

- [ ] 12. Create todowrite disabler hook
  **What**: A `tool.execute.before` hook that throws an Error with a redirect message when the AI calls `todowrite` while `task_system` is enabled. The error message instructs the AI to use `task_create`/`task_update` instead. Modeled on OmO's `tasks-todowrite-disabler`.
  **Files**: Create `src/hooks/todowrite-disabler.ts`
  **Acceptance**: Unit test verifies `todowrite` throws with redirect message when task system active; passes through when inactive

- [ ] 13. Wire todowrite disabler into plugin interface
  **What**: Add the disabler hook logic to `tool.execute.before` in `plugin-interface.ts`. Only active when `experimental.task_system` is true.
  **Files**: Modify `src/plugin/plugin-interface.ts` — add check in `tool.execute.before`
  **Acceptance**: Calling `todowrite` via the AI returns an error with instructions to use task tools

### Phase 5: Task reminder hook

- [ ] 14. Create task reminder hook
  **What**: A `tool.execute.after` hook that counts non-task tool calls per session. After 10 consecutive calls without `task_create`, `task_update`, `task_list`, or `task_get`, appends a gentle reminder to the tool output: "The task tools haven't been used recently. If you're tracking work, use task_create/task_update to record progress." Resets counter on task tool use or session deletion.
  **Files**: Create `src/hooks/task-reminder.ts`
  **Acceptance**: Unit test verifies counter increments, reminder fires at threshold, counter resets on task tool use

- [ ] 15. Wire task reminder into plugin interface
  **What**: Integrate the task reminder hook into `tool.execute.after` in `plugin-interface.ts`. Only active when `experimental.task_system` is true.
  **Files**: Modify `src/plugin/plugin-interface.ts` — add reminder logic in `tool.execute.after`
  **Acceptance**: Tool outputs include reminder after threshold; no effect when task system is off

### Phase 6: Simplify prompt instructions

- [ ] 16. Simplify Loom's sidebar todo instructions
  **What**: Replace the 30-line `<SidebarTodos>` block and `<Discipline>` todowrite references with concise task tool instructions (~8-10 lines). The tool design enforces correctness, so prompts only need to explain the workflow: create tasks before starting work, update status as you go. Gate this behind the task system flag — when flag is off, keep original prompts.
  **Files**: 
  - Modify `src/agents/loom/prompt-composer.ts` — modify `buildDisciplineSection()`, `buildSidebarTodosSection()`, and `buildDelegationNarrationSection()` to accept a `taskSystemEnabled` parameter
  - Modify `src/agents/loom/prompt-composer.ts` — update `composeLoomPrompt()` signature and `LoomPromptOptions` to include `taskSystemEnabled`
  **Acceptance**: With task system on, prompt mentions `task_create`/`task_update` not `todowrite`. With task system off, prompts unchanged. Tests updated.

- [ ] 17. Simplify Tapestry's sidebar todo instructions
  **What**: Same as Loom — replace `<SidebarTodos>` and `<Discipline>` todowrite references with concise task tool instructions. Gate behind feature flag.
  **Files**:
  - Modify `src/agents/tapestry/prompt-composer.ts` — modify `buildTapestryDisciplineSection()`, `buildTapestrySidebarTodosSection()` to accept `taskSystemEnabled` parameter
  - Modify `src/agents/tapestry/prompt-composer.ts` — update `composeTapestryPrompt()` signature and `TapestryPromptOptions`
  **Acceptance**: With task system on, prompt mentions `task_create`/`task_update` not `todowrite`. With task system off, prompts unchanged. Tests updated.

- [ ] 18. Update hook prompts to reference task tools
  **What**: Update `todowrite` references in `start-work-hook.ts`, `work-continuation.ts`, and `context-window-monitor.ts` to reference task tools when the system is active. These functions need a `taskSystemEnabled` parameter or equivalent.
  **Files**:
  - Modify `src/hooks/start-work-hook.ts` — `buildFreshContext()` and `buildResumeContext()` to conditionally reference task tools
  - Modify `src/hooks/work-continuation.ts` — `checkContinuation()` prompt to reference task tools
  - Modify `src/hooks/context-window-monitor.ts` — `buildWarningMessage()` and `buildRecoveryMessage()` to reference task tools
  **Acceptance**: When task system is active, injected prompts say "use task_create/task_update" instead of "use todowrite"

- [ ] 19. Update tests for modified prompt composers
  **What**: Update all test files that assert on `todowrite` or `SidebarTodos` content to handle both modes (task system on and off).
  **Files**:
  - Modify `src/agents/loom/prompt-composer.test.ts`
  - Modify `src/agents/tapestry/prompt-composer.test.ts`
  - Modify `src/hooks/work-continuation.test.ts`
  - Modify `src/hooks/context-window-monitor.test.ts`
  **Acceptance**: All tests pass for both `taskSystemEnabled: true` and `taskSystemEnabled: false` configurations

### Phase 7: Integration tests

- [ ] 20. End-to-end integration test for task lifecycle
  **What**: Test the full flow: create task → list tasks (verify it appears) → update status to `in_progress` → update status to `completed` → list tasks (verify it's gone from active list) → get task (verify completed status). Mock the todo writer to verify sync calls.
  **Files**: Create `src/features/task-system/integration.test.ts`
  **Acceptance**: Full lifecycle passes; sync called on each mutation; sidebar state correct at each step

- [ ] 21. Test todowrite disabler + task tools coexistence
  **What**: Test that when task system is enabled, `todowrite` throws with redirect message, and task tools function correctly in the same session.
  **Files**: Create `src/hooks/todowrite-disabler.test.ts`
  **Acceptance**: `todowrite` blocked; task tools work; message includes `task_create` instructions

## Risk Assessment

### R1: `opencode/session/todo` module availability (HIGH)
**Risk**: The `"opencode/session/todo"` dynamic import is a Bun-internal module within OpenCode. If OpenCode changes this internal API, sync breaks.
**Mitigation**: The `resolveTodoWriter()` function handles import failure gracefully (returns null, task tools still work — just no sidebar sync). OmO has been using this in production successfully. Add a health check log on startup.

### R2: Feature flag complexity (MEDIUM)
**Risk**: The feature flag creates two code paths across 10+ files, increasing maintenance burden.
**Mitigation**: Design each conditional as a simple `if (taskSystemEnabled)` gate, not deep branching. Once the task system is validated, remove the flag and legacy code in a follow-up.

### R3: File locking under concurrent sessions (MEDIUM)
**Risk**: Multiple sessions writing to the same task file simultaneously could cause data loss despite file locking.
**Mitigation**: OmO's `acquireLock()` uses `flag: "wx"` (exclusive create) for the lock file, with stale lock recovery (30s timeout). This is battle-tested. Task IDs are UUIDs so create operations never conflict.

### R4: Prompt instruction drift (LOW)
**Risk**: New agents or hooks added in the future might reference `todowrite` instead of task tools.
**Mitigation**: The `todowrite` disabler acts as a safety net — any errant `todowrite` call gets a clear error message. Add a code comment in the prompt composers noting the two modes.

### R5: Task file accumulation (LOW)
**Risk**: Completed/deleted tasks accumulate as files on disk forever.
**Mitigation**: Not addressed in this plan. A future cleanup mechanism (TTL, max files) can be added. Individual task files are tiny (~200 bytes).

### R6: Breaking existing workflows (LOW)
**Risk**: Changing prompt instructions could confuse fine-tuned models or cached system prompts.
**Mitigation**: The feature flag defaults to `false`. Users must opt in. When they do, the todowrite disabler's error message provides clear instructions for the AI to self-correct.

## Verification
- [ ] `bun test` — all existing tests pass
- [ ] `bun test` — all new tests pass
- [ ] Manual test: set `experimental.task_system: true` in `weave.json`, start a session, verify task tools appear
- [ ] Manual test: create a task via the AI, verify it appears in sidebar
- [ ] Manual test: update a task to completed, verify sidebar updates
- [ ] Manual test: attempt `todowrite` with task system on, verify error message
- [ ] Manual test: set `experimental.task_system: false` (default), verify all existing behavior unchanged

## File Inventory

### New files (11)
```
src/features/task-system/types.ts
src/features/task-system/storage.ts
src/features/task-system/todo-sync.ts
src/features/task-system/tools/task-create.ts
src/features/task-system/tools/task-update.ts
src/features/task-system/tools/task-list.ts
src/features/task-system/tools/task-get.ts
src/features/task-system/tools/index.ts
src/features/task-system/index.ts
src/features/task-system/integration.test.ts
src/hooks/todowrite-disabler.ts
src/hooks/todowrite-disabler.test.ts
src/hooks/task-reminder.ts
```

### Modified files (11)
```
src/config/schema.ts                          — add task_system to ExperimentalConfigSchema
src/create-tools.ts                           — conditionally register task tools
src/index.ts                                  — pass task_system flag through
src/plugin/plugin-interface.ts                — gate finalize callback, add disabler + reminder hooks
src/agents/custom-agent-factory.ts            — add task tool names to KNOWN_TOOL_NAMES
src/agents/loom/prompt-composer.ts            — conditional task tool instructions
src/agents/tapestry/prompt-composer.ts        — conditional task tool instructions
src/hooks/start-work-hook.ts                  — conditional task tool references
src/hooks/work-continuation.ts                — conditional task tool references
src/hooks/context-window-monitor.ts           — conditional task tool references
src/hooks/create-hooks.ts                     — wire task system flag through to hooks
```

### Modified test files (4)
```
src/agents/loom/prompt-composer.test.ts
src/agents/tapestry/prompt-composer.test.ts
src/hooks/work-continuation.test.ts
src/hooks/context-window-monitor.test.ts
```
