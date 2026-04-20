# Tapestry Coordinator: Two-Mode Delegation to Shuttle

## TL;DR
> **Summary**: Transform Tapestry into a coordinator that delegates plan tasks to Shuttle agents in two modes: Mode 1 (uncategorized) spawns generic shuttles with parallelism based on file disjointness; Mode 2 (categorized) routes tasks to category-specific `shuttle-{name}` agents based on file patterns and explicit tags. Each mode has prompt composition tests and behavioral evals using Claude Opus 4 (`anthropic/claude-opus-4-20250514`).
> **Estimated Effort**: Large

## Context
### Original Request
Make Tapestry a pure coordinator with two modes of operation: a simple uncategorized mode that works out of the box with generic shuttle agents, and a categorized mode that routes tasks to specialized shuttle instances based on config-defined file patterns.

### Key Findings
- **Tapestry currently**: `call_weave_agent: false` — cannot delegate. Prompt says "you work directly — no subagent delegation."
- **Shuttle**: Leaf worker (`call_weave_agent: false`), mode `"all"`. Prompt says "category-based specialist" but receives no category context at spawn time.
- **Category schema exists** (`CategoryConfigSchema`): supports `model`, `temperature`, `variant`, `prompt_append`, `tools`, `disable`. But **no `patterns` field** — file-pattern routing doesn't exist yet.
- **`buildAgent()` in `agent-builder.ts`**: Applies category config at build-time, not per-delegation.
- **Task tool**: Spawns pre-registered agents by name via `subagent_type`. No runtime overrides — to get category-specific Shuttles, we need multiple registered agents (e.g., `shuttle-frontend`).
- **Loom pattern**: Delegates via Task tool. Loom's prompt-composer has conditional sections based on enabled agents.
- **Key constraint**: OpenCode's Task tool spawns agents by name from the registered agent map. Category-specific Shuttle instances require pre-registration at startup.
- **Eval infrastructure**: Weave has a mature eval framework (`src/features/evals/`) with three executor types: `prompt-render` (deterministic), `model-response` (sends prompt+input to LLM via GitHub Models or OpenRouter), and `trajectory-run` (multi-turn mock scenarios). Evaluators include `contains-all`, `llm-judge`, `trajectory-assertion`, etc. Eval cases are JSONC files in `evals/cases/`, suites in `evals/suites/`. The `model-response` executor can target any model but currently returns raw text — **no tool call parsing exists**. Behavioral evals testing Task tool calls will need the model response to contain tool-call-like patterns that can be evaluated with existing evaluators (e.g., `contains-all`, `llm-judge`).

### Design: Two Modes
**Mode 1 (Uncategorized)**: No `categories` with `patterns` in config. Tapestry spawns generic `shuttle` agents. Parallelism determined by file disjointness between tasks. This is the baseline — works with just `call_weave_agent: true` + prompt changes.

**Mode 2 (Categorized)**: Categories defined with `patterns`, `model`, `prompt_append` in config. `shuttle-{category}` agents registered at startup. Tapestry routes tasks by matching file patterns or explicit `[category: name]` tags. Falls back to generic `shuttle` for unmatched tasks.

## Objectives
### Core Objective
Tapestry delegates all implementation work to Shuttle instances, keeping only coordination, verification, and progress tracking. Mode 1 is delivered first as a complete feature; Mode 2 layers on top.

### Deliverables
- [ ] Phase 1: Tapestry delegates to generic shuttle with parallelism (Mode 1)
- [ ] Phase 1: Prompt composition test suite for Mode 1
- [ ] Phase 1: Behavioral eval suite for Mode 1 (LLM evals with Claude Opus 4 / `anthropic/claude-opus-4-20250514`)
- [ ] Phase 2: Category config schema extended with `patterns` field
- [ ] Phase 2: Category-specific shuttle agents registered at startup
- [ ] Phase 2: Tapestry routes tasks to category shuttles (Mode 2)
- [ ] Phase 2: Prompt composition test suite for Mode 2
- [ ] Phase 2: Behavioral eval suite for Mode 2 (LLM evals with Claude Opus 4 / `anthropic/claude-opus-4-20250514`)

