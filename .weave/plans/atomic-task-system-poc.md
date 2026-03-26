# Atomic Task System — Proof of Concept

> See `.weave/plans/atomic-task-system.md` for the complete 21-task implementation plan.

## TL;DR
> **Summary**: Build the minimum viable task system (3 tools + storage + sync layer), kill the finalize callback, and prove with tests that atomic operations prevent todo list obliteration.
> **Estimated Effort**: Medium (subset of the Large full plan)

## What This Proves

The core hypothesis: **atomic per-item task operations prevent the todo obliteration problem that `todowrite` causes.**

Success looks like:
1. **A failing test** that documents the current failure mode: calling `todowrite` with a partial list destroys items not in the list.
2. **Passing tests** that prove `task_create` adds items without touching existing ones, `task_update` modifies one item without affecting others, and `task_list` returns accurate state.
3. **The sync layer merges** — it reads current todos, surgically replaces only the changed item, and writes back the full list. Non-task todos (manually added) survive intact.
4. **The finalize callback is gone** — no more `FINALIZE_TODOS_MARKER` injection, no more wasted tokens on idle sessions.

If these pass, we have confidence to invest in the remaining 12 tasks from the full plan.

## What This Defers

The following are **explicitly out of scope** for this PoC (covered by the full plan):

| Deferred Item | Full Plan Task # | Why Deferred |
|---|---|---|
| `task_get` tool | #7 | Nice-to-have, not needed to prove the hypothesis |
| `todowrite` disabler hook | #12, #13 | Requires the task system to be fully validated first |
| Task reminder hook | #14, #15 | Behavioral nudge, not structural correctness |
| Prompt simplification (all agents + hooks) | #16–#19 | Large surface area, depends on validated task tools |
| Integration tests (full lifecycle) | #20, #21 | PoC unit tests cover the critical path |

## Context

### Original Request
Prove the atomic task system hypothesis before committing to the full 21-task plan. Build just enough to run tests that demonstrate obliteration is prevented.

### Key Findings
All findings from the full plan apply. The critical ones for this PoC:

1. **Weave registers zero custom tools** — `createTools()` returns `tools: {}`. Task tools will be the first custom tools Weave registers via the plugin `tool` property.
2. **OmO's sync layer** (`todo-sync.ts`) reads current todos, filters out the changed item by ID, pushes the updated version, writes back. Non-task todos survive. This is the anti-obliteration mechanism.
3. **The finalize callback** (lines 499–539 of `plugin-interface.ts`) fires on `session.idle`, reads todos, injects a prompt to mark `in_progress` items complete. It wastes tokens and is unnecessary with atomic task operations.
4. **The `FINALIZE_TODOS_MARKER`** constant, `todoFinalizedSessions` Set, and the re-arm guard on line 183 of `plugin-interface.ts` are all part of the finalize machinery.
5. **The simplified schema** drops `activeForm`, `owner`, `repoURL`, `parentID` (per design decision D4 in the full plan). Core fields: `id`, `subject`, `description`, `status`, `threadID`, `blocks`, `blockedBy`, `metadata`.

## Objectives

### Core Objective
Validate that atomic task tools + merge-based sync prevent todo obliteration, with tests that prove it.

### Deliverables
- [x] Task types and zod schemas (`types.ts`)
- [x] File-based storage with atomic writes and locking (`storage.ts`)
- [x] Todo sync/merge layer (`todo-sync.ts`)
- [x] `task_create` tool
- [x] `task_update` tool
- [x] `task_list` tool
- [x] `experimental.task_system` config flag
- [x] Tool registration in `createTools()` behind the flag
- [x] `KNOWN_TOOL_NAMES` updated with task tool names
- [x] Finalize callback gated behind `!taskSystemEnabled`
- [x] Unit tests proving obliteration prevention
- [x] Unit tests for all three tools, storage, and sync layer

