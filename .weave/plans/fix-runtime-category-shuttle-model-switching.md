# Fix Runtime Category Wiring for Shuttle Model Switching

## TL;DR
> **Summary**: Wire `pluginConfig.categories` through the real bootstrap path so production builds actually register `shuttle-{category}` agents and compose Tapestry's category-routing prompt. Harden runtime enabled-agent discovery at the same time so generated category agents are treated as valid runtime agents instead of unit-test-only behavior.
> **Estimated Effort**: Medium

## Context
### Original Request
Create an implementation plan to properly fix the categories system so Shuttle can switch model configuration at runtime. Prior exploration found that category config/schema, category-aware Tapestry prompt composition, category model resolution, and `createBuiltinAgents()` support already exist, but `src/create-managers.ts` does not pass `pluginConfig.categories` into the production bootstrap path.

### Key Findings
- `src/config/schema.ts` already parses `categories`, including `patterns`, `model`, `temperature`, `tools`, and `prompt_append`.
- `src/agents/builtin-agents.ts` already knows how to:
  - build category-specific `shuttle-{category}` agents when `patterns` exist
  - pass `categories` into `createTapestryAgentWithOptions()` so the Tapestry prompt can emit `<CategoryRouting>`
- `src/agents/tapestry/index.ts` and `src/agents/tapestry/prompt-composer.ts` already support category-aware prompt composition, and their unit tests already cover it.
- `src/create-managers.ts` is the missing production seam: it calls `createBuiltinAgents()` without `categories`, so the feature works in isolated unit tests but is inert in real plugin startup.
- `test/integration/manager-config.integration.test.ts` and `test/integration/plugin-bootstrap.integration.test.ts` currently verify other bootstrap behavior, but neither file asserts that category agents survive the real `.opencode` config → managers → plugin config flow.
- `src/runtime/opencode/plugin-adapter.ts` currently computes `enabledAgents` from a fixed builtin list plus custom agents only. If category shuttle agents become real runtime agents, compaction/recovery paths will still treat them as unavailable unless enabled-agent derivation is updated to include generated `shuttle-{category}` names.

### Architecture Notes
- `loadWeaveConfig()` / `WeaveConfigSchema` are already the source of truth for category config; no schema redesign is needed.
- `createManagers()` is the correct bootstrap boundary for this fix because it is the one place where parsed config becomes the agent map later exposed by `ConfigHandler` and `createPluginInterface()`.
- `createBuiltinAgents()` should remain the only place that knows how category shuttle configs are materialized; `create-managers.ts` should forward config, not duplicate category construction rules.
- Runtime availability checks should derive the same category shuttle names from config in one reusable helper rather than sprinkling `shuttle-${name}` logic across multiple modules.

### Rollout / Risk Notes
- This is an opt-in feature path: repos with no `categories`, or categories without `patterns`, must remain behaviorally unchanged.
- The main regression risk is bootstrap/runtime drift: creating category agents in one layer while another layer still assumes only the fixed builtin list exists.
- Disabling logic must stay coherent: `disabled_agents: ["shuttle-frontend"]` should prevent the generated category agent from being exposed even when `categories.frontend.patterns` exists.
- Base `shuttle` must remain registered as the fallback agent; category routing must not replace or rename it.

### Follow-up Cleanups
- After the production fix lands, consider updating example config/docs if they currently imply categories work end-to-end without a validated smoke test.
- If more subsystems need to reason about generated category agents later, keep the enumeration helper shared instead of re-encoding the naming rules again.

## Objectives
### Core Objective
Make category-configured Shuttle variants actually usable in production by threading `pluginConfig.categories` through manager/plugin bootstrap and ensuring runtime infrastructure recognizes the generated category agents as first-class enabled agents.

### Deliverables
- [x] `createManagers()` forwards `pluginConfig.categories` into builtin agent creation.
  - [x] Production agent config contains `shuttle-{category}` entries when category patterns are configured.
  - [x] Tapestry's production prompt contains `<CategoryRouting>` and category-specific shuttle names when category patterns are configured.
  - [x] Runtime enabled-agent discovery includes generated category shuttle agents and respects `disabled_agents`.
  - [x] Integration coverage proves the real bootstrap path works from config parsing through `WeavePlugin(...).config(...)`.

### Definition of Done
- [x] `bun test src/agents/builtin-agents.test.ts src/agents/tapestry/index.test.ts test/integration/manager-config.integration.test.ts test/integration/plugin-bootstrap.integration.test.ts` passes.
  - [x] `bun test` passes.
  - [x] `bun run build` succeeds.
  - [x] A category-enabled fixture config exposes `shuttle-frontend` (or equivalent) in `config.agent` and the Tapestry prompt includes `<CategoryRouting>` plus the category shuttle name.
  - [x] Disabling either `shuttle` or a specific `shuttle-{category}` agent still suppresses the generated runtime agent as expected.