### Definition of Done
- [ ] `npm test` passes
- [ ] Tapestry prompt contains delegation instructions, does not say "you work directly"
- [ ] Mode 1 prompt composition tests: parallelism, delegation context, verification, retry all validated
- [ ] Mode 1 behavioral evals: parallel batch detection, delegation context completeness, sequential dependency, verification after delegation, retry on failure, escalation after repeated failures
- [ ] Mode 2 prompt composition tests: category routing, explicit tags, fallback, mixed batches all validated
- [ ] Mode 2 behavioral evals: correct category routing, explicit tag override, fallback to generic, mixed category parallel batch, no-categories graceful degradation
- [ ] `call_weave_agent: true` for Tapestry, `false` for all Shuttle variants
- [ ] Base `shuttle` agent still registered (Loom compatibility)

### Guardrails (Must NOT)
- Must not give Shuttle `call_weave_agent: true` — it stays a leaf worker
- Must not break Loom's delegation to Tapestry via `/start-work`
- Must not break Loom's direct delegation to Shuttle for ad-hoc tasks
- Must not remove Tapestry's Weft/Warp post-execution review delegation
- Must not break existing `categories` config that doesn't use `patterns`

## TODOs

### Phase 1: Mode 1 — Uncategorized Delegation

- [x] 1. Enable Task tool for Tapestry
  **What**: Change `call_weave_agent: false` to `call_weave_agent: true` in Tapestry's agent config.
  **Files**: `src/agents/tapestry/default.ts`
  **Acceptance**: `TAPESTRY_DEFAULTS.tools.call_weave_agent === true`

- [x] 2. Rewrite Tapestry Role section for delegation
  **What**: Replace the role from "execution orchestrator that works directly" to "coordination orchestrator that delegates to Shuttle agents." Update `buildTapestryRoleSection()`. The role should describe Mode 1 behavior: delegate tasks to generic `shuttle` via Task tool, coordinate parallelism, verify results.
  **Files**: `src/agents/tapestry/prompt-composer.ts`
  **Acceptance**: Role section mentions delegation to Shuttle, does not say "you work directly"

- [x] 3. Add Delegation Contract section
  **What**: Add `buildTapestryDelegationSection()` defining how Tapestry delegates to Shuttle. The contract per task:
  - Task title and number (e.g., "Task 3/7: Add user model")
  - Full task description (`**What**:` field from plan)
  - File paths (`**Files**:` field)
  - Acceptance criteria (`**Acceptance**:` field)
  - Relevant learnings from `.weave/learnings/` if they exist
  - Context from previous completed tasks that affects this one
  - Template: Task tool with `subagent_type="shuttle"`, prompt containing the above
  **Files**: `src/agents/tapestry/prompt-composer.ts`
  **Acceptance**: New section appears in composed prompt with delegation contract details and `subagent_type="shuttle"`

- [x] 4. Add Parallelism Detection section
  **What**: Add `buildTapestryParallelismSection()` instructing Tapestry on concurrent execution. Rules:
  - Tasks are parallel-safe when they touch **disjoint file sets** (no overlapping `**Files**:` entries)
  - Tasks with no `**Files**:` field (verification-only) depend on all preceding tasks
  - Tasks that reference output of a prior task are sequential
  - When in doubt, run sequentially — correctness over speed
  - Use multiple Task tool calls in a single response for parallel execution
  - Max 3 concurrent Shuttle delegations to avoid context explosion
  **Files**: `src/agents/tapestry/prompt-composer.ts`
  **Acceptance**: Section describes file-disjointness heuristic, max concurrency rules