### Definition of Done
- [x] `bun test` passes with no regressions
- [x] `bun run build` succeeds
- [x] Task tools are registered when `experimental.task_system: true`
- [x] Creating a task does not destroy existing todos (test proves it)
- [x] Updating a task does not destroy unrelated todos (test proves it)
- [x] Finalize callback is skipped when task system is active
- [x] Default behavior (`task_system: false`) is completely unchanged

### Guardrails (Must NOT)
- Must NOT break existing behavior when `experimental.task_system` is `false` (default)
- Must NOT remove `todowrite` from `KNOWN_TOOL_NAMES` — it remains valid when task system is off
- Must NOT introduce new npm dependencies (zod is available via `@opencode-ai/plugin`)
- Must NOT change the OpenCode SDK or plugin framework
- Must NOT modify any files outside `src/` and `test/`
- Must NOT implement `task_get`, todowrite disabler, task reminder, or prompt changes (deferred)

## TODOs

### Scope 1: Build the Minimal Task System

- [x] 1. Create task types and schemas
  **What**: Define `TaskObject` schema (simplified from OmO — drop `activeForm`, `owner`, `repoURL`, `parentID`), `TaskStatus` enum, and input schemas for create/update/list operations. Use zod from `@opencode-ai/plugin`.
  **Files**: Create `src/features/task-system/types.ts`
  **Schema fields**: `id` (string), `subject` (string), `description` (string), `status` (TaskStatus), `threadID` (string), `blocks` (string[], default []), `blockedBy` (string[], default []), `metadata` (Record<string, unknown>, optional)
  **Input schemas**: `TaskCreateInputSchema` (subject required, description/blocks/blockedBy/metadata optional), `TaskUpdateInputSchema` (id required, subject/description/status/addBlocks/addBlockedBy/metadata optional), `TaskListInputSchema` (empty — no filter args needed for PoC)
  **Acceptance**: Types compile. `TaskObjectSchema.parse()` validates `{ id: "T-xxx", subject: "foo", description: "", status: "pending", threadID: "sess-1", blocks: [], blockedBy: [] }`.

- [x] 2. Create file-based task storage
  **What**: Adapt OmO's `storage.ts` for Weave. Implement `getTaskDir()` (derive project slug from `directory` param, store under `{opencode-config-dir}/tasks/{slug}/`), `readJsonSafe()`, `writeJsonAtomic()` (write to `.tmp` then rename), `acquireLock()` (exclusive create with `flag: "wx"`, 30s stale threshold), `generateTaskId()` (`T-{uuid}`), `listTaskFiles()`, `ensureDir()`.
  **Files**: Create `src/features/task-system/storage.ts`
  **Key differences from OmO**: `getTaskDir()` takes a `directory: string` param instead of reading from OmO's config object. Use `basename(directory)` sanitized as the project slug. No `ULTRAWORK_TASK_LIST_ID` / `CLAUDE_CODE_TASK_LIST_ID` env vars.
  **Acceptance**: Unit tests verify: atomic write (temp file removed on success), lock acquire/release, stale lock recovery (lock older than 30s is broken), task ID format matches `/^T-[a-f0-9-]+$/`, `readJsonSafe` returns null for missing/corrupt files.

- [x] 3. Create todo sync/merge layer
  **What**: Adapt OmO's `todo-sync.ts`. Implement `syncTaskToTodo()` (map Task → TodoInfo, deleted → null), `syncTaskTodoUpdate()` (read current todos, filter out matching item by ID, push updated item, write via `Todo.update`), `syncAllTasksToTodos()` (bulk sync preserving non-task todos). Use dynamic import of `"opencode/session/todo"` for the writer (same as OmO).
  **Files**: Create `src/features/task-system/todo-sync.ts`
  **Key behaviors**: Status mapping: pending→pending, in_progress→in_progress, completed→completed, deleted→removed (null). `todosMatch()` compares by `id` first, falls back to `content`. Non-task todos (no matching task ID) survive all operations. Writer failure is graceful (task still saved to file).
  **Acceptance**: Unit tests verify: status mapping for all 4 states, merge preserves non-task todos, deleted task is removed from todo list, duplicate prevention, graceful handling when writer is null.

