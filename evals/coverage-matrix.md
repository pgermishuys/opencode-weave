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
| Post-plan routing: Weft after non-security plan | N/A (behavioral) | `loom/routing/route-to-weft-after-pattern` (LLM) | ✅ Covered |
| Post-plan routing: Warp after security plan | N/A (behavioral) | `loom/routing/route-to-warp-after-pattern` (LLM) | ✅ Covered |
| Post-plan trajectory: Loom→Pattern→Weft→Loom | N/A (trajectory) | `trajectory/loom-planning-with-weft-review` | ✅ Covered |

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
- Prefer XML and reviewer/delegation contract anchors over broad prose matching.
- Remaining gaps: Loom review-workflow-disabled variant (both weft+warp disabled), Loom plan-workflow Pattern-disabled variant.
