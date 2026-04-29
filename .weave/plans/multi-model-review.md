# Multi-Model Adversarial Review

## TL;DR
> **Summary**: Add `review_models` config to warp/weft agents, enabling parallel multi-model review with automatic collation. When configured, `call_weave_agent` targeting warp/weft spawns additional reviewer sessions in parallel, then collates all outputs via the primary model.
> **Estimated Effort**: Medium

## Context
### Original Request
Enable adversarial multi-model review for warp (security) and weft (code review) agents. Multiple LLMs review the same code independently, then results are merged — reducing false negatives.

### Key Findings
- **Agent invocation**: Warp/weft are invoked via `call_weave_agent` tool (SDK-provided). They run as subagent sessions.
- **Hook system**: `tool.execute.after` hook receives mutable `output: { title, output, metadata }` — this is the interception point. Currently Weave ignores the `output` param in `handleToolExecuteAfter` (passes `_output`).
- **SDK session API**: `client.session.create` creates sessions, `client.session.promptAsync` sends prompts with `agent` and `model` overrides, `client.session.prompt` waits synchronously. `session.get` can poll status.
- **Agent config**: `AgentOverrideConfigSchema` in `src/config/schema.ts` holds per-agent overrides. Adding `review_models: string[]` here is the config surface.
- **Warp/weft defaults**: Both are read-only (tools: `{ write: false, edit: false, task: false, call_weave_agent: false }`), temperature 0.1, mode "subagent".
- **Config flow**: `createBuiltinAgents` in `builtin-agents.ts` reads `agentOverrides` and applies them. The override config is available at agent creation time but NOT at tool-execution time — the orchestrator needs access to the resolved config.

## Objectives
### Core Objective
When `review_models` is configured for warp or weft, run all models as parallel reviewers and return a collated result — transparently to callers.

### Deliverables
- [ ] `review_models` config field on `AgentOverrideConfigSchema`
- [ ] Review orchestrator module at `src/agents/review-orchestrator.ts`
- [ ] Hook integration in plugin adapter's `tool.execute.after`
- [ ] Collation prompt and LLM call
- [ ] Tests for orchestrator, config, and integration

### Definition of Done
- [ ] `bun test` passes with no regressions
- [ ] Single-model warp/weft behavior unchanged when `review_models` is absent
- [ ] With `review_models` configured, multiple reviewer outputs are collated into one
- [ ] Failed reviewers produce warnings but don't block the review

### Guardrails (Must NOT)
- Must NOT change behavior when `review_models` is unconfigured
- Must NOT modify warp/weft agent prompts or defaults
- Must NOT add agent-specific logic to the collation prompt
- Must NOT block if all additional reviewers fail (primary still succeeds)

## TODOs

- [x] 1. **Add `review_models` to config schema**
  **What**: Add `review_models: z.array(z.string()).optional()` to `AgentOverrideConfigSchema`. Update the `AgentOverrideConfig` type export.
  **Files**: `src/config/schema.ts`
  **Acceptance**: Schema accepts `{ agents: { warp: { review_models: ["anthropic/claude-sonnet-4-20250514"] } } }` and rejects non-string arrays. Existing configs without `review_models` parse unchanged.

- [x] 2. **Create review orchestrator module**
  **What**: New module that:
    - Takes: agent name, primary review output, review prompt/context, list of `review_models`, SDK client reference
    - Creates N sessions (one per review model) via `client.session.create`
    - Sends the same prompt to each via `client.session.promptAsync` with `model` override
    - Polls `client.session.get` for completion (with timeout)
    - Returns array of `{ model: string, output: string, success: boolean, error?: string }`
    - Uses `Promise.allSettled` for parallel execution with per-reviewer timeouts
  **Files**: `src/agents/review-orchestrator.ts`
  **Acceptance**: Unit tests with mocked SDK client verify parallel execution, timeout handling, and partial failure.

