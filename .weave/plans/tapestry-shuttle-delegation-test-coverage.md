# Improve Test Coverage for Tapestry → Shuttle Delegation

## TL;DR
> **Summary**: Make Tapestry→Shuttle delegation coverage executable and deterministic by fixing category-aware eval target plumbing, locking the routing contract, extending trajectory assertions to validate delegation targets, and adding runtime/e2e proof for both `shuttle` and `shuttle-{category}` delegation.
> **Estimated Effort**: Large

## Context
### Original Request
Convert the existing Tapestry→Shuttle delegation coverage plan into an executable `/start-work` plan with explicit unchecked checklist items, grouped by phase/workstream, including verification tasks and prerequisite contract decisions so Tapestry can execute it instead of treating it as already complete.

### Key Findings
- `src/features/evals/types.ts` currently allows `variant.disabledAgents` for builtin prompt targets, but not category injection for Tapestry evals.
- `src/features/evals/schema.ts` mirrors that limitation, so current categorized Tapestry eval cases are using an unsupported target shape.
- `src/features/evals/targets/builtin-agent-target.ts` composes the Tapestry prompt with `disabledAgents` only; it does not yet pass categories into `composeTapestryPrompt`.
- Existing routing eval cases in `evals/cases/tapestry/delegation-routing/` currently embed category data in the prompt input or unsupported target fields instead of using a supported builtin target variant.
- `src/agents/tapestry/prompt-composer.ts` already has a `<CategoryRouting>` section, but the contract is still ambiguous for categories without patterns and needs to be made explicit.
- `src/features/evals/executors/trajectory-run.ts` detects delegation from text patterns only, and its regexes use `\w+`, which does not safely cover hyphenated agent names like `shuttle-frontend`.
- `src/features/evals/evaluators/trajectory-assertion.ts` currently validates acting-agent sequence, not explicit delegation-target sequence.
- Runtime seams already exist in `src/plugin/plugin-interface.test.ts`, `test/testkit/host/fake-opencode-host.ts`, and `test/testkit/host/fake-plugin-client.ts`, so deterministic delegation-proof tests can be added without changing production orchestration.
- Existing eval suite wiring includes `evals/suites/tapestry-delegation-routing.jsonc`, but there is no dedicated `tapestry-delegation-trajectory` suite yet.

## Objectives
### Core Objective
Create deterministic, repo-native proof that Tapestry delegates work to `shuttle` and `shuttle-{category}`, with explicit routing semantics for no-pattern categories and overlapping matches, and with coverage spanning prompt composition, eval harnesses, trajectory assertions, runtime hooks, and end-to-end execution seams.

### Deliverables
- [x] Category-aware builtin Tapestry eval targets that support `variant.categories`
- [x] Explicit Tapestry routing contract for no-pattern categories and overlapping-pattern precedence
- [x] Deterministic trajectory coverage that validates delegation targets, including hyphenated `shuttle-{category}` names
- [x] Runtime/plugin/e2e proof for generic and categorized shuttle delegation
- [x] Repaired and expanded Tapestry routing/trajectory eval suites with supported target shapes

### Definition of Done
- [x] `bun test src/agents/tapestry/prompt-composer.test.ts src/agents/tapestry/mode2-prompt-composition.test.ts src/agents/tapestry/index.test.ts`
- [x] `bun test src/features/evals/schema.test.ts src/features/evals/targets/builtin-agent-target.test.ts src/features/evals/executors/trajectory-run.test.ts src/features/evals/evaluators/trajectory-assertion.test.ts src/features/evals/runner.test.ts`
- [x] `bun test src/plugin/plugin-interface.test.ts test/e2e/tapestry-shuttle-delegation.e2e.test.ts`
- [x] `bun run eval --suite tapestry-delegation-routing`
- [x] `bun run eval --suite tapestry-delegation-trajectory`
- [x] `bun test`

### Guardrails (Must NOT)
- Must not rework production Tapestry orchestration beyond the seams needed for deterministic tests/evals.
- Must not rely only on prompt prose where the goal is proving actual delegation target selection.
- Must not leave the no-pattern category behavior implicit or inconsistent across prompt, tests, and evals.
- Must not add live-provider-only assertions for behavior that can be covered deterministically in unit/integration/e2e tests.
- Must not keep using unsupported eval target fields such as ad hoc `target.options` for builtin prompt targets.

## TODOs