- [x] 4. Create `task_create` tool
  **What**: Tool definition using `tool()` from `@opencode-ai/plugin/tool`. Accepts `subject` (required), `description`, `blockedBy`, `blocks`, `metadata`. Auto-generates `T-{uuid}` ID, records `context.sessionID` as `threadID`, sets status to `"pending"`. Writes to file storage, syncs to sidebar. Returns `{ task: { id, subject } }`.
  **Files**: Create `src/features/task-system/tools/task-create.ts`
  **Acceptance**: Unit test: creates task, verifies file written with correct fields, verifies sync called, verifies returned `{ task: { id, subject } }` format. Error on missing subject.

- [x] 5. Create `task_update` tool
  **What**: Tool that updates a single task by ID. Validates ID format (`/^T-[A-Za-z0-9-]+$/`). Supports updating `subject`, `description`, `status`, `addBlocks` (additive), `addBlockedBy` (additive), `metadata` (merge, null deletes key). Reads task from file, applies changes, writes back, syncs to sidebar. Returns `{ task: <updated object> }`.
  **Files**: Create `src/features/task-system/tools/task-update.ts`
  **Acceptance**: Unit tests: update status, update subject, additive blocks/blockedBy (no replacement), metadata merge with null deletion, error on missing task, error on invalid ID format, persists changes to file.

- [x] 6. Create `task_list` tool
  **What**: Read-only tool listing active tasks (excludes completed and deleted). Reads all `T-*.json` files from task directory. For each task's `blockedBy`, filters to only show unresolved blockers (blockers that aren't completed). Returns `{ tasks: [{ id, subject, status, blockedBy }] }`.
  **Files**: Create `src/features/task-system/tools/task-list.ts`
  **Acceptance**: Unit test: lists only active tasks, excludes completed/deleted, resolves blockers correctly, returns empty array when no tasks, handles missing directory gracefully.

- [x] 7. Create barrel exports and register tools
  **What**: Create barrel exports for the task system feature. Wire tools into `createTools()` so they're conditionally registered when `experimental.task_system` is `true`. Add `task_system: z.boolean().optional()` to `ExperimentalConfigSchema`. Pass `directory` (from `ctx.directory`) through to tool constructors and storage.
  **Files**:
  - Create `src/features/task-system/tools/index.ts` (barrel: export tool constructors)
  - Create `src/features/task-system/index.ts` (barrel: re-export from tools/index + types + sync)
  - Modify `src/config/schema.ts` — add `task_system: z.boolean().optional()` to `ExperimentalConfigSchema`
  - Modify `src/create-tools.ts` — when `pluginConfig.experimental?.task_system === true`, create task tools and add to the `tools` record. Pass `ctx.directory` and `ctx` to tool constructors.
  **Acceptance**: When `experimental.task_system: true` in weave.json, `createTools()` returns tools including `task_create`, `task_update`, `task_list`. When `false` (default), tools record remains empty. Schema change compiles.

- [x] 8. Add task tool names to KNOWN_TOOL_NAMES
  **What**: Add `"task_create"`, `"task_update"`, `"task_list"` to the `KNOWN_TOOL_NAMES` set in `custom-agent-factory.ts`. This allows custom agent configs to grant/deny these tools without validation errors.
  **Files**: Modify `src/agents/custom-agent-factory.ts` — add 3 names to the set (line 12–24)
  **Acceptance**: Custom agent config with `tools: { task_create: true }` doesn't throw "unknown tool" error. Existing tool names unchanged.

### Scope 2: Kill the Finalize Callback