### Guardrails (Must NOT)
- Must NOT change category schema semantics or break backward compatibility for categories without `patterns`.
- Must NOT duplicate category-agent construction logic in `src/create-managers.ts`.
- Must NOT remove or rename the base `shuttle` agent.
- Must NOT ship this fix with only unit coverage; the regression must be locked at the integration/bootstrap layer.

## TODOs

- [x] 1. Add a manager-layer regression test for category wiring
  **What**: Extend the existing manager integration coverage to exercise the exact broken seam. Parse a config with `categories.frontend.patterns`, `model`, and `prompt_append`, call `createManagers()`, and assert both (a) `agents["shuttle-frontend"]` exists with the category model/prompt and (b) `agents["tapestry"].prompt` contains `<CategoryRouting>`, `shuttle-frontend`, and the configured glob(s). This proves the issue at the production composition boundary instead of re-testing `createBuiltinAgents()` in isolation.
  **Files**: `test/integration/manager-config.integration.test.ts`
  **Acceptance**: The new test fails on the current code because `createManagers()` never forwards `categories`, then passes once the bootstrap wiring is fixed.

- [x] 2. Wire `pluginConfig.categories` through `createManagers()`
  **What**: Update the single `createBuiltinAgents()` call in `src/create-managers.ts` to pass `categories: pluginConfig.categories` alongside the existing disabled agents, overrides, continuation, fingerprint, and custom metadata. Keep `createManagers()` as a thin composition layer; do not add any new category-specific branching beyond forwarding the config.
  **Files**: `src/create-managers.ts`
  **Acceptance**: Manager-built agent maps now include generated category shuttle agents and a category-aware Tapestry prompt when categories with patterns are configured, while configs without categories behave exactly as before.

- [x] 3. Make runtime enabled-agent discovery category-aware
  **What**: Replace the fixed builtin/custom-only enabled-agent enumeration with a shared helper that derives the enabled agent set from `WeaveConfig`: builtins, custom agents, and generated `shuttle-{category}` names for categories that have `patterns`, as long as base `shuttle` is enabled and the specific category agent is not disabled. Reuse that helper from `src/runtime/opencode/plugin-adapter.ts` so compaction/recovery and runtime agent validation treat category shuttles as legitimate runtime agents.
  **Files**: `src/runtime/opencode/plugin-adapter.ts`, `src/runtime/opencode/enabled-agent-keys.ts`, `src/runtime/opencode/enabled-agent-keys.test.ts`
  **Acceptance**: Focused tests prove the helper includes category shuttle agents only when they would actually be created, and excludes them when `patterns` are absent, `shuttle` is disabled, or the explicit `shuttle-{category}` key is disabled.

- [x] 4. Add full plugin-bootstrap integration coverage
  **What**: Extend plugin bootstrap integration coverage to use a real fixture config with categories, run `WeavePlugin(makeMockCtx(...))`, call the plugin `config` hook, and assert the public plugin surface contains the generated category shuttle agent plus a Tapestry prompt with category routing instructions. Keep the assertions on public output (`config.agent`) so the test guards the real end-to-end boot path, not just internal helpers.
  **Files**: `test/integration/plugin-bootstrap.integration.test.ts`
  **Acceptance**: The new integration test fails on current main, then passes once the manager/bootstrap path is fixed and the generated category agent is visible to OpenCode config consumers.

- [x] 5. Run focused verification and regression checks
  **What**: Run the targeted agent/bootstrap test slice first, then the full test suite and build. In addition to automated checks, manually inspect the bootstrap fixture output to confirm that `config.agent` still includes the base `shuttle`, the generated `shuttle-{category}` agent, and the unchanged default primary agent selection. Capture any mismatch between generated agents and runtime enabled-agent logic before shipping.
  **Acceptance**: Targeted tests, `bun test`, and `bun run build` all pass; category-enabled bootstrap works without regressions for non-category configs.

## Verification
- [x] All tests pass
- [x] No regressions for repositories with no `categories` or categories without `patterns`
- [x] `bun run build` succeeds
- [x] Category-enabled bootstrap exposes both `shuttle` and `shuttle-{category}` in `config.agent`
- [x] Tapestry prompt includes `<CategoryRouting>` only when categories with patterns are configured
- [x] Runtime enabled-agent derivation stays consistent with the generated agent map