- [x] 5. Rewrite PlanExecution section for delegation
  **What**: Update `buildTapestryPlanExecutionSection()` to replace direct execution with delegation loop:
  1. READ plan, identify all unchecked tasks
  2. Analyze task dependencies (file overlap, explicit references)
  3. Group into parallel batches where safe
  4. For each batch: delegate tasks to `shuttle` via Task tool calls
  5. Verify each Shuttle result (see Verification section)
  6. Mark completed tasks in plan
  7. Continue to next batch
  **Files**: `src/agents/tapestry/prompt-composer.ts`
  **Acceptance**: PlanExecution section describes delegation loop, not direct execution

- [x] 6. Update Verification section for delegated work
  **What**: Update `buildTapestryVerificationSection()` to verify Shuttle's output:
  1. Re-read all files Shuttle claimed to modify — confirm they exist and look correct
  2. Run acceptance criteria checks (build commands, test commands from plan)
  3. If verification fails: re-delegate to same `shuttle` with error context (max 1 retry per task)
  4. If retry fails: mark task as blocked, document reason, continue
  **Files**: `src/agents/tapestry/prompt-composer.ts`
  **Acceptance**: Verification section references Shuttle output validation and retry logic

- [x] 7. Add Error Handling section
  **What**: Add `buildTapestryErrorHandlingSection()`:
  - Shuttle returns error or incomplete work → retry once with error context appended to prompt
  - Shuttle retry fails → mark task blocked, log reason in learnings, continue to next task
  - Build/test failure after Shuttle completes → re-delegate with failure output
  - Multiple consecutive failures (3+) → pause and report to user
  **Files**: `src/agents/tapestry/prompt-composer.ts`
  **Acceptance**: Error handling section in prompt with retry/block/escalation rules

