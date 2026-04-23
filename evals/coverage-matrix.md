# Deterministic Eval Coverage Matrix (Loom/Tapestry)

This matrix documents current deterministic eval coverage versus composer branch behavior covered in unit tests.

## Loom

| Composer branch/behavior | Unit test coverage | Eval case coverage | Action |
| --- | --- | --- | --- |
| Default XML sections present (`Role`, `Delegation`, `PlanWorkflow`, `ReviewWorkflow`) | `composeLoomPrompt` section tests | `loom/default-contract` | Keep |
| Mandatory Warp language enabled by default | `preserves mandatory Warp language` | `loom/default-contract` | Keep |
| Delegation lines removed when `thread`/`warp` disabled | `buildDelegationSection` disabled-agent tests | `loom/disabled-agents` (thread+warp) | Keep and tighten |
| Review workflow omitted when both reviewers disabled | `buildReviewWorkflowSection` returns empty | Not explicitly covered | Add dedicated review-workflow case |
| Plan workflow omits Pattern when disabled | `buildPlanWorkflowSection` pattern disabled | Not explicitly covered | Add scoped variant assertion |
| Post-plan review text with both Weft and Warp | `includes Tapestry invokes Weft and Warp` | `loom/plan-review-scoped-contract` | ✅ Covered |
| Routing intent: Thread for exploration asks | N/A (behavioral) | `loom/routing-intent/route-to-thread-exploration-intent` (LLM) | ✅ Covered |
| Routing intent: Weft for review asks | N/A (behavioral) | `loom/routing-intent/route-to-weft-review-intent` (LLM) | ✅ Covered |
| Routing intent: Warp for security asks and mandatory/boundary overrides | N/A (behavioral) | `loom/routing-intent/route-to-warp-security-intent`, `loom/routing-intent/route-to-warp-mandatory-override-intent`, `loom/routing-intent/route-to-warp-boundary-intent` (LLM) | ✅ Covered |
| Post-plan routing: Weft after non-security plan | N/A (behavioral) | `loom/routing/route-to-weft-after-pattern` (LLM) | ✅ Covered |
| Post-plan routing: Warp after security plan | N/A (behavioral) | `loom/routing/route-to-warp-after-pattern` (LLM) | ✅ Covered |
| Exploration trajectory: Loom→Thread→Loom | N/A (trajectory) | `trajectory/loom-delegates-to-thread` | ✅ Covered |
| Security-review trajectory: Loom→Warp→Loom | N/A (trajectory) | `trajectory/loom-security-review-chain` | ✅ Covered |
| Post-plan trajectory: Loom→Pattern→Weft→Loom | N/A (trajectory) | `trajectory/loom-planning-with-weft-review` | ✅ Covered |
| Planning+security trajectory: Loom→Pattern→Warp→Loom | N/A (trajectory) | `trajectory/loom-planning-with-review` | ✅ Covered |

## Tapestry

| Composer branch/behavior | Unit test coverage | Eval case coverage | Action |
| --- | --- | --- | --- |
| Default XML sections present (`Role`, `PlanExecution`, `Verification`, `PostExecutionReview`) | `composeTapestryPrompt` section tests | `tapestry/default-contract` | Keep |
| PostExecutionReview includes Weft + Warp by default | `includes both Weft and Warp by default` | `tapestry/default-contract` (indirect via contains-all) | Keep and scope to section |
| PostExecutionReview with `warp` disabled (Weft-only) | `includes only Weft when warp disabled` | `tapestry/weft-only-review-contract` | ✅ Covered |
| PostExecutionReview with `weft` disabled (Warp-only) | `includes only Warp when weft disabled` | `tapestry/warp-only-review-contract` | ✅ Covered |
| PostExecutionReview with both disabled removes Task tool delegation | `omits review delegation when both disabled` | `tapestry/disabled-reviewers-contract` | ✅ Covered |
| User approval / do-not-fix language present when reviewers enabled | dedicated tests | `tapestry/default-contract` | Keep |
| Post-execution routing: delegates to Weft+Warp | N/A (behavioral) | `tapestry/routing/route-to-reviewers-post-execution` (LLM) | ✅ Covered |
| Post-execution trajectory: Tapestry→Weft→Warp→Tapestry | N/A (trajectory) | `trajectory/tapestry-post-execution-review` | ✅ Covered |

## Hardening Summary

- Tighten global contains checks to section-scoped checks where possible.
- ~~Add one Loom review-workflow variant and one Tapestry disabled-reviewers variant.~~ Done.
- ~~Add post-plan and post-execution review evals.~~ Done — prompt contracts, trajectories, and LLM routing cases added.
- Trajectory seam decision for this scope: keep deterministic trajectory coverage intentionally mock-backed/text-based. Existing Thread/Weft/Warp cases are sufficient for eval intent/order coverage; stronger runtime delegation proof remains owned by integration tests.
- Runtime-proof gap: evals/assertions can prove delegation language and trajectories, but the only runtime-instrumented delegation signal today is the `task` tool hooks (`tool.execute.before/after`). `call_weave_agent` appears in prompt/config contracts but is not emitted as a runtime analytics/logging event in this repo.
- Evidence contract locked: count **actual delegation** from runtime evidence as **`task` only**, not `call_weave_agent` and not both.
- Runtime ownership: use integration tests for proof of actual delegation/tool activity; use trajectory evals for deterministic orchestration/order regression coverage.
- Targeted local verification when touching Loom delegation behavior:
  - `bun test src/plugin/plugin-interface.test.ts src/features/analytics/session-tracker.test.ts test/integration/loom-delegation-runtime.integration.test.ts`
  - `bun test src/features/evals/schema.test.ts src/features/evals/executors/trajectory-run.test.ts src/features/evals/evaluators/trajectory-assertion.test.ts src/features/evals/runner.test.ts`
  - `bun run eval --suite agent-routing-intent`
  - `bun run eval --suite agent-trajectory`
- Targeted CI verification when touching Loom delegation behavior (`.github/workflows/evals.yml` behavioral matrix):
  - `bun run eval --suite agent-routing-intent --provider openrouter --model <matrix-model>`
  - `bun run eval --suite agent-trajectory --provider openrouter --model <matrix-model>`
- Prefer XML and reviewer/delegation contract anchors over broad prose matching.
- Remaining gaps: Loom review-workflow-disabled variant (both weft+warp disabled), Loom plan-workflow Pattern-disabled variant.
