# Improve Loom Delegation Coverage for Thread, Weft, and Warp

## TL;DR
> **Summary**: Add missing delegation coverage where it matters: runtime/integration tests that verify real delegation tool activity, plus targeted Loom eval cases for explicit Weft intent and Warp mandatory-override/boundary behavior. Keep changes scoped to existing test/eval seams so Tapestry can execute them directly.
> **Estimated Effort**: Medium

## Context
### Original Request
Improve Loom delegation coverage around Thread, Weft, and Warp by adding runtime/integration tests that prove actual delegation/tool calls, adding missing agent eval cases, and defining validation commands.

### Key Findings
- Existing Loom eval coverage already includes routing cases for Thread, Weft, and Warp, plus trajectory cases under:
  - `evals/cases/loom/routing/`
  - `evals/cases/loom/routing-intent/`
  - `evals/cases/trajectory/`
- The intent suite currently has Thread/Pattern/Warp/Shuttle/Spindle coverage, but no explicit Weft intent case in `evals/suites/agent-routing-intent.jsonc`.
- Current trajectory execution in `src/features/evals/executors/trajectory-run.ts` detects delegation from response text patterns, not from actual tool-call evidence.
- Real delegation/tool-call seams already exist in runtime tests:
  - `src/plugin/plugin-interface.test.ts` covers delegation logging for `task`
  - `src/features/analytics/session-tracker.test.ts` records delegation summaries
  - `test/testkit/host/fake-opencode-host.ts` can simulate tool execution with args
- Coverage docs in `evals/coverage-matrix.md` track prompt/eval gaps, but do not yet capture this runtime-proof gap.
- Main unknown: whether Loom delegation that matters here is always `task`, or whether `call_weave_agent` also needs first-class runtime assertions. The implementation must confirm before hard-coding expectations.

## Objectives
### Core Objective
Strengthen Loom delegation coverage so Thread, Weft, and Warp are verified at two levels: actual runtime tool/delegation evidence and targeted routing-intent evals for the missing decision boundaries.

### Deliverables
- [x] Runtime/integration coverage that proves Thread, Weft, and Warp delegation via actual tool execution artifacts
- [x] New Loom routing-intent eval cases for explicit Weft asks and Warp mandatory-override/boundary scenarios
- [x] Updated eval suite wiring and coverage notes
- [x] Clear validation commands for targeted and full-pass verification

### Definition of Done
- [x] `bun test src/plugin/plugin-interface.test.ts src/features/analytics/session-tracker.test.ts test/integration/loom-delegation-runtime.integration.test.ts`
- [x] `bun run eval --suite agent-routing-intent`
- [x] `bun run eval --suite agent-trajectory`
- [x] `bun test`

### Guardrails (Must NOT)
- [x] Must not change production agent behavior unless a test reveals a real instrumentation gap
- [x] Must not rely only on prompt text where the goal is proving actual delegation/tool calls
- [x] Must not broaden scope into Pattern/Shuttle/Spindle coverage except where shared harness updates are required
- [x] Must not add brittle eval checks that depend on long exact phrasing instead of agent/boundary intent

## TODOs

- [x] 1. Lock the delegation evidence contract
  **What**: Confirm which runtime signal counts as “actual delegation” in this repo: `task`, `call_weave_agent`, or both. End with a binary decision and reflect it in test expectations.
  **Files**: `evals/coverage-matrix.md`, `src/plugin/plugin-interface.test.ts`, `src/features/analytics/session-tracker.test.ts`
  **Acceptance**: Coverage notes explicitly call out the runtime-proof gap and the chosen evidence contract is reflected in test expectations.

- [x] 2. Add runtime/integration tests that prove real delegation activity
  **What**: Add a focused integration test that uses the fake host/runtime seams to simulate delegation tool execution and verifies that delegation is recorded for `thread`, `weft`, and `warp` with the expected tool metadata. Reuse existing analytics/plugin-hook assertions instead of creating a new harness.
  **Files**: `test/integration/loom-delegation-runtime.integration.test.ts`, `test/testkit/host/fake-opencode-host.ts`, `src/plugin/plugin-interface.test.ts`, `src/features/analytics/session-tracker.test.ts`
  **Acceptance**:
  - New tests fail if delegation is only described in prose.
  - New tests pass only when actual tool execution produces recorded delegation evidence for Thread, Weft, and Warp.
  - Include a negative-control case where prose mentions Thread/Weft/Warp but no tool executes, and assert no delegation evidence is recorded.
  - Assert both runtime hook evidence and session summary delegation entries.