- [x] 8. Enhance Shuttle prompt for structured task intake
  **What**: Update Shuttle's prompt to handle the delegation contract from Tapestry:
  - Expect structured task with title, description, files, acceptance criteria
  - Complete ALL acceptance criteria before reporting done
  - Report back with: files changed, commands run, test results, any issues encountered
  - If task is ambiguous, make reasonable choices and document them (don't ask — Shuttle has no interactive channel)
  **Files**: `src/agents/shuttle/default.ts`
  **Acceptance**: Shuttle prompt references structured task format and reporting contract

- [x] 9. Wire new sections into composeTapestryPrompt
  **What**: Update `composeTapestryPrompt()` to include new sections. Order:
  1. Role (rewritten)
  2. Invariant (unchanged)
  3. Discipline (unchanged)
  4. SidebarTodos (unchanged)
  5. **Delegation** (new)
  6. **Parallelism** (new)
  7. PlanExecution (rewritten)
  8. Continuation (unchanged)
  9. Verification (updated)
  10. **ErrorHandling** (new)
  11. PostExecutionReview (unchanged)
  12. Execution (update to reference delegation)
  13. Style (unchanged)
  **Files**: `src/agents/tapestry/prompt-composer.ts`
  **Acceptance**: `composeTapestryPrompt()` returns prompt with all new sections in correct order

- [x] 10. Update unit tests for Phase 1
  **What**: Update existing tests and add new ones:
  - `src/agents/tapestry/index.test.ts`: Change `call_weave_agent` expectation from `false` to `true`
  - `src/agents/tapestry/prompt-composer.test.ts`: Add tests for new sections (delegation, parallelism, error handling), update tests for rewritten sections
  - `src/agents/shuttle/index.test.ts`: Update if Shuttle prompt assertions change
  **Files**: `src/agents/tapestry/index.test.ts`, `src/agents/tapestry/prompt-composer.test.ts`, `src/agents/shuttle/index.test.ts`
  **Acceptance**: `npm test` passes, new sections have test coverage

- [x] 11. Create Mode 1 prompt composition tests
  **What**: Create a deterministic test suite validating prompt content for uncategorized delegation. These are **prompt composition tests** — they parse the composed prompt and assert content without calling an LLM. Test scenarios:
  1. **Parallelism — disjoint files**: Verify the prompt's parallelism section instructs grouping by file disjointness.
  2. **Parallelism — overlapping files**: Verify prompt instructs sequential execution for overlapping files.
  3. **Delegation context sufficiency**: Verify the delegation section instructs including What/Files/Acceptance fields plus learnings in the Task tool prompt.
  4. **Verification catches failure**: Verify the verification section instructs re-reading modified files and checking acceptance criteria before marking complete.
  5. **Retry includes error context**: Verify the error handling section instructs appending error output from first attempt when retrying.
  6. **Multiple concurrent shuttles**: Verify the parallelism section instructs using multiple Task tool calls in a single response for parallel batches, with max concurrency of 3.

  Implementation: Deterministic tests against prompt composition output — parse composed prompt sections and assert content. Not LLM evals.
  **Files**: `src/agents/tapestry/mode1-prompt-composition.test.ts`
  **Acceptance**: Test file exists with ≥6 test scenarios. `npm test` passes.

- [x] 12. Create Mode 1 behavioral eval suite
  **What**: Create LLM-based behavioral evals that test Tapestry's actual decision-making when given sample plans. These extend the existing Tapestry eval pattern (see `evals/suites/tapestry-execution-contracts.jsonc` and `evals/cases/tapestry/execution-contract/` for reference). Each eval case uses `builtin-agent-prompt` target with `model-response` executor via OpenRouter, sending Tapestry's composed prompt as system prompt and a scenario as user input.

  Create eval suite file `evals/suites/tapestry-delegation-contracts.jsonc` (extends the `tapestry-execution` family) and case files under `evals/cases/tapestry/delegation-contract/`. Follow the same JSONC structure as existing cases like `continue-after-progress-update.jsonc`.

  Cases:

  1. **Parallel batch detection** (`parallel-batch-detection.jsonc`): Scenario presents a plan with 3 tasks — A touches `src/a.ts`, B touches `src/b.ts`, C touches `src/a.ts`. Evaluator asserts Tapestry delegates A+B in parallel and C sequentially after A. Use `llm-judge` with `expectedAnyOf: ["parallel", "A and B", "concurrent"]` and `forbiddenContains: ["C in parallel with A"]`.

  2. **Delegation context completeness** (`delegation-context-completeness.jsonc`): Scenario presents a plan task with What/Files/Acceptance fields. Evaluator asserts the delegation prompt includes all fields plus task number. Use `llm-judge` with `expectedAnyOf: ["shuttle", "subagent_type", "delegate"]`.

  3. **Sequential dependency detection** (`sequential-dependency-detection.jsonc`): Scenario presents a plan where task B says "using the output from task A". Evaluator asserts Tapestry does NOT parallelize them. Use `llm-judge` with `expectedAnyOf: ["sequential", "after task A", "depends"]` and `forbiddenContains: ["parallel"]`.

  4. **Verification after delegation** (`verification-after-delegation.jsonc`): Scenario simulates a completed Shuttle response. Evaluator asserts Tapestry verifies before marking complete. Use `llm-judge` with `expectedAnyOf: ["verify", "check", "read", "acceptance"]`.

  5. **Retry on failure** (`retry-on-failure.jsonc`): Scenario simulates a Shuttle failure with error details. Evaluator asserts Tapestry retries with error context. Use `llm-judge` with `expectedAnyOf: ["retry", "re-delegate", "error context"]`.

  6. **Escalation after repeated failures** (`escalation-after-repeated-failures.jsonc`): Scenario simulates 3 consecutive Shuttle failures. Evaluator asserts Tapestry pauses and reports to user. Use `llm-judge` with `expectedAnyOf: ["pause", "report", "user", "blocked"]` and `forbiddenContains: ["retry", "re-delegate"]`.

  All cases use:
  - `target: { kind: "builtin-agent-prompt", agent: "tapestry" }`
  - `executor: { kind: "model-response", provider: "openrouter", model: "anthropic/claude-opus-4-20250514", input: "<scenario>" }`
  - Model: Claude Opus 4 via OpenRouter (`anthropic/claude-opus-4-20250514`) — intelligent enough for correct coordination decisions

  **Files**: `evals/suites/tapestry-delegation-contracts.jsonc`, `evals/cases/tapestry/delegation-contract/parallel-batch-detection.jsonc`, `evals/cases/tapestry/delegation-contract/delegation-context-completeness.jsonc`, `evals/cases/tapestry/delegation-contract/sequential-dependency-detection.jsonc`, `evals/cases/tapestry/delegation-contract/verification-after-delegation.jsonc`, `evals/cases/tapestry/delegation-contract/retry-on-failure.jsonc`, `evals/cases/tapestry/delegation-contract/escalation-after-repeated-failures.jsonc`
  **Acceptance**: `bun run script/eval.ts --suite tapestry-delegation-contracts` runs all 6 cases against Claude Opus 4 (`anthropic/claude-opus-4-20250514`) via OpenRouter. Cases pass with ≥80% score. Suite registered in eval infrastructure.

### Phase 2: Mode 2 — Categorized Delegation

- [x] 13. Extend CategoryConfigSchema with `patterns` field
  **What**: Add an optional `patterns` field (array of glob strings) to `CategoryConfigSchema`. This defines which file patterns route tasks to this category. Update the JSON schema generation and schema tests.
  **Files**: `src/config/schema.ts`, `src/config/schema.test.ts`, `schema/weave-config.schema.json`
  **Acceptance**: `CategoryConfigSchema` parses `{ patterns: ["src/components/**", "*.tsx"], model: "claude-sonnet-4-20250514", prompt_append: "React specialist" }` successfully. Schema rejects non-string-array patterns. Existing configs without `patterns` still parse.

- [x] 14. Register category-specific Shuttle agents at startup
  **What**: In `createBuiltinAgents()`, after building the base `shuttle` agent, iterate over `categories` config. For each category that has `patterns`, register an additional agent named `shuttle-{categoryName}` with:
  - The category's `model` (falling back to shuttle's resolved model)
  - The category's `prompt_append` appended to shuttle's base prompt
  - The category's `temperature`, `tools`, etc. if specified
  - The base shuttle agent remains registered as `shuttle` (acts as default/fallback)
  **Files**: `src/agents/builtin-agents.ts`, `src/agents/builtin-agents.test.ts`
  **Acceptance**: Given config `{ categories: { frontend: { patterns: ["*.tsx"], model: "fast-model", prompt_append: "React expert" } } }`, the result contains both `shuttle` and `shuttle-frontend` agents. `shuttle-frontend` has the fast-model and appended prompt.