- [x] 3. **Create collation prompt and runner**
  **What**: Generic collation function that:
    - Builds a prompt containing: all reviewer outputs (labeled by model), the original context, notes on failed reviewers
    - Instructions: merge, deduplicate, err toward inclusion, match input review format
    - Calls the primary model via `client.session.prompt` (or a new ephemeral session)
    - Returns the collated text
  **Files**: `src/agents/review-orchestrator.ts` (same module, exported `collateReviews` function)
  **Acceptance**: Unit test verifies prompt construction includes all reviewer outputs and failure notes. Collation prompt is agent-agnostic.

- [x] 4. **Wire orchestrator into plugin adapter**
  **What**:
    - In `createPluginAdapter`, pass `agentOverrides` config (or just the resolved `review_models` map) to the adapter
    - In `handleToolExecuteAfter`: when tool is `call_weave_agent`, agent is warp/weft, and `review_models` is configured:
      1. Extract the primary review output from `output.output`
      2. Extract the original prompt from `input.args`
      3. Call orchestrator to run additional reviewers in parallel
      4. Call collation with primary + additional outputs
      5. Replace `output.output` with collated result
      6. Update `output.title` to indicate multi-model review (e.g., "Weft Review (3 models)")
    - Update `handleToolExecuteAfter` signature to accept and use the mutable `output` param (currently `_output`)
    - When unconfigured: no change to existing flow
  **Files**: `src/runtime/opencode/plugin-adapter.ts`, `src/plugin/plugin-interface.ts`
  **Acceptance**: Integration test with mocked client verifies: (a) orchestrator not called when `review_models` absent, (b) orchestrator called and output replaced when configured, (c) warning surfaced when reviewer fails.

- [x] 5. **Surface reviewer failure warnings**
  **What**: When N of M additional reviewers fail, prepend warning to collated output: `⚠️ {N} of {M} additional review models did not respond. Results based on {M-N+1} models (including primary).` If ALL additional reviewers fail, skip collation entirely and return primary output with warning: `⚠️ All {M} additional review models failed. Showing primary model review only.`
  **Files**: `src/agents/review-orchestrator.ts`
  **Acceptance**: Tests verify warning text for partial and total failure scenarios.

- [x] 6. **Pass config context to adapter**
  **What**: The adapter needs to know which agents have `review_models` configured. Thread the `agentOverrides` (or a derived `reviewModelsMap: Record<string, string[]>`) from `createPluginAdapter` args through to `handleToolExecuteAfter`. The `createPluginAdapter` already receives `pluginConfig` which contains `agents` overrides.
  **Files**: `src/runtime/opencode/plugin-adapter.ts`
  **Acceptance**: `handleToolExecuteAfter` can look up `review_models` for the target agent.

- [x] 7. **Unit tests for review orchestrator**
  **What**: Test file covering:
    - Happy path: 2 additional reviewers succeed, collation merges 3 outputs
    - Partial failure: 1 of 2 additional reviewers fails, collation uses 2 outputs + warning
    - Total failure: all additional reviewers fail, returns primary output + warning
    - Timeout: reviewer exceeds timeout, treated as failure
    - Empty `review_models`: orchestrator not invoked
  **Files**: `src/agents/review-orchestrator.test.ts`
  **Acceptance**: All tests pass with `bun test src/agents/review-orchestrator.test.ts`

- [x] 8. **Integration test for plugin adapter hook**
  **What**: Test that `tool.execute.after` for `call_weave_agent` targeting weft/warp with `review_models` configured triggers orchestration and modifies output. Test that without `review_models`, output is untouched.
  **Files**: `src/plugin/plugin-interface.test.ts` (add cases to existing test file)
  **Acceptance**: Tests pass, no regressions in existing plugin-interface tests.

- [x] 9. **JSON schema regeneration**
  **What**: If the project auto-generates JSON schema from Zod (check `schema/` directory), regenerate to include `review_models`.
  **Files**: `schema/` (if applicable)
  **Acceptance**: JSON schema includes `review_models` property under agent overrides.

## Verification
- [x] `bun test` — all tests pass, no regressions
- [x] Config without `review_models` produces identical behavior (grep for `review_models` in runtime paths confirms early-exit)
- [ ] Manual test: configure `review_models: ["anthropic/claude-sonnet-4-20250514"]` on weft, invoke weft review, observe collated output
