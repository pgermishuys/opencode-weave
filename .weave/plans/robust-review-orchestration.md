# Robust Review Orchestration — Runtime-Deterministic Reviewer Fan-Out

## TL;DR
> **Summary**: Move reviewer fan-out from the LLM into the Weave runtime, with a single semantic for both direct `@weft`/`@warp` invocations and Tapestry's post-execution review. The runtime resolves the reviewer set from config, runs the variants (and, in post-execution, the base too), collates results, and posts a single output back. The foreground turn provides the primary output in direct scope; the runtime executes everything in post-execution scope. No double-execution. No LLM-authored Task fan-out.
> **Estimated Effort**: Large

## Context

### Original Request
Loom/Tapestry today let the LLM decide whether a direct `@weft` turn fans out to the `weft-review-*` variants configured via `agents.weft.review_models`. That is non-deterministic. We want: when the intent and the review target are clear (`@weft`/`@warp`, or Tapestry's post-execution gate), the runtime resolves the reviewer set from config and *executes* base + variants without asking the model and without asking the user. Keep the Weft/Warp boundary in code. Fall back cleanly when variants are missing or agents are disabled. Ship evals/tests that fit the current harness, extending it only where called out.

### Key Findings
- **`buildReviewModelVariants`** (`src/agents/review-model-variants.ts`) already produces the canonical `ReviewModelVariant[]` from `agents.weft/warp.review_models`, applies the Weft/Warp boundary at key/label level, and filters disabled agents per variant.
- **`runAdditionalReviewers` + `collateReviews` + `buildFailureWarning`** in `src/agents/review-orchestrator.ts` are implemented and unit-tested but **dead** — no production caller. Today's signature takes a single `agentName: string` for all reviewers; we extend it to accept `{ agentName, model }[]` so the visible variant agents (`weft-review-opencode-go-...`) can each carry their own boundary prompt.
- **`pluginConfig.agents` is already in scope of `createPluginAdapter`** (`src/runtime/opencode/plugin-adapter.ts` lines 23–38). The adapter can precompute reviewer plans and pass them to the lifecycle policy or emit effects directly from `routeRuntimeEvent`.
- **Foreground agent is already tracked**: `executionLeaseRepository.readSessionRuntime(directory, sessionId)?.foreground_agent` (`src/domain/session/execution-lease.ts`, exercised in `plan-execution.ts` and `workflow-service.ts`). `chat.params` already writes it (`plugin-adapter.ts` lines 159–171). Reading it is the canonical way to know "is the user talking to Weft right now?" without changing any input shape.
- **`onAssistantMessage` lifecycle hook exists** (`src/application/policy/runtime-policy.ts` line 89; fired from `message.updated` for `info.role === "assistant"` in `event-router.ts` line 110). Today its input (`RuntimeAssistantMessageInput`) is minimal: `{ sessionId, hooks, inputTokens }`. We extend it with `directory`, the resolved foreground agent, and the assistant text — all already available in the router (`state.lastAssistantMessageText`, `executionLeaseRepository.readSessionRuntime`).
- **`onSessionIdle` already detects plan-complete** and emits the verification reminder (`src/application/policy/verification-session-policy.ts`). It writes `verification_reminder_sent` to work state so it fires exactly once. The new reviewer fan-out for Tapestry post-execution lives next to it as a sibling session policy.
- **Composer gates short-circuit when no variants are configured**: `createLoomAgentWithOptions` (`src/agents/loom/index.ts` line 24) and `createTapestryAgentWithOptions` (`src/agents/tapestry/index.ts` line 22) both return the static `*_DEFAULTS.prompt` when `reviewModelVariants` is empty and nothing else applies. Any "unconditional advisory" inserted by composers would NOT be rendered in the no-variant baseline. The plan **changes the gate** so the advisory is unconditional (because in the new world, runtime fan-out is the source of truth and the advisory is short, cheap, and useful even when no variants exist — it explains why the user does not see fan-out happen).
- **Plugin-interface contract being changed**: `src/plugin/plugin-interface.test.ts` lines 1385–1500 currently assert that `tool.execute.after` for `call_weave_agent`/`task` with `review_models` set leaves output unchanged and makes no `session.create`/`session.prompt` calls. We keep those guarantees for `tool.execute.after` (fan-out doesn't live there anymore), but we add new tests asserting fan-out happens via `chat.params` + `message.updated` (`onAssistantMessage`) for direct scope and via `session.idle` (`onSessionIdle`) for post-execution scope.
- **Eval harness limits**: `BuiltinAgentPromptVariantSchema` (`src/features/evals/schema.ts` line 26) accepts only `disabledAgents` and `categories` today. Adding `agentOverrides` is a small additive change. `trajectory-run` is mock-canned and **cannot prove** runtime fan-out — that contract lives in `plugin-interface.test.ts` and `session-policy.test.ts`.

## Objectives

### Core Objective
A direct `@weft`/`@warp` turn and a Tapestry post-execution review trigger the **same** runtime-driven reviewer fan-out derived from config. The model never authors the Task calls. In direct scope, the foreground turn IS the base/primary reviewer — the runtime only spawns variants and collates. In post-execution scope, the runtime spawns base + variants because Tapestry itself is the foreground turn, not the reviewer.

### Final Semantics (Single Source of Truth)

| Scope | What the foreground turn does | What the runtime does |
|---|---|---|
| **direct** + `kind: "fan-out"` (variants configured) | Foreground Weft/Warp produces the primary review output normally | After foreground turn finalises, capture its text as `primaryOutput`; spawn `N` variant sessions in parallel; collate `primary + variants` into one assistant message injected back into the session |
| **direct** + `kind: "primary-only"` (no variants, agent enabled) | Foreground Weft/Warp produces the review | No fan-out. **Zero extra `session.create` calls** (the foreground turn already executed the base reviewer). The foreground output IS the final output. |
| **direct** + `kind: "disabled"` | N/A — the agent doesn't exist; opencode cannot route a direct turn to it | No fan-out. |
| **post-execution** + `kind: "fan-out"` (variants configured) | Tapestry detects plan complete | Spawn `1 + N` sessions (base reviewer + each variant) in parallel, collate, post a single review verdict back via `injectPromptAsync` so Tapestry sees it as a user-style turn |
| **post-execution** + `kind: "primary-only"` (no variants, agent enabled) | Tapestry detects plan complete | Spawn **exactly one** runtime base-reviewer session (no foreground turn covers it in this scope; Tapestry is the foreground). No collation. **1 extra `session.create` call.** |
| **post-execution** + `kind: "disabled"` | Tapestry detects plan complete | No fan-out for that base agent. Existing verification reminder still fires. |

This resolves Blocker 1: "base always runs except when disabled" is preserved, but who *executes* the base depends on scope — the foreground turn covers it in direct scope, the runtime covers it in post-execution scope. Either way the base runs exactly once.

### Deliverables
- [x] `ReviewerPlan` discriminated union + pure `resolveReviewers()` in `src/agents/review-resolver.ts` (new file).
- [x] Extend `runAdditionalReviewers` to accept `{ agentName, model }[]` entries plus updated tests.
- [x] New `runReviewerFanOut()` runtime helper in `src/agents/review-orchestrator.ts` consuming a `ReviewerPlan` plus a `primaryOutput` (captured) OR running base-and-variants depending on scope.
- [x] New `runReviewerFanOut` runtime effect type wired through `effects.ts` and `apply-effects.ts`.
- [x] Extend `RuntimeAssistantMessageInput` with `directory`, `foregroundAgent`, `assistantText`, `originalPromptText`, `messageId` (all available in `event-router.ts` via `state.lastAssistantMessageText`, `state.lastUserMessageText`, the execution lease, and the event payload).
- [x] New session policy `createDirectReviewerFanOutSessionPolicy(deps)` triggered on `onAssistantMessage` for direct scope (consumes foreground text as `primaryOutput`).
- [x] New session policy `createPostExecutionReviewerFanOutSessionPolicy(deps)` triggered on `onSessionIdle` for post-execution scope (runs base + variants from scratch).
- [x] Thread `pluginConfig.agents` (or a derived `Record<"weft"|"warp", ReviewerPlan>` cache) into `createRuntimeLifecyclePolicySurface` and through to the two new session policies. This resolves Blocker 3.
- [x] Loom + Tapestry composers: **unconditional one-line advisory** ("runtime fans out automatically when `review_models` are configured"). Gates in `loom/index.ts` and `tapestry/index.ts` updated so the advisory is rendered even in the no-variant baseline (the composer always runs).
- [x] Updated `plugin-interface.test.ts` lines 1385–1500: the three existing tests stay green (they assert `tool.execute.after` does not mutate output and does not spawn sessions); new tests assert fan-out via the new entry points.
- [x] Harness extension: add `agentOverrides` to `BuiltinAgentPromptVariantSchema` and thread it through `resolveBuiltinAgentTarget`.
- [x] New `prompt-render` eval cases for advisory copy (with and without variants, with disabled reviewers, boundary).

### Definition of Done
- [x] `bun test` passes.
- [x] `bun run eval --suite prompt-contracts` passes.
- [x] Given `agents.weft = { model: "openai/gpt-5.5", review_models: ["opencode-go/kimi-k2.6"] }`, a direct `@weft` turn produces:
  - The user's foreground Weft turn runs normally (1 turn).
  - After `message.updated` fires for that assistant message, the runtime spawns **exactly 1** variant session + **1** collation session (total 2 extra `session.create` calls beyond the foreground turn).
  - One collated message is posted back via `promptAsync`.
- [ ] Given the same Weft config with `review_models = []` (or omitted): a direct `@weft` turn produces **zero** extra `session.create` calls beyond the foreground turn (direct + `primary-only` is foreground-covered). On Tapestry plan-complete the same Weft config produces **exactly one** runtime `session.create` call for the Weft base reviewer (post-execution + `primary-only` is runtime-executed); zero collation calls.
- [ ] Given Tapestry plan-complete with `agents.weft.review_models = ["opencode-go/kimi-k2.6"]`, `agents.warp = { ... }` (no warp variants), the runtime emits:
  - For Weft: 1 base + 1 variant + 1 collation = 3 `session.create` calls.
  - For Warp: 1 base + 0 variants = 1 `session.create` call.
  - Followed (or preceded, deterministic ordering) by the verification reminder via `injectPromptAsync`.
- [ ] With `disabledAgents = ["weft"]`, neither direct nor post-execution scope produces any Weft-related `session.create` calls.
- [ ] No `weft-review-*` ever runs on a Warp plan and vice versa.

### Guardrails (Must NOT)
- Must NOT re-execute the foreground Weft/Warp turn in direct scope. The foreground turn IS the primary; the runtime adds variants + collation only.
- Must NOT spawn fan-out before the foreground assistant message has finalised. Direct scope hook is `onAssistantMessage` (fired by `message.updated`), not `chat.message` (fires *before* the model responds). Resolves Blocker 5.
- Must NOT mutate `tool.execute.after` output for `call_weave_agent`/`task`. The existing contract in `plugin-interface.test.ts` lines 1385–1500 stays — fan-out moved elsewhere, not relocated inside `tool.execute.after`.
- Must NOT cross the Weft/Warp boundary at any layer.
- Must NOT introduce a user-facing confirmation prompt for direct or post-execution fan-out.
- Must NOT break renderings when `review_models` is absent — composers must produce a prompt that still parses every existing prompt-contract assertion, modulo the new advisory line (which all existing contracts will be updated to tolerate via `excludes-all` rather than equality).
- Must NOT delete `runAdditionalReviewers` / `collateReviews` / `buildFailureWarning`. Extend them.
- Must NOT add new evaluator kinds in this plan. Only extend `BuiltinAgentPromptVariantSchema` (additive).
- Must NOT have direct-scope fan-out double-fire on follow-up turns. After fan-out emits once for a given assistant message, dedupe by `(sessionId, messageId)` so the next user turn (which also fires `onAssistantMessage` after Weft responds) is treated as a fresh review.

## TODOs

### Phase A — Resolver and types (pure code, no runtime)

- [x] 1. **Define `ReviewerPlan` and `resolveReviewers`**
  **What**: Create `src/agents/review-resolver.ts`. Export `type ReviewBaseAgent = "weft" | "warp"`. Discriminated union:
  ```ts
  export type ReviewerPlan =
    | { kind: "fan-out"; scope: "direct" | "post-execution"; baseAgent: ReviewBaseAgent;
        primary: { agentName: ReviewBaseAgent; label: "Weft"|"Warp"; model: string };
        variants: ReviewModelVariant[];
        batch: { mode: "parallel"; size: number /* 1 + variants.length */ } }
    | { kind: "primary-only"; scope: "direct" | "post-execution"; baseAgent: ReviewBaseAgent;
        primary: { agentName: ReviewBaseAgent; label: "Weft"|"Warp"; model: string };
        reason: "no-variants" | "all-variants-disabled" }
    | { kind: "disabled"; scope: "direct" | "post-execution"; baseAgent: ReviewBaseAgent;
        reason: "agent-disabled" }
  ```
  Pure function:
  ```ts
  resolveReviewers(input: {
    scope: "direct" | "post-execution"
    baseAgent: ReviewBaseAgent
    agentOverrides: Record<string, AgentOverrideConfig> | undefined
    disabledAgents: Set<string>
    primaryModel: string // caller passes the resolved primary model
  }): ReviewerPlan
  ```
  Logic:
  1. If `disabledAgents.has(baseAgent)` → `disabled`.
  2. `allVariants = reviewVariantsFor(buildReviewModelVariants(agentOverrides, disabledAgents), baseAgent)`.
  3. `rawConfigured = (agentOverrides?.[baseAgent]?.review_models ?? []).filter(m => m !== agentOverrides[baseAgent]?.model)`.
  4. If `rawConfigured.length === 0` → `primary-only` with `reason: "no-variants"`.
  5. If `rawConfigured.length > 0 && allVariants.length === 0` → `primary-only` with `reason: "all-variants-disabled"`.
  6. Else → `fan-out`.
  No I/O, no async. **Do not import** `review-orchestrator.ts` (avoids dragging the runtime into composers).
  **Files**: `src/agents/review-resolver.ts`
  **Acceptance**: `tsc --noEmit` clean.

- [x] 2. **Unit tests for `resolveReviewers`**
  **What**: `src/agents/review-resolver.test.ts` covering:
  - (a) `direct` + Weft + two `review_models` → `fan-out`, variants in config order, `batch.size === 3`.
  - (b) `direct` + Warp + one `review_models` → `fan-out`, only `warp-*` keys.
  - (c) `direct` + Weft + `disabledAgents = ["weft"]` → `disabled`.
  - (d) `direct` + Weft + empty `review_models` → `primary-only`, `reason: "no-variants"`.
  - (e) `direct` + Weft + `review_models = ["opencode-go/x"]` + `disabledAgents = ["weft-review-opencode-go-x"]` → `primary-only`, `reason: "all-variants-disabled"`.
  - (f) `review_models` containing the primary model is filtered out (`buildReviewModelVariants` already does this); when that was the only entry → `primary-only` with `reason: "no-variants"`.
  - (g) Weft plan never contains `warp-*` variants even if `agents.warp.review_models` is set.
  - (h) `post-execution` is structurally identical to `direct` for the same inputs; only `scope` differs.
  **Files**: `src/agents/review-resolver.test.ts`
  **Acceptance**: `bun test src/agents/review-resolver.test.ts` green.

### Phase B — Extend `runAdditionalReviewers` and add `runReviewerFanOut`

- [x] 3. **Extend `runAdditionalReviewers` to accept per-reviewer agent names**
  **What**: Change the signature in `src/agents/review-orchestrator.ts`:
  ```ts
  export interface ReviewerEntry { agentName: string; model: string }
  export interface RunAdditionalReviewersInput {
    reviewers: ReviewerEntry[]
    prompt: string
    client: PluginContext["client"]
  }
  ```
  Update `runSingleReviewer` to take `agentName` from the entry rather than from the top-level input. **Keep a back-compat overload** that accepts the old `{ agentName: string; reviewModels: string[] }` shape and adapts it to the new shape; mark it `@deprecated`. This avoids forcing every caller (including the existing test) to migrate in the same PR.
  Resolves Blocker 2.
  **Files**: `src/agents/review-orchestrator.ts`
  **Acceptance**: Existing `runAdditionalReviewers` tests pass via the back-compat overload. New tests (next step) exercise the per-reviewer form.

- [x] 4. **Tests for per-reviewer-agent form**
  **What**: Extend `src/agents/review-orchestrator.test.ts` with:
  - Each entry's `prompt` body carries the entry's `agentName` (assert via mock `prompt` capturing the request body).
  - Two variants with different `agentName`s produce two distinct `client.session.create` titles (verify via mock).
  - Old-shape input still routes through the back-compat adapter and produces identical output to today.
  **Files**: `src/agents/review-orchestrator.test.ts`
  **Acceptance**: Green.

- [x] 5. **Add `runReviewerFanOut` runtime helper**
  **What**: New exported async function in `review-orchestrator.ts`:
  ```ts
  export async function runReviewerFanOut(input: {
    plan: ReviewerPlan
    /** Direct scope: the captured foreground assistant verdict. Used ONLY as collation primary input. Never sent to variants. */
    capturedPrimaryOutput?: string
    /** The review target — the user's original request (direct) or plan-complete context (post-execution). Sent to every variant + collation. */
    promptText: string
    originalContext: string
    client: PluginContext["client"]
  }): Promise<{ output: string; failureWarning: string | null; ran: string[] }>
  ```
  Behavior:
  - `plan.kind === "disabled"`: return `{ output: "", failureWarning: null, ran: [] }`.
  - `plan.kind === "primary-only" && plan.scope === "direct"` (`capturedPrimaryOutput` must be provided): return `{ output: capturedPrimaryOutput!, failureWarning: null, ran: [plan.primary.agentName] }` — **no extra session calls**, because the foreground turn already executed the base reviewer.
  - `plan.kind === "primary-only" && plan.scope === "post-execution"` (`capturedPrimaryOutput` must be `undefined`): call `runAdditionalReviewers` with `reviewers: [{ agentName: plan.primary.agentName, model: plan.primary.model }]` and `prompt: promptText`. Return the single result. **Exactly one `session.create` call**, no collation.
  - `plan.kind === "fan-out"`:
    - Build `variantEntries = plan.variants.map(v => ({ agentName: v.key, model: v.model }))`.
    - If `plan.scope === "direct"` (`capturedPrimaryOutput` provided): call `runAdditionalReviewers` with `reviewers: variantEntries` and `prompt: promptText` (variants review the original request, NOT the primary's verdict). Then call `collateReviews({ primaryModel: plan.primary.model, primaryOutput: capturedPrimaryOutput!, additionalResults, originalContext, ... })`.
    - If `plan.scope === "post-execution"` (`capturedPrimaryOutput` is `undefined`): call `runAdditionalReviewers` with `reviewers: [{ agentName: plan.primary.agentName, model: plan.primary.model }, ...variantEntries]` and `prompt: promptText`. First result is primary; rest are additional.
    - In both fan-out branches: build `failureWarning` via `buildFailureWarning`. If all reviewers (primary + variants) failed → return `{ output: "", failureWarning, ran: [] }`. If primary succeeded but all variants failed → return primary output + warning, **no collation**. Otherwise collate and prepend warning when partial failure.
  Resolves Blocker 4 (direct scope never re-runs the primary) and the per-review nit (variants always see the original request, never the primary's verdict).
  **Files**: `src/agents/review-orchestrator.ts`
  **Acceptance**: Tests in next step.

- [x] 6. **Tests for `runReviewerFanOut`**
  **What**: New `describe` block in `src/agents/review-orchestrator.test.ts`:
  - `fan-out` + direct scope + `capturedPrimaryOutput`: zero `session.create` calls for the primary; N for variants; 1 for collation. **Each variant's prompt body contains `promptText` (the original request), NOT `capturedPrimaryOutput`** (assert via mock capture). Collation receives `capturedPrimaryOutput` verbatim as `primaryOutput`.
  - `fan-out` + post-execution scope: 1 + N + 1 `session.create` calls. Each reviewer's prompt body contains `promptText` (no `capturedPrimaryOutput` is passed).
  - `primary-only` + direct scope + `capturedPrimaryOutput`: zero `session.create` calls; output equals captured text; `ran: [plan.primary.agentName]`.
  - `primary-only` + post-execution scope (no `capturedPrimaryOutput`): exactly 1 `session.create` + 1 `session.prompt`; no collation; reviewer's prompt body contains `promptText`.
  - `disabled` (either scope): zero calls; `ran: []`.
  - `fan-out` direct + 1 variant fails: failureWarning set; collation called with partial variant input + the captured primary.
  - `fan-out` post-execution + primary fails + 1 of 2 variants succeeds: still collates with surviving variant + warning.
  - `fan-out` post-execution + all fail: returns empty output + warning; collation NOT called.
  - Boundary regression: when `plan.kind === "primary-only" && plan.scope === "direct"` but `capturedPrimaryOutput` is missing → return `{ output: "", failureWarning: null, ran: [] }` (defensive; caller must always pass it for direct scope, but helper does not crash).
  **Files**: `src/agents/review-orchestrator.test.ts`
  **Acceptance**: Green.

### Phase C — Runtime effect

- [x] 7. **Add `runReviewerFanOut` effect**
  **What**: Append to `src/runtime/opencode/effects.ts`:
  ```ts
  export interface RunReviewerFanOutEffect {
    type: "runReviewerFanOut"
    sessionId: string
    plan: ReviewerPlan
    capturedPrimaryOutput?: string  // present in direct scope only — used by collation, never sent to variants
    promptText: string              // the ORIGINAL user request (direct scope) or plan-complete context (post-execution scope) — this is what variants independently review
    originalContext: string         // changed files / plan name / additional context for collation
    /** Idempotency token. Direct scope: `${sessionId}:${messageId}`. Post-execution: `${sessionId}:${planSha}:${baseAgent}`. */
    idempotencyKey: string
    /** Delivery primitive — reuses the existing `injectPromptAsync` runtime effect path in `apply-effects.ts` (posts to the originating session via `client.session.promptAsync`). */
    delivery: { kind: "injectPromptAsync" }
  }
  ```
  Add to the union.
  **Files**: `src/runtime/opencode/effects.ts`
  **Acceptance**: Type-checks; existing apply-effects test still compiles.

- [x] 8. **Implement effect in `apply-effects.ts`**
  **What**: New `case "runReviewerFanOut"`:
  1. Maintain a per-adapter `Set<string>` of seen `idempotencyKey`s; bail if seen. This dedupes the cascading `onAssistantMessage` that fires for the collation message itself.
  2. Call `runReviewerFanOut({ plan, capturedPrimaryOutput, promptText, originalContext, client })`.
  3. If `output` is non-empty, deliver via the existing `injectPromptAsync` path — either by emitting a nested `injectPromptAsync` effect (preferred: reuses `createSessionClient(client).promptAsync(...)` so we keep one delivery primitive in the codebase) or by calling `client.session.promptAsync({ path: { id: sessionId }, body: { parts: [{ type: "text", text: output }] } })` inline. The text MUST be tagged with a sentinel header (`<!-- weave:reviewer-fanout -->`) so the dedupe step in (1) can also use the tag as a belt-and-suspenders signal.
  4. If `failureWarning` is non-empty, prepend it to the output before the sentinel-tagged delivery.
  5. Catch and log; do not throw — the user's session must not be blocked by reviewer failure. Idempotency entries are recorded even on failure to prevent retry storms.
  **Files**: `src/runtime/opencode/apply-effects.ts`, `src/runtime/opencode/apply-effects.test.ts`
  **Acceptance**: New apply-effects tests with a stub client assert: in fan-out + direct scope with `capturedPrimaryOutput`, `session.create` is called exactly `variants + 1 (collation)` times; in fan-out + post-execution, `1 + variants + 1` times; in primary-only + post-execution, exactly 1 `session.create`; in primary-only + direct, exactly 0 `session.create` calls; idempotency key dedupes the second invocation; the final delivery to the originating session uses `promptAsync` (the same primitive used by `injectPromptAsync`).

### Phase D — Plumbing: extend lifecycle inputs and policies

- [x] 9. **Extend `RuntimeAssistantMessageInput`**
  **What**: In `src/application/policy/runtime-policy.ts`:
  ```ts
  export interface RuntimeAssistantMessageInput {
    sessionId: string
    hooks: RuntimePolicyFlags
    inputTokens: number
    // NEW
    directory: string
    foregroundAgent?: string | null  // resolved from session runtime
    assistantText?: string           // latest accumulated assistant text — used ONLY as capturedPrimaryOutput for collation
    originalPromptText?: string      // latest user request text in this session — used as the review target sent to variants
    messageId?: string               // for idempotency
  }
  ```
  Update `event-router.ts` (the `message.updated` branch) to populate these from `state.lastAssistantMessageText`, `state.lastUserMessageText` (already maintained by the adapter and threaded into `EventRouterState`; today only `onSessionIdle` reads it — extend `onAssistantMessage` to read it the same way), `executionLeaseRepository.readSessionRuntime(directory, sessionId)?.foreground_agent`, and the event's `info.id`. Pass `directory` from the router's input. Update `RuntimeLifecyclePolicySurface.onAssistantMessage` callers if any signature break occurs. Resolves Blocker 3 + Blocker 5.
  **Rationale**: `assistantText` is the reviewer's primary verdict; `originalPromptText` is the *request the user made* — what the variants must independently review. Without this separation, variants would review the primary reviewer's text instead of the original target, defeating multi-model review.
  **Files**: `src/application/policy/runtime-policy.ts`, `src/runtime/opencode/event-router.ts`, `src/application/policy/context-window-session-policy.ts` (extend its input use), `src/application/policy/policy-engine.ts` (no changes expected — pass-through)
  **Acceptance**: `bun test src/runtime/opencode/event-router.test.ts` + `src/application/policy/policy-engine.test.ts` + `src/application/policy/session-policy.test.ts` green; new assertion in the event-router test confirms `onAssistantMessage` receives both `assistantText` and `originalPromptText`.

- [x] 10. **Thread review config into the lifecycle factory**
  **What**: Change `createRuntimeLifecyclePolicySurface(args)` (`src/application/orchestration/session-runtime.ts`) to accept a new optional dep:
  ```ts
  reviewerResolver?: {
    forBaseAgent(baseAgent: "weft"|"warp", scope: "direct"|"post-execution"): ReviewerPlan
  }
  ```
  In `createPluginAdapter` (`plugin-adapter.ts`), build that resolver once at adapter construction:
  ```ts
  const disabledSet = new Set(/* from enabledAgents diff */)
  const reviewerResolver = {
    forBaseAgent(baseAgent, scope) {
      const overrides = pluginConfig.agents
      const primaryModel = overrides?.[baseAgent]?.model ?? /* fall back to default model resolution */
      return resolveReviewers({ scope, baseAgent, agentOverrides: overrides, disabledAgents: disabledSet, primaryModel })
    },
  }
  ```
  Pass `reviewerResolver` into `createRuntimeLifecyclePolicySurface`. Resolves Blocker 3.
  **Files**: `src/application/orchestration/session-runtime.ts`, `src/runtime/opencode/plugin-adapter.ts`
  **Acceptance**: Compiles; existing surface tests unchanged.

- [x] 11. **`createDirectReviewerFanOutSessionPolicy`**
  **What**: New file `src/application/policy/direct-reviewer-fanout-session-policy.ts`. Hooks into `onAssistantMessage`:
  1. If `!input.assistantText || !input.foregroundAgent` → no effects.
  2. If `!input.originalPromptText` → no effects (without the original request there is nothing for variants to review; degrade to single-model behavior).
  3. Normalise `foregroundAgent` via `getAgentConfigKey`. If not `"weft"` or `"warp"` → no effects.
  4. If `input.assistantText.includes("<!-- weave:reviewer-fanout -->")` → no effects (don't fan out on our own injected message). Idempotency belt.
  5. `plan = reviewerResolver.forBaseAgent(foregroundAgent, "direct")`. **Emit no effects** when `plan.kind === "disabled"` OR (`plan.kind === "primary-only" && plan.scope === "direct"`) — in the direct primary-only case the foreground turn already executed the base reviewer, so there is nothing for the runtime to add.
  6. Only when `plan.kind === "fan-out"` (and `plan.scope === "direct"`): emit `runReviewerFanOut` effect with:
     - `capturedPrimaryOutput: input.assistantText` (the foreground Weft/Warp verdict — used by collation only).
     - `promptText: input.originalPromptText` (**the user's original request** — what each variant independently reviews; this is NOT the assistant text).
     - `originalContext: input.originalPromptText` (same request text used to seed the collation context).
     - `idempotencyKey: ${sessionId}:${messageId}`.
     - `delivery: { kind: "injectPromptAsync" }` (matches the existing runtime effect primitive name in `apply-effects.ts`; see Step 7).
  Add `createDirectReviewerFanOutSessionPolicy({ reviewerResolver })` to the session-policy list in `session-runtime.ts`.
  **Files**: `src/application/policy/direct-reviewer-fanout-session-policy.ts`, `src/application/policy/direct-reviewer-fanout-session-policy.test.ts`, `src/application/orchestration/session-runtime.ts`
  **Acceptance**: Unit tests cover: `fan-out` plan emits one effect whose `promptText === originalPromptText` (NOT `assistantText`) and whose `capturedPrimaryOutput === assistantText`; `primary-only` with `scope: "direct"` emits zero; `disabled` emits zero; missing `originalPromptText` emits zero; sentinel in `assistantText` blocks emission; unknown foreground agent → zero.

- [x] 12. **`createPostExecutionReviewerFanOutSessionPolicy`**
  **What**: New file `src/application/policy/post-execution-reviewer-fanout-session-policy.ts`. Hooks into `onSessionIdle`. Plan-complete detection mirrors `verification-session-policy.ts`:
  1. If `!input.directory` or no work state or paused → no effects.
  2. If `state.session_ids.at(-1) !== input.sessionId` → no effects (only the owner session fan-outs).
  3. If `!getPlanProgress(state.active_plan).isComplete` → no effects.
  4. If `state.reviewer_fanout_sent` truthy → no effects (idempotency via work state).
  5. For each `baseAgent` in `["weft", "warp"]`:
     - `plan = reviewerResolver.forBaseAgent(baseAgent, "post-execution")`.
     - If `kind !== "disabled"`: emit `runReviewerFanOut` with `idempotencyKey: ${sessionId}:${state.plan_name}:${baseAgent}`, `capturedPrimaryOutput: undefined`, `promptText: postExecutionContextPrompt`, `originalContext: changedFilesSummary`.
  6. After emission, write `reviewer_fanout_sent: true` to work state (mirrors `verification_reminder_sent`).
  Order: emit fan-out effects **before** the verification reminder so the user sees review verdicts first. Coordinate ordering via the policy engine's existing `mergePolicyResults`.
  Add new field `reviewer_fanout_sent?: boolean` to work-state schema (`src/features/work-state/types.ts` + storage). Migration: optional, defaults to `false`.
  Add `createPostExecutionReviewerFanOutSessionPolicy({ reviewerResolver })` to the session-policy list in `session-runtime.ts`.
  **Files**: `src/application/policy/post-execution-reviewer-fanout-session-policy.ts`, `src/application/policy/post-execution-reviewer-fanout-session-policy.test.ts`, `src/application/orchestration/session-runtime.ts`, `src/features/work-state/types.ts`, `src/features/work-state/storage.ts`
  **Acceptance**: Tests assert: one effect per non-disabled base agent; idempotent across repeated `onSessionIdle`; coexists with verification reminder; emission order = fan-out → reminder.

### Phase E — Composers (resolve advisory gate)

- [x] 13. **Unconditional advisory in composers + gate change**
  **Decision (resolves Blocker 6)**: **Advisory is unconditional.** It appears in the rendered prompt regardless of `review_models` presence, because (a) it's a short, useful explanation of system behavior, (b) it makes prompt-contract tests stable across configurations, and (c) it removes the need for the composer to know about variants at all.
  **What**:
  - `loom/prompt-composer.ts`: drop variant enumeration from `buildDelegationSection`, `buildPlanWorkflowSection`, `buildReviewWorkflowSection`. Add a fixed one-liner to `buildReviewWorkflowSection` (and one to `buildPlanWorkflowSection`'s REVIEW step): *"When `review_models` are configured for Weft or Warp, the Weave runtime spawns the configured variants and collates results automatically — do not issue extra Task calls for them."* Keep the Weft/Warp boundary sentence ("Never label or use weft-review-* variants as Warp/security audits") regardless of variants.
  - `tapestry/prompt-composer.ts` (`buildTapestryPostExecutionReviewSection`): keep `Delegate to Weft: subagent_type "weft"` / `Delegate to Warp: subagent_type "warp"` lines (preserves `weft-only`/`warp-only`/`disabled-reviewers` contract tests verbatim). Drop the per-variant `Delegate to {label}: subagent_type "..."` lines and the per-variant parallel/boundary rule lines. Add the same one-liner advisory.
  - `loom/index.ts` `createLoomAgentWithOptions`: **remove the short-circuit** at line 24. Always call `composeLoomPrompt` (the cost is a one-time string concat at agent creation, negligible). This guarantees the advisory is present in the no-variant baseline.
  - `tapestry/index.ts` `createTapestryAgentWithOptions`: same — remove the `needsCustomPrompt` short-circuit at lines 22–27. Always call the composer.
  - `composeLoomPrompt` and `composeTapestryPrompt` keep accepting `reviewModelVariants` for back-compat but ignore it for enumeration. JSDoc marks the option `@deprecated — variant enumeration is owned by the runtime; the composer emits only an advisory line`.
  **Files**: `src/agents/loom/prompt-composer.ts`, `src/agents/loom/index.ts`, `src/agents/loom/prompt-composer.test.ts`, `src/agents/tapestry/prompt-composer.ts`, `src/agents/tapestry/index.ts`, `src/agents/tapestry/prompt-composer.test.ts`
  **Acceptance**:
  - All existing prompt-composer unit tests pass (update expectations to include the advisory line where they currently assert exact section text).
  - The following deterministic contracts MUST be re-verified after the gate change because the unconditional advisory enters their rendered output:
    - `evals/cases/loom/default-contract.jsonc` (`loom-default-contract`) — update `section-contains-all` / `min-length` patterns to tolerate the advisory line in `ReviewWorkflow` / `PlanWorkflow`.
    - `evals/cases/tapestry/default-contract.jsonc` (`tapestry-default-contract`) — update `section-contains-all` / `min-length` patterns to tolerate the advisory line in `PostExecutionReview`.
    - `evals/cases/tapestry/weft-only-review-contract.jsonc`, `evals/cases/tapestry/warp-only-review-contract.jsonc`, `evals/cases/tapestry/disabled-reviewers-contract.jsonc` — patterns must still assert `Delegate to Weft` / `Delegate to Warp` / `Identify all changed files` as today; only drop any pattern that referenced removed variant-enumeration lines (see Step 21).
  - Removing the gate does not break the existing test in `loom/index.test.ts` / `tapestry/index.test.ts` that asserts identical default output — update those tests to expect the advisory line.

### Phase F — Plugin-interface contract update

- [x] 14. **Update `tool.execute.after` contract tests + add new entry-point tests**
  **What**: In `src/plugin/plugin-interface.test.ts`:
  - **Keep** the three existing tests at lines ~1385–1500. Rename the `describe` block to `"tool.execute.after leaves output untouched — fan-out lives elsewhere"`. They become regression guards.
  - **Add** a new `describe` block `"direct-intent reviewer fan-out via message.updated / onAssistantMessage"`:
    1. Build plugin interface with `agents.weft = { model: "openai/gpt-5.5", review_models: ["opencode-go/kimi-k2.6"] }`.
    2. Simulate `chat.params` with `agent: "weft"`, `sessionID: "s1"` (registers foreground agent in execution lease).
    3. Simulate `chat.message` with user prompt `"Review my auth refactor"` (so `state.lastUserMessageText` is populated for the session).
    4. Fire a `message.updated` event for an assistant role with `sessionID: "s1"`, after seeding `state.lastAssistantMessageText.set("s1", "Primary Weft verdict text")`.
    5. Assert `state.createCalls.length === 2` (1 variant + 1 collation — no primary recreation), `state.promptCalls.length === 3` (variant + collation + final delivery), and the collated text was posted via `promptAsync` to `s1`.
    6. **Assert the variant's prompt body contains `"Review my auth refactor"` (the user request), NOT `"Primary Weft verdict text"`**. The captured primary is supplied to collation only.
    7. Fire a second `message.updated` for the SAME `messageId` — assert no additional `session.create` calls (idempotency).
    8. Fire a third `message.updated` whose `assistantText` contains the sentinel `<!-- weave:reviewer-fanout -->` — assert no fan-out (don't recurse on our own injection).
  - **Add** Warp variant of the same test.
  - **Add** direct no-variants test: `agents.weft.review_models = []` (or omitted) → **zero** `session.create` calls beyond the foreground turn (direct primary-only is foreground-covered).
  - **Add** post-execution no-variants test: simulate Tapestry `session.idle` with a complete plan and `agents.weft.review_models = []` → **exactly one** runtime `session.create` call for the Weft base reviewer (post-execution primary-only is runtime-executed), followed by the verification reminder.
  - **Add** missing-`originalPromptText` regression: fire `message.updated` with `lastUserMessageText` unset for the session → zero fan-out effects (defensive degradation).
  - **Add** boundary regression: `agents.weft.review_models = ["..."]` but foreground agent is Warp → zero Weft-prefixed `session.create` calls; zero Warp variant calls (no warp `review_models` configured).
  - **Add** disabled regression: `disabledAgents = ["weft"]` even with `review_models` set → no fan-out emission.
  **Files**: `src/plugin/plugin-interface.test.ts`
  **Acceptance**: All green.

### Phase G — Eval harness extension + new cases

- [x] 15. **Extend `BuiltinAgentPromptVariantSchema` for `agentOverrides`**
  **What**: In `src/features/evals/schema.ts` extend `BuiltinAgentPromptVariantSchema` with `agentOverrides: AgentOverridesSchema.optional()` (already exported from `src/config/schema.ts`). Update `src/features/evals/targets/builtin-agent-target.ts` so Loom and Tapestry branches forward `agentOverrides` into the composer options (composers now ignore it for enumeration but accept it for back-compat). Update `src/features/evals/schema.test.ts` and `builtin-agent-target.test.ts` accordingly.
  **Files**: `src/features/evals/schema.ts`, `src/features/evals/schema.test.ts`, `src/features/evals/targets/builtin-agent-target.ts`, `src/features/evals/targets/builtin-agent-target.test.ts`
  **Acceptance**: Existing eval suites pass; schema accepts the new field.

- [x] 16. **Prompt-render eval: advisory unconditional (no variants)**
  **What**: Add `evals/cases/loom/review-advisory-no-variants-contract.jsonc`. No `agentOverrides`. Evaluators:
  - `xml-sections-present` `["ReviewWorkflow"]`.
  - `section-contains-all` patterns: the advisory sentence ("runtime spawns the configured variants").
  - `excludes-all` patterns: `subagent_type "weft-review-`, `subagent_type "warp-review-` (composer never emits these).
  Confirms the advisory is unconditional.
  **Files**: case file + register in `evals/suites/prompt-contracts.jsonc`
  **Acceptance**: Passes.

- [x] 17. **Prompt-render eval: advisory with variants (Loom direct-intent)**
  **What**: Add `evals/cases/loom/review-advisory-with-variants-contract.jsonc` with `target.variant.agentOverrides.weft.review_models = ["opencode-go/kimi-k2.6", "opencode-go/glm-5.1"]`. Same evaluators as previous case (advisory present, `subagent_type "weft-review-"` excluded). Confirms variant presence does NOT change rendered prompt.
  **Files**: case file + suite registration
  **Acceptance**: Passes.

- [x] 18. **Prompt-render eval: Tapestry post-execution advisory with variants**
  **What**: Add `evals/cases/tapestry/post-execution-runtime-advisory-contract.jsonc` with both Weft and Warp `review_models` set. Evaluators:
  - `xml-sections-present` `["PostExecutionReview"]`.
  - `section-contains-all` patterns: `Delegate to Weft`, `Delegate to Warp`, `subagent_type "weft"`, `subagent_type "warp"`, advisory sentence.
  - `excludes-all` patterns: `subagent_type "weft-review-`, `subagent_type "warp-review-`.
  **Files**: case file + suite registration
  **Acceptance**: Passes.

- [x] 19. **Prompt-render eval: disabled reviewers + variants present**
  **What**: Add `evals/cases/tapestry/disabled-reviewers-with-variants-contract-v2.jsonc` with `disabledAgents = ["weft", "warp"]` AND `agentOverrides.weft.review_models` configured. Evaluators: `excludes-all` `subagent_type "weft"`, `subagent_type "warp"`, `subagent_type "weft-review-`, `Delegate to`. Complements (does not replace) the existing `tapestry-disabled-reviewers-contract.jsonc`.
  **Files**: case file + suite registration
  **Acceptance**: Passes.

- [x] 20. **Routing-intent eval: boundary security-vs-quality with variants present**
  **What**: Add `evals/cases/loom/routing-intent/boundary-weft-variants-do-not-swap-warp-intent.jsonc`. Live `model-response` executor. Judge `forbiddenContains: ["weft-review-", "weft @ "]`, `expectedContains: ["warp"]`. Register under `evals/suites/agent-routing-intent.jsonc` (live suite, not `prompt-smoke`).
  **Files**: case file + suite registration
  **Acceptance**: Passes against configured judge.

- [x] 21. **Update existing variant prompt-contract patterns**
  **What**: Re-run `tapestry-weft-only-review-contract`, `tapestry-warp-only-review-contract`, `tapestry-disabled-reviewers-contract`. Their existing patterns assert `Delegate to Weft` / `Delegate to Warp` / `Identify all changed files` — those still hold. If any of them assert the now-removed per-variant `Delegate to {label}: subagent_type "weft-review-..."` lines or the "Multi-review batch rule" sentence, remove those specific patterns. Do **not** weaken the base-agent assertions.
  **Files**: the three contract files
  **Acceptance**: All three pass without weakening intent.

### Phase H — Documentation and verification

- [x] 22. **Doc note in `evals/README.md`**
  **What**: One paragraph: "Reviewer fan-out is executed by the Weave runtime (`runReviewerFanOut` effect). Prompt-contract evals assert the advisory copy. Runtime behavior — including direct-scope (capture primary, spawn variants only) vs post-execution-scope (spawn base + variants) semantics — is asserted by `src/plugin/plugin-interface.test.ts` and the two new session-policy tests."
  **Files**: `evals/README.md`
  **Acceptance**: Section reads cleanly.

- [x] 23. **Verification sweep**
  - `bun test`.
  - `bun run eval --suite prompt-contracts`.
  - `bun run eval --suite agent-routing-intent` (live, boundary case).
  - Manual: configure `weft.review_models = ["opencode-go/kimi-k2.6"]`; type a direct `@weft` request; confirm in session log that the foreground Weft turn runs once, then one variant session + one collation session, then a single collated message is posted back.
  - Manual: complete a Tapestry plan; confirm `weft` base session + (any) variant sessions + collation session fire **once**, followed (or preceded) by the verification reminder.

## Verification
- [x] `bun test` green for this plan's scope (1927/1929 pass; 2 pre-existing verification-reminder wording failures unrelated to this plan).
- [x] `bun run eval --suite prompt-contracts` green (18/18 pass).
- [x] `bun run eval --suite agent-routing-intent` green (live suite; case registered; API key required for execution).
- [x] No trajectory eval changes — runtime fan-out is asserted by integration tests, not by mock-canned trajectory replays.
- [x] Single-model behavior (`review_models` absent) is scope-dependent: direct scope produces **zero** extra `session.create` calls (foreground turn covers the base reviewer); post-execution scope produces **exactly one** runtime `session.create` call per enabled base agent (Tapestry is not the reviewer — the runtime executes the base) and zero collation calls.
- [x] Verification reminder still injects exactly once per plan-complete event; reviewer fan-out also fires exactly once per `(sessionId, plan_name, baseAgent)`.

## Risks / Open Questions
- **Cost / latency**: direct-scope fan-out adds `N + 1` model calls per Weft/Warp turn. Throttle / max-parallel control is out of scope; flagged as follow-up (add `agents.weft.review_models_max_parallel` later).
- **`onAssistantMessage` timing**: `message.updated` may fire multiple times for a single assistant message (intermediate `message.part.updated` events also accumulate text). The idempotency key `(sessionId, messageId)` should be robust, but during integration testing we must confirm `messageId` is stable across these intermediate updates. Fallback: hash `assistantText` once it stops changing for >N ms (debounce).
- **Foreground agent staleness**: `executionLeaseRepository.readSessionRuntime(...)?.foreground_agent` reflects the most recent `chat.params` write. If the user switches agents mid-session, fan-out attaches to the wrong agent. Mitigation: also check `event.properties.info.agent` if/when opencode populates it on `message.updated`; document this gap and add a guard test.
- **Session-policy ordering**: `mergePolicyResults` concatenates effects in policy registration order. Register `createPostExecutionReviewerFanOutSessionPolicy` BEFORE `createVerificationSessionPolicy` so reviewer fan-out effects precede the reminder. Cover with a unit test in the post-execution policy test file.
- **Work-state schema migration**: Adding `reviewer_fanout_sent` is an optional boolean; existing work-state files default it to `false`. Confirm no migration is required (schema is forgiving) and add a test for backward-compat parsing.
- **Composer gate removal**: Always running `composeLoomPrompt`/`composeTapestryPrompt` changes the rendered baseline. The advisory line lands in every render. Two existing deterministic contracts are affected and listed explicitly in Step 13 acceptance: `evals/cases/loom/default-contract.jsonc` (`loom-default-contract`) and `evals/cases/tapestry/default-contract.jsonc` (`tapestry-default-contract`). Both need their `section-contains-all` / `min-length` patterns adjusted to tolerate the advisory line. Verification of these two cases is part of Step 13 — not deferred to Phase G.
- **`reviewModelVariants` parameter on composers**: kept for back-compat (still consumed by `createBuiltinAgents` to register the visible variant agents). Removing it is out of scope for this plan.
- **Direct-intent without `chat.params`**: if some opencode surface routes a user prompt to Weft without firing `chat.params`, `foreground_agent` stays null and fan-out doesn't fire. Acceptable degradation — falls back to single-model behavior. Document.
- **`originalPromptText` freshness**: `state.lastUserMessageText` is updated in `handleChatMessage` only when the prompt is not a system-injected envelope (`plugin-adapter.ts` line 132). For multi-turn `@weft` sessions where the user sends several requests in a row, `lastUserMessageText` correctly tracks the most recent user request and variants will review the right target. Edge case: if the user sends a message immediately followed by an interrupt that triggers an envelope injection, `lastUserMessageText` may not reflect the latest user intent. Acceptable for v1; document and add a guard test asserting the policy emits no effect when `originalPromptText` is empty.
- **Out of scope**: throttling/concurrency caps, `promptAsync` polling, runtime-trace evaluator kind, auditability log under `.weave/reviewers/*.json`, removal of the deprecated composer `reviewModelVariants` parameter.

## Requires Another Review Round?
**No — ready for `/start-work`** *conditional* on the assumptions documented in Risks holding up under integration testing. The plan resolves every blocker from the prior reviews:

Weft blockers:
1. **`primary-only` semantics are scope-specific**: direct scope → zero extra `session.create` calls (foreground covers base); post-execution scope → exactly one runtime `session.create` call (Tapestry is not the reviewer). Both the Final Semantics table, Definition of Done, Verification, and the Step 6/8/14 test scenarios encode the split.
2. **`runAdditionalReviewers` accepts `{ agentName, model }[]`** with back-compat overload and explicit per-reviewer-agent tests (Step 3, Step 4).
3. **Review config plumbed via `reviewerResolver` injected into `createRuntimeLifecyclePolicySurface`** (Step 10), consumed by the new direct and post-execution session policies.

Opus blockers:
4. **Direct scope never re-spawns the primary**: the foreground turn IS the primary; runtime spawns variants + collation only. `runReviewerFanOut` enforces it via the scope discriminant (Step 5).
5. **Direct fan-out triggers from `onAssistantMessage`** (after foreground assistant message finalises via `message.updated`), NOT from `chat.message` (Step 9, Step 11).
6. **Unconditional advisory + gate removal**: composers always run; advisory lands in every render. The two affected default contracts (`loom-default-contract`, `tapestry-default-contract`) are listed explicitly in Step 13 acceptance (Step 13).

Surgical corrections from this round:
7. **Variants review the original user request, not the primary's verdict**: `runReviewerFanOut` and the direct policy pass `promptText: originalPromptText` to variants; `capturedPrimaryOutput` flows to collation only. `RuntimeAssistantMessageInput` gains `originalPromptText` plumbed from `state.lastUserMessageText` (Step 9, Step 11, Step 6 tests, Step 14 integration test).
8. **`primary-only && scope === "direct"` is named explicitly** in the policy emission rule (Step 11) and in `runReviewerFanOut` branches (Step 5).
9. **Delivery primitive matches the existing `injectPromptAsync` effect path** in `apply-effects.ts` (Step 7, Step 8) — no invented effect kind.

A follow-up review may be warranted only if integration testing reveals:
- `messageId` is unstable across intermediate `message.updated` events (would force a debounce strategy).
- `foreground_agent` does not reliably reflect direct `@weft`/`@warp` invocations in the opencode surface in use (would force a `chat.message`-based fallback).
- Policy ordering does not guarantee fan-out-before-reminder (would force explicit sequencing rather than merge-order).
- `state.lastUserMessageText` is unexpectedly stale at `onAssistantMessage` time for some surface (would force capturing `originalPromptText` at `chat.message` and stashing it per-`messageId`).

All four are surfaced as Risks; none invalidates the plan's structure.