- [x] 15. Add Category Routing section to Tapestry prompt
  **What**: Add a new `buildTapestryCategoryRoutingSection()` function. This section tells Tapestry:
  - Which category agents are available and their file patterns (injected from config at prompt-compose time)
  - Routing priority: (1) explicit `[category: name]` tag on task → `shuttle-{name}`, (2) match task's `**Files**:` against category patterns → first matching `shuttle-{category}`, (3) fallback to `shuttle` (default)
  - The section is only included when categories with patterns exist; otherwise omitted (Mode 1 behavior)
  Update `TapestryPromptOptions` to accept categories config. Update `composeTapestryPrompt` to conditionally include this section.
  **Files**: `src/agents/tapestry/prompt-composer.ts`
  **Acceptance**: When categories config has `frontend: { patterns: ["*.tsx"] }`, the composed prompt contains routing instructions mentioning `shuttle-frontend` and `*.tsx`. When no categories have patterns, the section is absent.

- [x] 16. Pass categories config to Tapestry agent creation
  **What**: Update `createTapestryAgentWithOptions()` to accept and forward `categories` config. Update `createBuiltinAgents()` to pass `categories` to the Tapestry creation path.
  **Files**: `src/agents/tapestry/index.ts`, `src/agents/builtin-agents.ts`
  **Acceptance**: `createTapestryAgentWithOptions` receives categories config and the composed prompt includes category routing info when categories have patterns.