### Phase 1 — Contract decisions and prompt semantics

- [x] 1. Lock the no-pattern category contract
  **What**: Encode the repo contract for categories with no file patterns: no-pattern categories are explicit/manual-use only and are not eligible for file-pattern auto-routing. Update the `<CategoryRouting>` prompt wording to state this directly, and add unit tests asserting that categories without patterns are never auto-selected from file matches.
  **Files**: `src/agents/tapestry/prompt-composer.ts`, `src/agents/tapestry/prompt-composer.test.ts`, `src/agents/tapestry/mode2-prompt-composition.test.ts`, `src/agents/tapestry/index.test.ts`
  **Acceptance**: `<CategoryRouting>` explicitly states that categories without patterns are explicit/manual-use only, and unit tests assert that those categories are not auto-selected from file matches.

- [x] 2. Lock overlapping-pattern precedence to config order
  **What**: Make overlapping-pattern behavior explicit: when multiple categories match a task's `**Files**`, Tapestry uses the first matching category in declaration order. Add prompt text and tests so this precedence is unambiguous.
  **Files**: `src/agents/tapestry/prompt-composer.ts`, `src/agents/tapestry/prompt-composer.test.ts`, `src/agents/tapestry/mode2-prompt-composition.test.ts`
  **Acceptance**: Prompt text states first-match-in-config-order precedence, and tests fail if later matching categories win over earlier ones.

### Phase 2 — Eval schema and type prerequisites for category-aware targets

- [x] 3. Add `variant.categories` to eval assertion types
  **What**: Extend the eval types to include `variant.categories` on builtin prompt targets and add a `delegationTargets` field to trajectory trace types, so downstream tasks (target resolution, trajectory cases, assertion evaluators) have the type foundation they need.
  **Files**: `src/features/evals/types.ts`
  **Acceptance**: TypeScript compiles with the new fields. Builtin Tapestry target variants accept `categories`, and trajectory trace types include `delegationTargets`.

- [x] 4. Add `variant.categories` and `delegationTargets` to eval schema validation
  **What**: Update the eval schema to validate `variant.categories` on builtin Tapestry targets and `delegationTargets` on trajectory traces. Add schema tests proving valid payloads pass and malformed ones are rejected.
  **Files**: `src/features/evals/schema.ts`, `src/features/evals/schema.test.ts`
  **Acceptance**: `EvalCaseSchema` accepts builtin Tapestry targets with `target.variant.categories`, preserves `disabledAgents`, rejects malformed category payloads, and validates `delegationTargets` on trajectory traces.

### Phase 3 — Eval harness plumbing for category-aware Tapestry prompts

- [x] 5. Render category-aware Tapestry prompts from builtin target resolution
  **What**: Update builtin target resolution so Tapestry prompt targets pass `variant.categories` into `composeTapestryPrompt`, then add tests proving the rendered prompt includes category routing details and concrete `shuttle-{category}` names.
  **Files**: `src/features/evals/targets/builtin-agent-target.ts`, `src/features/evals/targets/builtin-agent-target.test.ts`
  **Acceptance**: Resolving a Tapestry builtin prompt target with categories produces a prompt containing `<CategoryRouting>`, concrete category shuttle names, fallback-to-generic behavior, and the chosen no-pattern/first-match contract.

### Phase 4 — Deterministic trajectory delegation-target coverage

- [x] 6. Upgrade trajectory execution to preserve delegation targets
  **What**: Extend trajectory execution so traces capture delegation targets explicitly, not just acting-agent sequence. Fix the regex to handle hyphenated agent names like `shuttle-frontend`. This task depends on the type/schema fields added in Tasks 3–4.
  **Files**: `src/features/evals/executors/trajectory-run.ts`, `src/features/evals/executors/trajectory-run.test.ts`
  **Acceptance**: Trajectory tests cover `shuttle` and `shuttle-frontend`, detection logic handles hyphenated names correctly, and trace artifacts expose delegation-target data separately from acting-agent sequence.

- [x] 7. Extend trajectory assertions to validate delegation targets
  **What**: Update trajectory assertions so eval cases can assert delegation-target sequences and constraints such as generic shuttle fallback, categorized shuttle routing, overlapping-pattern first match, and no-pattern explicit/manual-only behavior.
  **Files**: `src/features/evals/evaluators/trajectory-assertion.ts`, `src/features/evals/evaluators/trajectory-assertion.test.ts`
  **Acceptance**: The evaluator can fail on wrong delegation targets even when the acting-agent sequence is unchanged, and unit tests cover positive/negative cases for `shuttle` and `shuttle-frontend`.