- [x] 9. Gate the finalize callback behind feature flag
  **What**: When `experimental.task_system` is `true`, skip the entire finalize block (lines 499–539 in `plugin-interface.ts`). The `FINALIZE_TODOS_MARKER` constant, `todoFinalizedSessions` Set, and re-arm guard (line 183) all remain but are only active when task system is off. Pass the feature flag into `createPluginInterface` via its args object.
  **Files**:
  - Modify `src/plugin/plugin-interface.ts`:
    - Add `taskSystemEnabled?: boolean` to the `args` parameter of `createPluginInterface`
    - Wrap the finalize block (lines 499–539) in `if (!taskSystemEnabled)`
    - Wrap the re-arm guard (line 183: `todoFinalizedSessions.delete(sessionID)`) in `if (!taskSystemEnabled)`
    - Wrap the `isTodoFinalize` exclusion check (line 239, 245) in `if (!taskSystemEnabled)` — when task system is active, there are no finalize markers to check
  - Modify `src/index.ts` — pass `taskSystemEnabled: pluginConfig.experimental?.task_system === true` to `createPluginInterface`
  **Acceptance**: With `task_system: true`, `session.idle` does NOT inject finalize prompts (the entire block is skipped). With `task_system: false` (default), behavior is identical to current code — finalize callback fires normally. The `todoFinalizedSessions` cleanup on `session.deleted` (line 296) should still run regardless (harmless no-op when set is empty).

### Scope 3: Proof Tests

- [x] 10. Unit tests for todo-sync.ts (obliteration proof)
  **What**: The critical test suite that proves the hypothesis. Tests should document both the current failure mode and the fix.
  **Files**: Create `src/features/task-system/todo-sync.test.ts`
  **Test cases**:
  - `syncTaskToTodo` — converts pending→pending, in_progress→in_progress, completed→completed, deleted→null. Extracts priority from metadata. Uses subject as todo content.
  - `syncTaskTodoUpdate` — "preserves existing todos when updating one task" (THE KEY TEST: start with todos [A, B, C], update B, verify A and C are untouched and B is updated). "removes deleted task without affecting others". "handles writer failure gracefully" (task file still exists).
  - `syncAllTasksToTodos` — "preserves non-task todos during bulk sync" (manually-added todos survive). "removes deleted tasks from todo list". "deduplicates when task subject matches existing todo content".
  - Obliteration scenario test: "todowrite with partial list would destroy items" — document that calling a writer with `[B_updated]` (without A and C) would lose A and C. Then show that `syncTaskTodoUpdate` reads `[A, B, C]`, produces `[A, B_updated, C]`.
  **Acceptance**: All tests pass. The obliteration scenario test clearly demonstrates the before/after difference.

- [x] 11. Unit tests for storage.ts
  **What**: Test file-based storage operations in isolation.
  **Files**: Create `src/features/task-system/storage.test.ts`
  **Test cases**:
  - `writeJsonAtomic` — writes valid JSON, cleans up temp file, target file exists after write
  - `readJsonSafe` — returns parsed object for valid file, returns null for missing file, returns null for corrupt JSON, returns null for schema-invalid data
  - `acquireLock` — acquires lock successfully, second acquire fails while first held, release allows re-acquire, stale lock (>30s) is broken and re-acquired
  - `generateTaskId` — matches `/^T-[a-f0-9-]+$/`
  - `getTaskDir` — returns path under config dir with sanitized project slug
  - `listTaskFiles` — returns only `T-*.json` files, ignores lock files and non-task files
  **Acceptance**: All tests pass. Uses temp directories for isolation (`beforeEach`/`afterEach` cleanup).

- [x] 12. Unit tests for task_create tool
  **What**: Test the create tool end-to-end (with real file storage, mocked sync).
  **Files**: Create `src/features/task-system/tools/task-create.test.ts`
  **Test cases**:
  - Creates task with required subject field
  - Auto-generates `T-{uuid}` format ID
  - Records sessionID as threadID
  - Sets default status to "pending", blocks/blockedBy to []
  - Accepts optional description, blockedBy, blocks, metadata
  - Returns minimal `{ task: { id, subject } }` response
  - Rejects missing subject with validation error
  - Writes task to file storage atomically (file exists after create)
  **Acceptance**: All tests pass. Uses temp task directory for isolation.