- [x] 17. Update Delegation section for category-aware routing
  **What**: Update `buildTapestryDelegationSection()` to be category-aware. When categories exist, the delegation template uses `subagent_type="shuttle-{category}"` instead of `subagent_type="shuttle"`. When no categories, it stays as `subagent_type="shuttle"`. This is a conditional enhancement — Mode 1 behavior is preserved.
  **Files**: `src/agents/tapestry/prompt-composer.ts`
  **Acceptance**: With categories: delegation mentions `shuttle-{category}`. Without categories: delegation mentions `shuttle`.

- [x] 18. Update unit tests for Phase 2
  **What**: Add new tests:
  - `src/config/schema.test.ts`: Test patterns field parsing, backward compatibility
  - `src/agents/builtin-agents.test.ts`: Test that category-specific shuttle agents are registered when patterns exist, not registered when patterns absent
  - `src/agents/tapestry/prompt-composer.test.ts`: Test category routing section present/absent based on config, test dynamic category injection
  - `src/agents/tapestry/index.test.ts`: Test categories config flows through to prompt
  **Files**: `src/config/schema.test.ts`, `src/agents/builtin-agents.test.ts`, `src/agents/tapestry/prompt-composer.test.ts`, `src/agents/tapestry/index.test.ts`
  **Acceptance**: `npm test` passes, category routing and shuttle registration have test coverage

- [x] 19. Create Mode 2 prompt composition tests
  **What**: Create a deterministic test suite validating prompt content for categorized delegation. These are **prompt composition tests** — they parse the composed prompt and assert content without calling an LLM. Test scenarios:
  1. **Category routing by file pattern**: Given categories config `{ frontend: { patterns: ["*.tsx", "*.css"] } }` and a task with files `["src/App.tsx"]`, verify prompt instructs routing to `shuttle-frontend`.
  2. **Explicit tag override**: Given a task with `[category: backend]` tag and files `["src/App.tsx"]` (which matches frontend pattern), verify prompt instructs routing to `shuttle-backend` regardless of file pattern match.
  3. **Fallback to generic shuttle**: Given a task with files `["README.md"]` that matches no category patterns, verify prompt instructs routing to generic `shuttle`.
  4. **Mixed batch parallel routing**: Given parallel-safe tasks where task A matches `frontend` and task B matches `backend`, verify prompt instructs spawning `shuttle-frontend` and `shuttle-backend` simultaneously.
  5. **Category-specific prompt_append**: Given categories config with `prompt_append: "React expert"` for frontend, verify the registered `shuttle-frontend` agent's prompt contains "React expert".
  6. **No categories = no routing section**: When categories config has no patterns, verify the category routing section is absent from the composed prompt (Mode 1 behavior preserved).

  Implementation: Deterministic tests against prompt composition and agent registration — not LLM evals.
  **Files**: `src/agents/tapestry/mode2-prompt-composition.test.ts`
  **Acceptance**: Test file exists with ≥6 test scenarios. `npm test` passes.