- [x] 3. Add missing Loom intent evals for Weft and Warp boundaries
  **What**: Add explicit routing-intent coverage for: (a) a direct Weft review ask, (b) a Warp mandatory-override case where the user asks for review but the content is security-sensitive, and (c) a Warp boundary case showing Loom does not over-route non-security review asks to Warp.
  **Files**: `evals/cases/loom/routing-intent/route-to-weft-review-intent.jsonc`, `evals/cases/loom/routing-intent/route-to-warp-mandatory-override-intent.jsonc`, `evals/cases/loom/routing-intent/route-to-warp-boundary-intent.jsonc`, `evals/suites/agent-routing-intent.jsonc`, `evals/rubrics/loom-routing-rubric.md`
  **Acceptance**: The intent suite contains explicit Weft coverage plus Warp override/boundary cases, and the rubric clearly distinguishes “security-sensitive must go to Warp” from “ordinary quality review can stay with Weft.”

- [x] 4. Decide whether trajectory coverage needs stronger delegation evidence
  **What**: Evaluate whether the existing trajectory seam is sufficient for this scope. If needed, extend trajectory fixtures/assertions so they can represent delegation/tool evidence more explicitly than `detectDelegation()` text parsing; otherwise add only the minimal new Thread/Weft/Warp cases and document that runtime proof lives in integration tests.
  **Files**: `src/features/evals/executors/trajectory-run.ts`, `src/features/evals/executors/trajectory-run.test.ts`, `src/features/evals/evaluators/trajectory-assertion.ts`, `src/features/evals/evaluators/trajectory-assertion.test.ts`, `src/features/evals/schema.ts`, `src/features/evals/schema.test.ts`, `src/features/evals/runner.test.ts`, `evals/cases/trajectory/*.jsonc`, `evals/scenarios/*.jsonc`, `evals/suites/agent-trajectory.jsonc`
  **Acceptance**: Either (a) trajectory assertions can validate stronger delegation evidence, or (b) the suite is left intentionally text-based and the coverage matrix explicitly documents that runtime proof is owned by integration tests.

- [x] 5. Update coverage tracking and verification workflow
  **What**: Reflect the new Thread/Weft/Warp coverage in the matrix and pin the commands maintainers should run locally and in CI when touching Loom delegation behavior.
  **Files**: `evals/coverage-matrix.md`
  **Acceptance**: The matrix no longer implies Weft/Warp intent coverage is complete without the new cases, and it lists the targeted validation commands needed to verify the expanded delegation surface.

## Verification
- [x] All tests pass — revalidated on 2026-04-22; `bun test src/config/schema-json-schema.test.ts` passes and full `bun test` passes (`1706 pass, 0 fail`)
- [x] No regressions
- [x] `bun test src/plugin/plugin-interface.test.ts src/features/analytics/session-tracker.test.ts test/integration/loom-delegation-runtime.integration.test.ts`
- [x] `bun test src/features/evals/schema.test.ts src/features/evals/executors/trajectory-run.test.ts src/features/evals/evaluators/trajectory-assertion.test.ts src/features/evals/runner.test.ts`
- [x] `bun run eval --suite agent-routing-intent`
- [x] `bun run eval --suite agent-trajectory`
- [x] `bun test`

Status update: The previously recorded config-schema blocker is no longer present in the current workspace. Re-running `bun test src/config/schema-json-schema.test.ts` now passes (`6 pass, 0 fail`), and a direct generated-vs-artifact inspection shows `categories.*.patterns` matches in both generated and committed schema as `{ "type": "array", "items": { "type": "string" } }`. Full `bun test` also now passes (`1706 pass, 0 fail`). Therefore no further Loom-scoped workaround or code change remains: verification is unblocked only because the unrelated config-schema drift was resolved outside this Loom plan.