### Phase 5 — Trajectory eval cases and suite wiring

- [x] 8. Add trajectory scenario: Tapestry delegates to generic shuttle
  **What**: Create the scenario and case file for generic shuttle fallback delegation (no categories configured).
  **Files**: `evals/scenarios/tapestry-delegates-to-generic-shuttle.jsonc`, `evals/cases/trajectory/tapestry-delegates-to-generic-shuttle.jsonc`
  **Acceptance**: Case uses supported builtin target schema with `variant.categories` (empty/absent), and asserts delegation target is `shuttle`.

- [x] 9. Add trajectory scenario: Tapestry delegates to categorized shuttle
  **What**: Create the scenario and case file for categorized shuttle delegation (e.g. `shuttle-frontend`).
  **Files**: `evals/scenarios/tapestry-delegates-to-categorized-shuttle.jsonc`, `evals/cases/trajectory/tapestry-delegates-to-categorized-shuttle.jsonc`
  **Acceptance**: Case uses supported builtin target schema with `variant.categories` containing a category with patterns, and asserts delegation target is `shuttle-{category}`.

- [x] 10. Add trajectory scenario: overlapping patterns use first-match precedence
  **What**: Create the scenario and case file proving overlapping-pattern first-match-in-config-order behavior.
  **Files**: `evals/scenarios/tapestry-overlapping-patterns-first-match.jsonc`, `evals/cases/trajectory/tapestry-overlapping-patterns-first-match.jsonc`
  **Acceptance**: Case configures two categories whose patterns overlap, and asserts the first-in-config-order category wins.

- [x] 11. Add trajectory scenario: no-pattern category is explicit/manual only
  **What**: Create the scenario and case file proving no-pattern categories are not auto-routed.
  **Files**: `evals/scenarios/tapestry-no-pattern-category-explicit-only.jsonc`, `evals/cases/trajectory/tapestry-no-pattern-category-explicit-only.jsonc`
  **Acceptance**: Case configures a category without patterns and asserts it is not selected by file-pattern auto-routing.

- [x] 12. Wire trajectory suite and add runner coverage
  **What**: Create the `tapestry-delegation-trajectory` suite referencing all four trajectory cases, and add runner test coverage asserting the suite loads and executes successfully.
  **Files**: `evals/suites/tapestry-delegation-trajectory.jsonc`, `src/features/evals/runner.test.ts`
  **Acceptance**: `bun run eval --suite tapestry-delegation-trajectory` loads all four cases and runner test asserts end-to-end execution.

### Phase 6 — Runtime and end-to-end delegation proof

- [x] 13. Expose delegated shuttle names through fake host/testkit seams
  **What**: Extend the fake host/plugin client test seams so tests can inspect executed tool calls and their delegation payloads, especially `subagent_type` for generic and categorized shuttle delegations.
  **Files**: `test/testkit/host/fake-plugin-client.ts`, `test/testkit/host/fake-opencode-host.ts`
  **Acceptance**: Test helpers can capture executed tool metadata and assertions can read the exact delegated agent name from recorded tool arguments.

- [x] 14. Add plugin-interface runtime tests for generic and categorized shuttle delegation
  **What**: Add deterministic plugin-level tests that verify delegation is only counted when an actual tool execution occurs, and that the recorded tool args preserve `subagent_type: "shuttle"` and `subagent_type: "shuttle-frontend"` as appropriate.
  **Files**: `src/plugin/plugin-interface.test.ts`
  **Acceptance**: Tests pass for real tool executions with generic and categorized shuttle names, and a negative-control case proves prose-only mentions do not count as delegation evidence.

- [x] 15. Add end-to-end regression coverage for categorized shuttle delegation
  **What**: Add an e2e test that exercises a `/start-work`-style Tapestry flow through the fake host/plugin seam and proves categorized Shuttle delegation survives end-to-end with the correct `subagent_type`.
  **Files**: `test/e2e/tapestry-shuttle-delegation.e2e.test.ts`
  **Acceptance**: The e2e test fails if categorized shuttle names are lost or normalized back to plain `shuttle`, and passes when the full path preserves the intended delegation target.

### Phase 7 — Repair and expand routing eval suites