- [x] 20. Create Mode 2 behavioral eval suite
  **What**: Create LLM-based behavioral evals that test Tapestry's category routing decisions. Extends the existing Tapestry eval pattern (see `evals/suites/tapestry-execution-contracts.jsonc` for reference). Same approach as task 12.

  Create eval suite file `evals/suites/tapestry-delegation-routing.jsonc` (new family for category routing) and case files under `evals/cases/tapestry/delegation-routing/`. Cases:

  1. **Correct category routing** (`correct-category-routing.jsonc`): System prompt is Tapestry's composed prompt with categories config `{ frontend: { patterns: ["*.tsx"] } }`. Scenario presents a task with files `["src/App.tsx"]`. Evaluator asserts routing to `shuttle-frontend`. Use `llm-judge` with `expectedAnyOf: ["shuttle-frontend"]`.

  2. **Explicit tag override** (`explicit-tag-override.jsonc`): Task tagged `[category: backend]` with files matching frontend patterns. Evaluator asserts routing to `shuttle-backend`. Use `llm-judge` with `expectedAnyOf: ["shuttle-backend"]` and `forbiddenContains: ["shuttle-frontend"]`.

  3. **Fallback to generic** (`fallback-to-generic.jsonc`): Task files match no category patterns. Evaluator asserts routing to plain `shuttle`. Use `llm-judge` to verify generic shuttle routing without category suffix.

  4. **Mixed category parallel batch** (`mixed-category-parallel-batch.jsonc`): Two parallel-safe tasks — one matches frontend, one matches backend. Evaluator asserts both `shuttle-frontend` and `shuttle-backend` delegated in the same response. Use `llm-judge` with `expectedAnyOf: ["shuttle-frontend", "shuttle-backend", "parallel"]`.

  5. **No categories graceful degradation** (`no-categories-graceful-degradation.jsonc`): System prompt is Tapestry's composed prompt with NO categories config (Mode 1). Scenario presents tasks. Evaluator asserts all delegations use generic `shuttle`. Use `llm-judge` with `expectedAnyOf: ["shuttle"]` and `forbiddenContains: ["shuttle-frontend", "shuttle-backend"]`.

  All cases use:
  - `target: { kind: "builtin-agent-prompt", agent: "tapestry" }` (with appropriate variant for categories config)
  - `executor: { kind: "model-response", provider: "openrouter", model: "anthropic/claude-opus-4-20250514", input: "<scenario>" }`
  - Model: Claude Opus 4 via OpenRouter (`anthropic/claude-opus-4-20250514`)

  **Files**: `evals/suites/tapestry-delegation-routing.jsonc`, `evals/cases/tapestry/delegation-routing/correct-category-routing.jsonc`, `evals/cases/tapestry/delegation-routing/explicit-tag-override.jsonc`, `evals/cases/tapestry/delegation-routing/fallback-to-generic.jsonc`, `evals/cases/tapestry/delegation-routing/mixed-category-parallel-batch.jsonc`, `evals/cases/tapestry/delegation-routing/no-categories-graceful-degradation.jsonc`
  **Acceptance**: `bun run script/eval.ts --suite tapestry-delegation-routing` runs all 5 cases against Claude Opus 4 (`anthropic/claude-opus-4-20250514`) via OpenRouter. Cases pass with ≥80% score. Suite registered in eval infrastructure.

- [x] 21. Verify no regressions in Loom delegation paths
  **What**: Confirm Loom still delegates to Tapestry via `/start-work` and to Shuttle for ad-hoc tasks. Confirm the base `shuttle` agent (without category suffix) still exists. Run full test suite.
  **Acceptance**: `npm test` passes, Loom prompt still references Tapestry and Shuttle correctly, base `shuttle` agent still registered

## Verification
- [ ] `npm test` passes with no failures
- [ ] Tapestry prompt contains: "delegate", "shuttle", "subagent_type"
- [ ] Tapestry prompt does NOT contain: "you work directly"
- [ ] Shuttle prompt contains structured task intake instructions
- [ ] `call_weave_agent` is `true` for Tapestry, `false` for all Shuttle variants
- [ ] Mode 1 prompt composition tests pass (≥6 scenarios: parallelism, delegation context, verification, retry, concurrency)
- [ ] `tapestry-delegation-contracts` behavioral evals pass (≥6 scenarios: parallel batch, delegation context, sequential deps, verification, retry, escalation) at ≥80% score with Claude Opus 4 (`anthropic/claude-opus-4-20250514`) via OpenRouter
- [ ] Mode 2 prompt composition tests pass (≥6 scenarios: pattern routing, explicit tags, fallback, mixed batch, prompt_append, no-categories)
- [ ] `tapestry-delegation-routing` behavioral evals pass (≥5 scenarios: category routing, tag override, fallback, mixed batch, no-categories degradation) at ≥80% score with Claude Opus 4 (`anthropic/claude-opus-4-20250514`) via OpenRouter
- [ ] `CategoryConfigSchema` accepts `patterns` field (Phase 2)
- [ ] Given categories config with patterns, multiple `shuttle-{name}` agents are registered (Phase 2)
- [ ] Base `shuttle` agent still registered (Loom compatibility)
- [ ] Loom's references to Tapestry and Shuttle unchanged