- [x] 13. Unit tests for task_update tool
  **What**: Test the update tool with pre-seeded task files.
  **Files**: Create `src/features/task-system/tools/task-update.test.ts`
  **Test cases**:
  - Updates subject, description, status independently
  - Additively appends to blocks/blockedBy without replacing existing entries
  - Avoids duplicate blocks when adding
  - Merges metadata without replacing entire object
  - Deletes metadata keys when set to null
  - Returns error for missing task (`task_not_found`)
  - Returns error for invalid ID format (`invalid_task_id`)
  - Persists changes to file storage
  - Updates multiple fields in single call
  **Acceptance**: All tests pass. Pre-seeds task files in `beforeEach`.

- [x] 14. Unit tests for task_list tool
  **What**: Test the list tool reads from file storage correctly.
  **Files**: Create `src/features/task-system/tools/task-list.test.ts`
  **Test cases**:
  - Lists active tasks (pending + in_progress)
  - Excludes completed and deleted tasks
  - Filters blockedBy to only unresolved blockers
  - Returns empty array when no tasks exist
  - Returns empty array when directory doesn't exist
  - Returns summary format (id, subject, status, blockedBy — no description)
  **Acceptance**: All tests pass.

## Verification

- [x] `bun test` — all existing tests pass (no regressions)
- [x] `bun test` — all new tests pass (12 test files across 3 scopes)
- [x] `bun run build` — compiles without errors
- [ ] Manual smoke test: set `"experimental": { "task_system": true }` in `weave.json`, verify task tools appear in OpenCode's tool list
- [ ] Manual smoke test: with `task_system: false` (default), verify all existing behavior unchanged — finalize callback fires, todowrite works, no task tools visible

## File Inventory

### New files (9)
```
src/features/task-system/types.ts
src/features/task-system/storage.ts
src/features/task-system/todo-sync.ts
src/features/task-system/tools/task-create.ts
src/features/task-system/tools/task-update.ts
src/features/task-system/tools/task-list.ts
src/features/task-system/tools/index.ts
src/features/task-system/index.ts
```

### New test files (5)
```
src/features/task-system/todo-sync.test.ts
src/features/task-system/storage.test.ts
src/features/task-system/tools/task-create.test.ts
src/features/task-system/tools/task-update.test.ts
src/features/task-system/tools/task-list.test.ts
```

### Modified files (4)
```
src/config/schema.ts                    — add task_system to ExperimentalConfigSchema
src/create-tools.ts                     — conditionally register task tools
src/agents/custom-agent-factory.ts      — add 3 task tool names to KNOWN_TOOL_NAMES
src/plugin/plugin-interface.ts          — gate finalize callback + accept taskSystemEnabled flag
src/index.ts                            — pass taskSystemEnabled through to createPluginInterface
```

## Risk Assessment

### R1: `opencode/session/todo` module availability (HIGH)
Same as full plan. The `resolveTodoWriter()` function handles import failure gracefully — returns null, task tools still work (just no sidebar sync). OmO uses this successfully in production.

### R2: First custom tool registration (MEDIUM)
Weave has never registered custom tools before. The plumbing exists (`PluginInterface.tool` → returned via `createPluginInterface`), but this is the first real use. If tool registration silently fails, the tools won't appear in OpenCode.
**Mitigation**: Add a debug log when tools are registered. Manual smoke test is a verification step.

### R3: File locking under concurrent sessions (LOW for PoC)
Multiple sessions writing to the same task file. OmO's `acquireLock()` uses `flag: "wx"` with stale lock recovery. Task creates never conflict (UUID IDs). Only concurrent updates to the same task ID could race.
**Mitigation**: Sufficient for PoC. Full plan can add retry logic if needed.