- [x] 16. Migrate existing Tapestry routing cases to supported builtin target variants
  **What**: Rewrite existing Tapestry routing eval cases to use supported builtin target plumbing (`target.variant.categories`) instead of unsupported target fields or prompt-only category injection.
  **Files**: `evals/cases/tapestry/delegation-routing/correct-category-routing.jsonc`, `evals/cases/tapestry/delegation-routing/explicit-tag-override.jsonc`, `evals/cases/tapestry/delegation-routing/fallback-to-generic.jsonc`, `evals/cases/tapestry/delegation-routing/mixed-category-parallel-batch.jsonc`, `evals/cases/tapestry/delegation-routing/no-categories-graceful-degradation.jsonc`
  **Acceptance**: No existing Tapestry routing case depends on unsupported builtin target fields, and categorized cases render the real category-aware Tapestry prompt through the supported target schema.

- [x] 17. Add missing routing eval cases for overlapping patterns and no-pattern categories
  **What**: Add routing eval cases that explicitly exercise first-match precedence for overlapping patterns and explicit/manual-only behavior for categories without patterns, then wire them into the routing suite.
  **Files**: `evals/cases/tapestry/delegation-routing/overlapping-patterns-first-match.jsonc`, `evals/cases/tapestry/delegation-routing/no-pattern-category-explicit-only.jsonc`, `evals/suites/tapestry-delegation-routing.jsonc`
  **Acceptance**: The routing suite contains both new cases, and their evaluators align with the prompt contract chosen in Phase 1.

- [x] 18. Align remaining Tapestry tests with the finalized routing contract
  **What**: Update any remaining Tapestry-specific tests that still encode ambiguous or outdated assumptions about category routing, so prompt tests, routing evals, and trajectory assertions all agree.
  **Files**: `src/agents/tapestry/prompt-composer.test.ts`, `src/agents/tapestry/mode2-prompt-composition.test.ts`, `src/agents/tapestry/index.test.ts`
  **Acceptance**: There are no conflicting expectations left in Tapestry tests about no-pattern categories, first-match precedence, or concrete `shuttle-{category}` naming.

### Phase 8 — Explicit verification

- [x] 19. Run targeted prompt and eval unit tests
  **What**: Run the focused unit-test slice covering prompt composition, eval schema, builtin target resolution, trajectory execution, trajectory assertions, and runner wiring.
  **Acceptance**: `bun test src/agents/tapestry/prompt-composer.test.ts src/agents/tapestry/mode2-prompt-composition.test.ts src/agents/tapestry/index.test.ts src/features/evals/schema.test.ts src/features/evals/targets/builtin-agent-target.test.ts src/features/evals/executors/trajectory-run.test.ts src/features/evals/evaluators/trajectory-assertion.test.ts src/features/evals/runner.test.ts` passes.

- [x] 20. Run runtime and e2e delegation proof tests
  **What**: Run the deterministic runtime/e2e delegation proof tests after the host/plugin seam changes land.
  **Acceptance**: `bun test src/plugin/plugin-interface.test.ts test/e2e/tapestry-shuttle-delegation.e2e.test.ts` passes.

- [x] 21. Run Tapestry routing and trajectory eval suites
  **What**: Run both Tapestry delegation eval suites to verify supported target wiring and new delegation-target assertions work together.
  **Acceptance**: `bun run eval --suite tapestry-delegation-routing` and `bun run eval --suite tapestry-delegation-trajectory` both pass.

- [x] 22. Run the broad regression pass
  **What**: Run the full test suite after targeted verification succeeds.
  **Acceptance**: `bun test` passes with no regressions outside the Tapestry/Shuttle delegation surface.

## Verification
- [x] All tests pass
- [x] No regressions
- [x] `bun test src/agents/tapestry/prompt-composer.test.ts src/agents/tapestry/mode2-prompt-composition.test.ts src/agents/tapestry/index.test.ts`
- [x] `bun test src/features/evals/schema.test.ts src/features/evals/targets/builtin-agent-target.test.ts src/features/evals/executors/trajectory-run.test.ts src/features/evals/evaluators/trajectory-assertion.test.ts src/features/evals/runner.test.ts`
- [x] `bun test src/plugin/plugin-interface.test.ts test/e2e/tapestry-shuttle-delegation.e2e.test.ts`
- [x] `bun run eval --suite tapestry-delegation-routing`
- [x] `bun run eval --suite tapestry-delegation-trajectory`
- [x] `bun test`
