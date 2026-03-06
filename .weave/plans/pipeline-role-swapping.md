# Pipeline Role-Swapping

## TL;DR
> **Summary**: Allow users to configure which agent fills each role (planner, executor, reviewer, security reviewer) in the fixed plan-review-execute pipeline via a `pipeline` config key, while maintaining full backward compatibility.
> **Estimated Effort**: Large

## Context

### Original Request
Add a `pipeline` config key so users can swap which agent fills each role in the plan-review-execute pipeline. The pipeline shape stays fixed — users just choose who fills the planner, executor, reviewer, and security reviewer slots.

### Key Findings

**Current hardcoded agent names across the codebase:**

1. **`src/agents/loom/index.ts`** — 14 `switchAgent: "tapestry"` return sites (lines 63, 72, 77, 116, 124, 133, 146, 151, 166, 176, 190, 201, 206, 220). Also 2 `createWorkState(..., "tapestry", ...)` calls (lines 140, 195). The `StartWorkResult` interface comment says "always tapestry" (line 29).

2. **`src/features/builtin-commands/commands.ts`** — `/start-work` command hardwires `agent: "tapestry"` (line 9).

3. **`src/agents/loom/prompt-composer.ts`** — `buildPlanWorkflowSection()` hardcodes "Pattern" (line 159), "Weft" (line 167), "Warp" (line 176), "Tapestry" (line 188). `buildDelegationSection()` checks for "pattern", "tapestry", "weft", "warp" by name (lines 73-100). `buildReviewWorkflowSection()` hardcodes "Weft", "Warp", "Tapestry" (lines 226-261).

4. **`src/agents/tapestry/prompt-composer.ts`** — `buildTapestryPostExecutionReviewSection()` hardcodes "Weft" and "Warp" (lines 131-136, 140). `buildTapestryPlanExecutionSection()` checks `isAgentEnabled("weft")` (line 70).

5. **`src/hooks/verification-reminder.ts`** — hardcodes `weft` and `warp` agent names (lines 39-43).

6. **`src/managers/config-handler.ts`** — `applyCommandConfig()` remaps command agent display names (line 135). This is where `/start-work`'s agent gets translated.

**Config architecture:**
- `WeaveConfigSchema` in `src/config/schema.ts` defines the Zod schema (line 102-115)
- `mergeConfigs()` in `src/config/merge.ts` handles user+project merge — objects use `deepMergeObjects`, scalars use project-wins
- `createManagers()` in `src/create-managers.ts` builds agents and passes `pluginConfig` through
- `createBuiltinAgents()` in `src/agents/builtin-agents.ts` accepts `disabledAgents` and passes disabled sets to prompt composers

**WorkState type** in `src/features/work-state/types.ts` already has an `agent?: string` field (line 16), which is perfect for storing the pipeline executor.

**Test patterns:**
- Schema tests use `safeParse` with valid/invalid inputs (`src/config/schema.test.ts`)
- Prompt composer tests check for presence/absence of agent names in generated prompts
- Start-work hook tests use temp dirs, `createPlanFile()` and `makePrompt()` helpers
- Workflow tests are end-to-end, exercising the full pipeline

### Risk Audit Findings

The following risks were identified in a breakage risk audit and are mitigated inline throughout the plan. Look for `> ⚠️` callouts.

| ID | Severity | Summary |
|----|----------|---------|
| H1+H2 | HIGH | Fast-path bypasses in `loom/index.ts` and `tapestry/index.ts` skip prompt composition entirely |
| H3 | HIGH | Dead code in Task 2's `reviewers` merge fallback |
| H4 | HIGH | TypeScript build-order dependency — Phases 5-8 depend on Task 1 |
| H5 | HIGH | Delegation narration hint text template unspecified |
| H6 | HIGH | Pipeline spread unconditionally overwrites caller input |
| M1 | MEDIUM | Existing tests assert exact hardcoded strings that will break |
| M2 | MEDIUM | `capitalize()` broken for hyphenated agent names |
| M3 | MEDIUM | `reviewers = []` edge case unspecified |
| M4 | MEDIUM | Pre-existing bug in `src/integration.test.ts` line 105-108 |
| M5 | MEDIUM | `as const` + `Required<PipelineConfig>` type conflict |
| L1 | LOW | Multi-role assignment (same agent in planner + executor) is valid |

## Objectives

### Core Objective
Enable users to configure `pipeline.planner`, `pipeline.executor`, `pipeline.reviewers[]`, and `pipeline.security_reviewer` to swap which agent fills each role, with defaults matching current behavior.

### Deliverables
- [ ] Zod schema for `pipeline` config key with proper defaults
- [ ] Config merge support for the `pipeline` key
- [ ] Pipeline config accessor utility (single source of truth for role → agent resolution)
- [ ] Updated Loom prompt composer to use pipeline config instead of hardcoded names
- [ ] Updated Tapestry prompt composer to use pipeline config instead of hardcoded names
- [ ] Updated start-work hook to read executor from pipeline config
- [ ] Updated `/start-work` command to read executor from pipeline config
- [ ] Updated verification-reminder hook to use pipeline config
- [ ] Fast-path guards in `loom/index.ts` and `tapestry/index.ts` extended for pipeline awareness
- [ ] Validation: assigned agents must exist and not be disabled
- [ ] Full test coverage for all changes (including updates to existing tests that assert hardcoded names)
- [ ] Updated documentation

### Definition of Done
- [ ] `bun test` passes with zero failures
- [ ] `bun run tsc --noEmit` passes with zero errors
- [ ] Zero-config produces identical behavior to current (backward compatible)
- [ ] Custom agent can be assigned to any pipeline role via config
- [ ] Disabled agent assigned to a pipeline role produces a validation warning at startup
- [ ] All hardcoded agent names in pipeline-related code replaced with config lookups
- [ ] Fast-path guards in agent constructors correctly detect non-default pipeline

### Guardrails (Must NOT)
- Must NOT change the pipeline shape (plan → review → execute remains fixed)
- Must NOT break existing configs that don't use the `pipeline` key
- Must NOT make `pipeline` config required — it must be entirely optional
- Must NOT modify agent behavior or capabilities — only which agent fills each role
- Must NOT create circular dependencies between config loading and agent registration

## TODOs

### Phase 1: Schema & Config Infrastructure

- [ ] 1. Add `PipelineConfigSchema` to `src/config/schema.ts`
  **What**: Define a new Zod schema for the `pipeline` config key and add it to `WeaveConfigSchema`. The schema should be:
  ```typescript
  export const PipelineConfigSchema = z.object({
    planner: z.string().optional(),
    executor: z.string().optional(),
    reviewers: z.array(z.string()).optional(),
    security_reviewer: z.string().optional(),
  })
  ```
  Add `pipeline: PipelineConfigSchema.optional()` to `WeaveConfigSchema` (after line 114, before the closing `)`). Export the `PipelineConfig` type alongside the other type exports (after line 127).

  > ⚠️ **[H4] Build-order dependency**: This task is a hard prerequisite for Phases 5-8. Tasks 17-24 reference `pluginConfig.pipeline` which does not exist on `WeaveConfig` until this task is complete. **Do not start any Phase 5-8 task until Task 1 is complete and `bun run tsc --noEmit` passes.**

  **Files**: `src/config/schema.ts`
  **Acceptance**: `WeaveConfigSchema.safeParse({ pipeline: { executor: "my-agent" } })` succeeds. `WeaveConfigSchema.safeParse({ pipeline: { executor: 123 } })` fails. Empty `{}` still parses successfully (backward compatible). `bun run tsc --noEmit` passes.

- [ ] 2. Add `pipeline` merge support to `src/config/merge.ts`
  **What**: Add pipeline merging in `mergeConfigs()`. The `pipeline` field is a flat object with optional scalar and array fields. Use the same pattern as `experimental` for scalar fields (project wins) but handle the `reviewers` array with `mergeStringArrays` for union semantics.

  > ⚠️ **[H3] Dead code — do NOT use the double fallback.** The `?? (user.pipeline?.reviewers ?? project.pipeline?.reviewers)` fallback after `mergeStringArrays()` is unreachable dead code because `mergeStringArrays` already returns `undefined` when both inputs are `undefined`. Use the simpler form below.

  Add after the `experimental` merge (around line 76):
  ```typescript
  pipeline:
    user.pipeline || project.pipeline
      ? {
          ...user.pipeline,
          ...project.pipeline,
          reviewers: mergeStringArrays(
            user.pipeline?.reviewers as string[] | undefined,
            project.pipeline?.reviewers as string[] | undefined,
          ),
        }
      : undefined,
  ```
  **Files**: `src/config/merge.ts`
  **Acceptance**: `mergeConfigs({ pipeline: { planner: "a" } }, { pipeline: { executor: "b" } })` produces `{ pipeline: { planner: "a", executor: "b" } }`. Project `executor` overrides user `executor`. Reviewers arrays are unioned. When both inputs have `undefined` reviewers, the merged reviewers is `undefined` (not a dead fallback).

- [ ] 3. Add schema tests for pipeline config in `src/config/schema.test.ts`
  **What**: Add a new `describe("pipeline config")` block to the existing test file. Test cases:
  - Parses valid pipeline with all fields
  - Parses pipeline with partial fields (only `executor`)
  - Parses pipeline with empty `reviewers` array
  - Rejects non-string values for `planner`/`executor`/`security_reviewer`
  - Rejects non-array for `reviewers`
  - Empty config `{}` still parses (backward compat)
  
  Follow the existing test pattern: `WeaveConfigSchema.safeParse(...)`, check `result.success` and `result.data`.
  **Files**: `src/config/schema.test.ts`
  **Acceptance**: All new tests pass. Existing tests still pass.

- [ ] 4. Add merge tests for pipeline config in `src/config/merge.test.ts`
  **What**: Add test cases to the existing `describe("mergeConfigs")` block:
  - User pipeline + no project pipeline → user pipeline preserved
  - No user pipeline + project pipeline → project pipeline used
  - User planner + project executor → both present in merged
  - Project executor overrides user executor
  - Reviewers arrays are unioned
  - Empty pipeline on both sides → no pipeline in result
  - Both sides have `undefined` reviewers → merged reviewers is `undefined` (no dead fallback)
  **Files**: `src/config/merge.test.ts`
  **Acceptance**: All new tests pass.

### Phase 2: Pipeline Config Accessor

- [ ] 5. Create pipeline config resolver utility `src/config/pipeline.ts`
  **What**: Create a new file that provides a single source of truth for resolving pipeline role → agent name. This avoids scattering default values across multiple files.

  > ⚠️ **[M5] Do NOT use `as const` on the defaults object.** `as const` makes `reviewers` a `readonly ["weft"]` tuple which is incompatible with `string[]` when used with `Required<PipelineConfig>`. Use `satisfies` instead.

  > ℹ️ **[L1] Multi-role note**: A single agent assigned to multiple roles (e.g., planner + executor) is valid and does not require a warning. This is by design — users may want a single powerful agent to fill multiple roles. Optionally, a debug-level log could note it, but it must not warn or error.

  ```typescript
  import type { PipelineConfig } from "./schema"

  /** Default pipeline role assignments — matches pre-feature behavior */
  export const PIPELINE_DEFAULTS = {
    planner: "pattern",
    executor: "tapestry",
    reviewers: ["weft"],
    security_reviewer: "warp",
  } satisfies Required<PipelineConfig>

  /** Resolved pipeline with defaults applied */
  export interface ResolvedPipeline {
    planner: string
    executor: string
    reviewers: string[]
    securityReviewer: string
  }

  /**
   * Resolve pipeline config by applying defaults for any missing fields.
   * Returns a fully-populated pipeline with no optional fields.
   */
  export function resolvePipeline(config?: PipelineConfig): ResolvedPipeline {
    return {
      planner: config?.planner ?? PIPELINE_DEFAULTS.planner,
      executor: config?.executor ?? PIPELINE_DEFAULTS.executor,
      reviewers: config?.reviewers ?? [...PIPELINE_DEFAULTS.reviewers],
      securityReviewer: config?.security_reviewer ?? PIPELINE_DEFAULTS.security_reviewer,
    }
  }

  /**
   * Check if a pipeline config differs from defaults.
   * Used by fast-path guards to determine if prompt composition can be skipped.
   */
  export function pipelineIsDefault(config?: PipelineConfig): boolean {
    if (!config) return true
    if (config.planner && config.planner !== PIPELINE_DEFAULTS.planner) return false
    if (config.executor && config.executor !== PIPELINE_DEFAULTS.executor) return false
    if (config.security_reviewer && config.security_reviewer !== PIPELINE_DEFAULTS.security_reviewer) return false
    if (config.reviewers) {
      const defaults = PIPELINE_DEFAULTS.reviewers
      if (config.reviewers.length !== defaults.length) return false
      if (!config.reviewers.every((r, i) => r === defaults[i])) return false
    }
    return true
  }

  /**
   * Validate that pipeline agents exist in the registered agent set
   * and are not disabled. Returns warnings (not errors) for invalid assignments.
   */
  export function validatePipelineAgents(
    pipeline: ResolvedPipeline,
    registeredAgents: Set<string>,
    disabledAgents: Set<string>,
  ): string[] {
    const warnings: string[] = []
    const check = (role: string, agentName: string) => {
      if (disabledAgents.has(agentName)) {
        warnings.push(`Pipeline ${role} "${agentName}" is in disabled_agents — role will not function`)
      } else if (!registeredAgents.has(agentName)) {
        warnings.push(`Pipeline ${role} "${agentName}" is not a registered agent`)
      }
    }
    check("planner", pipeline.planner)
    check("executor", pipeline.executor)
    for (const reviewer of pipeline.reviewers) {
      check("reviewer", reviewer)
    }
    check("security_reviewer", pipeline.securityReviewer)
    return warnings
  }
  ```
  **Files**: `src/config/pipeline.ts` (new)
  **Acceptance**: `resolvePipeline()` returns defaults. `resolvePipeline({ executor: "my-custom" })` returns `{ planner: "pattern", executor: "my-custom", reviewers: ["weft"], securityReviewer: "warp" }`. `pipelineIsDefault()` returns `true`. `pipelineIsDefault({ executor: "custom" })` returns `false`. Validation catches disabled/missing agents. `bun run tsc --noEmit` passes.

- [ ] 6. Add tests for pipeline resolver in `src/config/pipeline.test.ts`
  **What**: Create test file covering:
  - `resolvePipeline()` with no config returns all defaults
  - `resolvePipeline()` with partial config merges with defaults
  - `resolvePipeline()` with full config uses all provided values
  - `pipelineIsDefault()` returns `true` for `undefined`
  - `pipelineIsDefault()` returns `true` for empty object `{}`
  - `pipelineIsDefault()` returns `false` when any field differs from defaults
  - `pipelineIsDefault()` returns `false` for different reviewers array
  - `validatePipelineAgents()` returns empty for valid agents
  - `validatePipelineAgents()` warns for disabled agents
  - `validatePipelineAgents()` warns for unregistered agents
  - `validatePipelineAgents()` checks all roles
  **Files**: `src/config/pipeline.test.ts` (new)
  **Acceptance**: All tests pass.

### Phase 3: Loom Prompt Composer Updates

- [ ] 7. Extend `LoomPromptOptions` to accept pipeline config
  **What**: In `src/agents/loom/prompt-composer.ts`, add `pipeline?: ResolvedPipeline` to the `LoomPromptOptions` interface (line 14-21). Import `ResolvedPipeline` from `../../config/pipeline`. Import `resolvePipeline` for use in `composeLoomPrompt`. In `composeLoomPrompt()` (line 304), resolve the pipeline: `const pipeline = options.pipeline ?? resolvePipeline()`.

  Pass `pipeline` to `buildPlanWorkflowSection`, `buildReviewWorkflowSection`, `buildDelegationSection`, and `buildDelegationNarrationSection`.
  **Files**: `src/agents/loom/prompt-composer.ts`
  **Acceptance**: `composeLoomPrompt()` with no options still produces identical output to current behavior.

- [ ] 8. Update `buildDelegationSection` to use pipeline config
  **What**: Change the function signature to accept pipeline: `buildDelegationSection(disabled: Set<string>, pipeline?: ResolvedPipeline)`. Import `resolvePipeline` and default: `const p = pipeline ?? resolvePipeline()`.

  Replace hardcoded agent names:
  - Line 79: `isAgentEnabled("pattern", disabled)` → `isAgentEnabled(p.planner, disabled)` with text `Use ${p.planner} for detailed planning...`
  - Line 83: `isAgentEnabled("tapestry", disabled)` → `isAgentEnabled(p.executor, disabled)` with text mentioning `/start-work` and the executor name
  - Lines 88-99: For reviewers, iterate `p.reviewers` and check each. For security reviewer, check `p.securityReviewer`.

  Keep the `isAgentEnabled("thread", disabled)` and `isAgentEnabled("spindle", disabled)` and `isAgentEnabled("shuttle", disabled)` checks as-is — those are not pipeline roles.

  **Important**: The weft/warp block (lines 88-99) has complex conditional logic for combining reviewer + security reviewer text. Refactor to:
  1. Check if any reviewer in `p.reviewers` is enabled → include reviewer delegation line
  2. Check if `p.securityReviewer` is enabled → include security review mandate
  3. Keep the same MUST language for security reviewer

  > ⚠️ **[M3] Edge case — `reviewers = []` with `securityReviewer` set.** When `p.reviewers` is an empty array but `p.securityReviewer` is set and enabled, the security-reviewer-only branch text must still appear. When both `p.reviewers` is empty and `p.securityReviewer` is disabled, neither reviewer nor security reviewer delegation text should appear.

  **Acceptance criteria for M3**:
  - `reviewers: []` + `securityReviewer: "warp"` (enabled) → security reviewer delegation appears, no general reviewer delegation
  - `reviewers: []` + `securityReviewer` disabled → no review delegation at all
  - `reviewers: ["weft"]` + `securityReviewer: "warp"` (both enabled) → both appear (default behavior)

  **Files**: `src/agents/loom/prompt-composer.ts`
  **Acceptance**: Default pipeline produces identical output. Custom `{ planner: "my-planner" }` produces text with "my-planner" instead of "Pattern". Empty reviewers + enabled security reviewer still shows security review text.

- [ ] 9. Update `buildPlanWorkflowSection` to use pipeline config
  **What**: Change signature to accept pipeline: `buildPlanWorkflowSection(disabled: Set<string>, pipeline?: ResolvedPipeline)`. Default: `const p = pipeline ?? resolvePipeline()`.

  Replace hardcoded names:
  - Line 153: `isAgentEnabled("tapestry", disabled)` → `isAgentEnabled(p.executor, disabled)`
  - Line 154: `isAgentEnabled("pattern", disabled)` → `isAgentEnabled(p.planner, disabled)`
  - Lines 151, 164-165: `isAgentEnabled("weft", disabled)` → check if any `p.reviewers` is enabled; `isAgentEnabled("warp", disabled)` → `isAgentEnabled(p.securityReviewer, disabled)`
  - Step 1 text (line 159): Replace "Pattern" with capitalized planner name
  - Step 2 text (line 182): Replace "Weft" with first reviewer name
  - Step 3 text (line 188-191): Replace "Tapestry" with executor name
  - Note text (line 199): Replace "Tapestry runs Weft and Warp" with pipeline names

  > ⚠️ **[M2] `capitalize()` must handle hyphenated agent names.** A user may configure `planner: "my-planner"`. The naive `capitalize` (`s.charAt(0).toUpperCase() + s.slice(1)`) would produce `"My-planner"` instead of `"My Planner"`. Use this implementation:
  > ```typescript
  > const capitalize = (s: string) => s.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
  > ```
  > This converts `"my-planner"` → `"My Planner"`, `"pattern"` → `"Pattern"`, `"weft"` → `"Weft"`.

  **Files**: `src/agents/loom/prompt-composer.ts`
  **Acceptance**: Default pipeline produces identical output. Custom executor name appears in the EXECUTE step. `capitalize("my-reviewer")` produces `"My Reviewer"`.

- [ ] 10. Update `buildReviewWorkflowSection` to use pipeline config
  **What**: Change signature: `buildReviewWorkflowSection(disabled: Set<string>, pipeline?: ResolvedPipeline)`. Default: `const p = pipeline ?? resolvePipeline()`.

  Replace:
  - Lines 216-218: Check `p.reviewers` and `p.securityReviewer` instead of hardcoded "weft"/"warp"
  - Line 226: Check `p.executor` instead of "tapestry"
  - Lines 229, 237: Use reviewer names from pipeline
  - Lines 254-261: Use `p.securityReviewer` name

  The function returns empty string when no reviewers or security reviewer enabled — keep this logic but driven by pipeline config.
  **Files**: `src/agents/loom/prompt-composer.ts`
  **Acceptance**: Default pipeline produces identical output. With custom reviewer, that name appears in the section.

- [ ] 11. Update `buildDelegationNarrationSection` to use pipeline config
  **What**: Change signature: `buildDelegationNarrationSection(disabled: Set<string>, pipeline?: ResolvedPipeline)`. Default: `const p = pipeline ?? resolvePipeline()`.

  Replace:
  - Line 110: `isAgentEnabled("pattern", disabled)` → `isAgentEnabled(p.planner, disabled)` and use planner name in hint text
  - Lines 116-117: Check reviewer/security reviewer from pipeline for review duration hints

  Keep thread and spindle checks as-is (not pipeline roles).

  > ⚠️ **[H5] Narration hint text must use exact replacement templates.** The current plan did not specify the replacement text for narration hints when pipeline roles change. Use these templates:
  > ```typescript
  > // Planner hint (replacing hardcoded "Pattern" reference):
  > const plannerName = capitalize(p.planner)
  > hints.push(`- ${plannerName} (planning): "Creating a detailed plan — this will take a moment..."`)
  >
  > // Review hint (replacing hardcoded "Weft"/"Warp" references):
  > const activeReviewers = p.reviewers.filter(r => isAgentEnabled(r, disabled))
  > const reviewerParts = [
  >   ...activeReviewers.map(capitalize),
  >   ...(isAgentEnabled(p.securityReviewer, disabled) ? [capitalize(p.securityReviewer)] : []),
  > ]
  > if (reviewerParts.length > 0) {
  >   const reviewerNames = reviewerParts.join("/")
  >   hints.push(`- ${reviewerNames} (review): "Running review — this will take a moment..."`)
  > }
  > ```
  > This ensures narration hints always reflect the configured pipeline roles, not hardcoded names.

  **Files**: `src/agents/loom/prompt-composer.ts`
  **Acceptance**: Default pipeline produces identical duration hints. Custom planner name appears in planning hint. Custom reviewer names appear in review hints.

- [ ] 12. Update `composeLoomPrompt` to thread pipeline through
  **What**: In `composeLoomPrompt()` (line 304), resolve pipeline from options and pass to all section builders that now accept it:
  ```typescript
  const pipeline = options.pipeline ?? resolvePipeline()
  // ...
  buildDelegationSection(disabled, pipeline),
  buildDelegationNarrationSection(disabled, pipeline),
  buildPlanWorkflowSection(disabled, pipeline),
  buildReviewWorkflowSection(disabled, pipeline),
  ```
  **Files**: `src/agents/loom/prompt-composer.ts`
  **Acceptance**: Full prompt composition with default pipeline is identical to current output.

### Phase 4: Tapestry Prompt Composer Updates

- [ ] 13. Extend `TapestryPromptOptions` to accept pipeline config
  **What**: In `src/agents/tapestry/prompt-composer.ts`, add `pipeline?: ResolvedPipeline` to `TapestryPromptOptions` (line 11-13). Import `ResolvedPipeline` and `resolvePipeline` from `../../config/pipeline`.
  **Files**: `src/agents/tapestry/prompt-composer.ts`
  **Acceptance**: Interface compiles, no breaking changes.

- [ ] 14. Update `buildTapestryPostExecutionReviewSection` to use pipeline config
  **What**: Change signature to accept pipeline: `buildTapestryPostExecutionReviewSection(disabled: Set<string>, pipeline?: ResolvedPipeline)`. Default: `const p = pipeline ?? resolvePipeline()`.

  Replace:
  - Lines 116-117: `isAgentEnabled("weft", disabled)` → check each reviewer in `p.reviewers`; `isAgentEnabled("warp", disabled)` → `isAgentEnabled(p.securityReviewer, disabled)`
  - Lines 131-136: Replace hardcoded "Weft" and "Warp" with pipeline reviewer and security reviewer names
  - Line 140: Build `reviewerNames` from pipeline config
  - Lines 148-154: Use pipeline names in delegation instructions

  When no reviewers are enabled and no security reviewer is enabled, fall back to the simple "Report summary" version (lines 120-127), matching current behavior.

  Use the same `capitalize` helper as in Task 9 (must handle kebab-case names).

  **Files**: `src/agents/tapestry/prompt-composer.ts`
  **Acceptance**: Default pipeline produces identical PostExecutionReview section. Custom reviewer name appears when configured.

- [ ] 15. Update `buildTapestryPlanExecutionSection` to use pipeline config
  **What**: Change signature to accept pipeline. The function currently checks `isAgentEnabled("weft", disabled)` (line 70-71) to add a Weft verification suffix. Update to check if any reviewer from `p.reviewers` is enabled, and use the reviewer name(s) in the text.

  Use the `capitalize` helper for display names.

  **Files**: `src/agents/tapestry/prompt-composer.ts`
  **Acceptance**: Default pipeline mentions Weft. With custom reviewer `["my-reviewer"]`, mentions that name instead.

- [ ] 16. Update `composeTapestryPrompt` to thread pipeline through
  **What**: Resolve pipeline from options and pass to section builders:
  ```typescript
  const pipeline = options.pipeline ?? resolvePipeline()
  // pass pipeline to buildTapestryPlanExecutionSection and buildTapestryPostExecutionReviewSection
  ```
  **Files**: `src/agents/tapestry/prompt-composer.ts`
  **Acceptance**: Full prompt with default pipeline identical to current output.

### Phase 5: Start-Work Hook & Command Updates

> ⚠️ **[H4] Hard dependency on Task 1.** Do not start any task in Phases 5-8 until Task 1 (`PipelineConfigSchema` added to `WeaveConfig`) is complete and `bun run tsc --noEmit` passes. Tasks 17-24 reference `pluginConfig.pipeline` which does not exist on `WeaveConfig` until Task 1 is merged.

- [ ] 17. Update `handleStartWork` to accept pipeline config
  **What**: Add `pipeline?: ResolvedPipeline` to `StartWorkInput` interface (line 20-24). Import `resolvePipeline` from the pipeline module. In `handleStartWork()` (line 37), resolve: `const pipeline = input.pipeline ?? resolvePipeline()` and `const executorAgent = pipeline.executor`.

  Extract a constant for the executor agent name and replace all 14 `switchAgent: "tapestry"` sites with `switchAgent: executorAgent`. Also replace the 2 `createWorkState(..., "tapestry", ...)` calls with `createWorkState(..., executorAgent, ...)`.

  Update the `StartWorkResult` interface comment (line 29) to say "agent to switch to (default: tapestry, or pipeline executor)" instead of "always tapestry".

  **Specific replacements** (all in `handleStartWork` and its helper functions):
  - `handleExplicitPlan` (line 101): Add `executorAgent` parameter or access from closure
  - `handlePlanDiscovery` (line 159): Same
  
  **Recommended approach**: Since `handleExplicitPlan` and `handlePlanDiscovery` are private functions, add `executorAgent: string` as a parameter to both. Thread it from `handleStartWork`.
  **Files**: `src/hooks/start-work-hook.ts`
  **Acceptance**: Default behavior unchanged. With `pipeline: { executor: "my-executor" }`, `switchAgent` returns `"my-executor"` and `createWorkState` stores it.

- [ ] 18. Update `/start-work` command config to use pipeline executor
  **What**: In `src/features/builtin-commands/commands.ts`, the `agent: "tapestry"` on line 9 determines which agent OpenCode routes the message to. This is a static config — it can't read runtime pipeline config directly.

  **Approach**: The `ConfigHandler.applyCommandConfig()` (in `src/managers/config-handler.ts`, line 131) already clones and remaps commands. Extend it to read the pipeline config and replace the `/start-work` command's agent with `pipeline.executor`:

  In `ConfigHandler`, the constructor already receives `pluginConfig`. Add pipeline resolution:
  ```typescript
  private applyCommandConfig(): Record<string, unknown> {
    const commands = structuredClone(BUILTIN_COMMANDS) as ...
    const pipeline = resolvePipeline(this.pluginConfig.pipeline)
    for (const cmd of Object.values(commands)) {
      // Override start-work's agent with pipeline executor
      if (cmd?.name === "start-work") {
        cmd.agent = pipeline.executor
      }
      if (cmd?.agent && typeof cmd.agent === "string") {
        cmd.agent = getAgentDisplayName(cmd.agent)
      }
    }
    return commands
  }
  ```
  This way the command agent is set from config before display name remapping.
  **Files**: `src/managers/config-handler.ts`, `src/features/builtin-commands/commands.ts` (no change needed here since config-handler handles remapping)
  **Acceptance**: Default: `/start-work` routes to Tapestry. With `pipeline.executor: "my-agent"`, routes to `my-agent`.

- [ ] 19. Update `createHooks` to pass pipeline config to start-work hook
  **What**: In `src/hooks/create-hooks.ts`, the `startWork` hook creates a closure over `directory`. Add pipeline resolution in `createHooks`:

  > ⚠️ **[H6] Do NOT unconditionally overwrite caller-provided pipeline.** The original plan proposed `{ ...input, pipeline }` which would overwrite any `pipeline` value the caller already set on `input`. Use `input.pipeline ?? pipeline` to respect caller-provided values:

  ```typescript
  import { resolvePipeline } from "../config/pipeline"
  // ...
  const pipeline = resolvePipeline(pluginConfig.pipeline)
  // ...
  startWork: isHookEnabled("start-work")
    ? (promptText: string, sessionId: string) =>
        handleStartWork({ promptText, sessionId, directory, pipeline })
    : null,
  ```

  Since `handleStartWork` currently receives input as a single object and the caller is `createHooks` (not an external API), the pipeline is always set by `createHooks`. However, for future-proofing, `handleStartWork` (Task 17) should still default: `const resolved = input.pipeline ?? resolvePipeline()`.

  > ℹ️ **[M4] Opportunistic fix**: `src/integration.test.ts` lines 105-108 have a pre-existing bug — `createHooks` is called without the required `directory` parameter. When modifying `createHooks`'s signature or adding `pipeline`, fix the integration test to include `directory: tmpdir()` or a test fixture path.

  **Files**: `src/hooks/create-hooks.ts`
  **Acceptance**: Pipeline config flows through to start-work hook. Integration test still passes.

### Phase 6: Verification Reminder Updates

- [ ] 20. Update `buildVerificationReminder` to use pipeline config
  **What**: In `src/hooks/verification-reminder.ts`, add `pipeline?: ResolvedPipeline` to `VerificationInput` (line 6-11). Import `resolvePipeline` and `ResolvedPipeline`.

  Replace hardcoded agent names:
  - Line 39: Replace `weft` with first reviewer from `p.reviewers`
  - Line 42: Replace `warp` with `p.securityReviewer`

  ```typescript
  const p = input.pipeline ?? resolvePipeline()
  const reviewerName = p.reviewers[0] ?? "weft"
  const securityName = p.securityReviewer
  ```
  **Files**: `src/hooks/verification-reminder.ts`
  **Acceptance**: Default produces identical text. Custom reviewer name appears in generated prompt.

- [ ] 21. Update `createHooks` to pass pipeline to verification-reminder
  **What**: In `src/hooks/create-hooks.ts`, the `verificationReminder` hook wraps `buildVerificationReminder`. Update the wrapper to inject pipeline config:

  > ⚠️ **[H6] Do NOT unconditionally overwrite caller-provided pipeline.** Use `input.pipeline ?? pipeline` to respect any caller-provided value:

  ```typescript
  verificationReminder: isHookEnabled("verification-reminder")
    ? (input: VerificationInput) =>
        buildVerificationReminder({ ...input, pipeline: input.pipeline ?? pipeline })
    : null,
  ```
  Import `VerificationInput` type from the verification-reminder module.
  **Files**: `src/hooks/create-hooks.ts`
  **Acceptance**: Pipeline config flows through to verification reminder. Caller-provided pipeline is respected.

### Phase 7: Agent Construction Wiring

- [ ] 22. Pass pipeline config through `createBuiltinAgents` to prompt composers
  **What**: In `src/agents/builtin-agents.ts`, add `pipeline?: PipelineConfig` to `CreateBuiltinAgentsOptions` (line 18-31). Import `resolvePipeline`, `pipelineIsDefault`, and `PipelineConfig`.

  In `createBuiltinAgents()` (line 172), resolve the pipeline and pass it to the prompt-composer-aware constructors:
  - Line 208: `createLoomAgentWithOptions(resolvedModel, disabledSet, fingerprint, customAgentMetadata, resolvedPipeline)`
  - Line 210: `createTapestryAgentWithOptions(resolvedModel, disabledSet, resolvedPipeline)`

  Update the `createLoomAgentWithOptions` and `createTapestryAgentWithOptions` function signatures in their respective files to accept and forward the pipeline.

  > ⚠️ **[H1+H2] CRITICAL: Fast-path guards must be extended.** The fast-path in `src/agents/loom/index.ts` (lines 20-22) returns `LOOM_DEFAULTS` directly when no agents disabled, no fingerprint, and no custom agents — **completely skipping `composeLoomPrompt()`**. The same issue exists in `src/agents/tapestry/index.ts` (lines 13-15). Without fixing these guards, pipeline config changes are silently ignored for ~95% of users (those without disabled agents, fingerprints, or custom agents).
  >
  > **Required fix in `src/agents/loom/index.ts`:**
  > ```typescript
  > export function createLoomAgentWithOptions(
  >   model: string,
  >   disabledAgents?: Set<string>,
  >   fingerprint?: ProjectFingerprint | null,
  >   customAgents?: AvailableAgent[],
  >   pipeline?: ResolvedPipeline,
  > ): AgentConfig {
  >   if (
  >     (!disabledAgents || disabledAgents.size === 0) &&
  >     !fingerprint &&
  >     (!customAgents || customAgents.length === 0) &&
  >     !pipeline  // ← ADD THIS: skip fast-path when pipeline is provided
  >   ) {
  >     return { ...LOOM_DEFAULTS, model, mode: "primary" }
  >   }
  >   return {
  >     ...LOOM_DEFAULTS,
  >     prompt: composeLoomPrompt({ disabledAgents, fingerprint, customAgents, pipeline }),
  >     model,
  >     mode: "primary",
  >   }
  > }
  > ```
  >
  > **Required fix in `src/agents/tapestry/index.ts`:**
  > ```typescript
  > export function createTapestryAgentWithOptions(
  >   model: string,
  >   disabledAgents?: Set<string>,
  >   pipeline?: ResolvedPipeline,
  > ): AgentConfig {
  >   if (
  >     (!disabledAgents || disabledAgents.size === 0) &&
  >     !pipeline  // ← ADD THIS: skip fast-path when pipeline is provided
  >   ) {
  >     return { ...TAPESTRY_DEFAULTS, tools: { ...TAPESTRY_DEFAULTS.tools }, model, mode: "primary" }
  >   }
  >   return {
  >     ...TAPESTRY_DEFAULTS,
  >     tools: { ...TAPESTRY_DEFAULTS.tools },
  >     prompt: composeTapestryPrompt({ disabledAgents, pipeline }),
  >     model,
  >     mode: "primary",
  >   }
  > }
  > ```
  >
  > **Alternative approach**: Instead of `!pipeline`, use `pipelineIsDefault(pipeline)` from `src/config/pipeline.ts` (Task 5) to allow the fast-path when pipeline matches defaults. This is slightly more efficient (avoids unnecessary prompt recomposition for default config) but adds a function call to the hot path. Either approach is acceptable.

  **Files**: `src/agents/builtin-agents.ts`, `src/agents/loom/index.ts`, `src/agents/tapestry/index.ts`
  **Acceptance**: Pipeline config reaches prompt composers during agent construction. Non-default pipeline config triggers prompt recomposition (fast-path is bypassed). Default pipeline (or no pipeline) still uses fast-path.

- [ ] 23. Pass pipeline config from `createManagers` to `createBuiltinAgents`
  **What**: In `src/create-managers.ts`, the `createBuiltinAgents` call (line 45-51) passes options. Add `pipeline: pluginConfig.pipeline` to the options object.

  > ⚠️ **[H4]**: This task requires `pluginConfig.pipeline` to exist on `WeaveConfig`. Verify Task 1 is complete and `bun run tsc --noEmit` passes before starting.

  **Files**: `src/create-managers.ts`
  **Acceptance**: Pipeline config from user's config file reaches agent construction.

### Phase 8: Validation at Startup

- [ ] 24. Add pipeline validation in `createManagers`
  **What**: After agents are built (after line 72 in `src/create-managers.ts`), validate the pipeline config against registered agents:
  ```typescript
  import { resolvePipeline, validatePipelineAgents } from "./config/pipeline"

  const pipeline = resolvePipeline(pluginConfig.pipeline)
  const registeredAgentNames = new Set(Object.keys(agents))
  const disabledSet = new Set(pluginConfig.disabled_agents ?? [])
  const pipelineWarnings = validatePipelineAgents(pipeline, registeredAgentNames, disabledSet)
  for (const warning of pipelineWarnings) {
    log(`[pipeline] Warning: ${warning}`)
  }
  ```
  Import `log` from shared/log. Warnings are logged but do not block startup.

  > ⚠️ **[H4]**: This task requires `pluginConfig.pipeline` to exist on `WeaveConfig`. Verify Task 1 is complete and `bun run tsc --noEmit` passes before starting.

  **Files**: `src/create-managers.ts`
  **Acceptance**: Invalid pipeline agent names produce log warnings. Valid configs produce no warnings.

### Phase 9: Loom Prompt Composer Tests

- [ ] 25. Update Loom prompt composer tests for pipeline support
  **What**: In `src/agents/loom/prompt-composer.test.ts`, add a new `describe("pipeline role-swapping")` block. Test cases:

  - Default pipeline (no pipeline option) produces identical output to current tests (backward compat)
  - Custom planner name appears in PlanWorkflow section
  - Custom executor name appears in PlanWorkflow and Delegation sections
  - Custom reviewer names appear in ReviewWorkflow and PlanWorkflow sections
  - Custom security reviewer name appears in ReviewWorkflow and Delegation sections
  - `buildDelegationSection` with custom pipeline uses pipeline agent names
  - `buildPlanWorkflowSection` with custom pipeline uses pipeline agent names
  - `buildReviewWorkflowSection` with custom pipeline uses pipeline agent names
  - `buildDelegationNarrationSection` with custom planner uses planner name in duration hints
  - Hyphenated agent names are capitalized correctly (e.g., `"my-reviewer"` → `"My Reviewer"`)

  Use `resolvePipeline({ executor: "my-agent" })` to create test pipelines.

  > ⚠️ **[M1] Existing tests assert exact hardcoded strings that will break.** The following existing assertions will need updating because they reference hardcoded agent names that are now dynamically generated:
  >
  > | Line | Current assertion | Impact |
  > |------|------------------|--------|
  > | 50 | `expect(prompt).toContain("Tapestry runs Weft and Warp")` | Text now uses pipeline names — with defaults this should still match, but verify the exact string template produces identical output for defaults |
  > | 188 | `expect(section).toContain("Tapestry invokes Weft and Warp")` | Same — verify template produces identical string for defaults |
  >
  > **Action**: Run the existing tests FIRST after making prompt composer changes (Tasks 7-12). If any existing assertion fails, update the assertion to match the new template output for default pipeline. Do NOT delete existing backward-compat tests — update them to verify the same semantic content. If the template produces the exact same string for defaults (which it should), no change is needed.

  **Files**: `src/agents/loom/prompt-composer.test.ts`
  **Acceptance**: All new tests pass. All existing tests pass (or are updated to match template output for default pipeline).

### Phase 10: Tapestry Prompt Composer Tests

- [ ] 26. Update Tapestry prompt composer tests for pipeline support
  **What**: In `src/agents/tapestry/prompt-composer.test.ts`, add a `describe("pipeline role-swapping")` block. Test cases:

  - Default pipeline produces identical PostExecutionReview section
  - Custom reviewer names appear in PostExecutionReview delegation instructions
  - Custom security reviewer name appears in PostExecutionReview
  - `buildTapestryPlanExecutionSection` with custom reviewer uses reviewer name
  - Empty reviewers array → no reviewer delegation in PostExecutionReview
  - Hyphenated agent names are capitalized correctly

  > ⚠️ **[M1] Existing tests assert hardcoded "Weft" and "Warp" strings.** The following existing assertions may need updating:
  >
  > | Line | Current assertion | Impact |
  > |------|------------------|--------|
  > | 32-39 | `expect(reviewSection).toContain("Weft")` / `"Warp"` | Should still pass if defaults produce same strings |
  > | 55 | `expect(section).toContain("Weft")` | Same |
  > | 62 | `expect(section).toContain("Weft")` + `not.toContain("Warp")` | These test disabled-agent behavior — ensure the disabled check still works with pipeline config |
  > | 67-69 | `expect(section).not.toContain("Weft")` + `toContain("Warp")` | Same |
  > | 110-112 | `expect(section).toContain("Weft")` | Tests `buildTapestryPlanExecutionSection` |
  > | 116-117 | `expect(section).not.toContain("Weft")` | Tests disabled weft |
  >
  > **Action**: Same as Task 25 — run existing tests first. If default pipeline still produces exact same strings (which it should by design), no changes needed. If template changes the format, update assertions to match.

  **Files**: `src/agents/tapestry/prompt-composer.test.ts`
  **Acceptance**: All tests pass.

### Phase 11: Start-Work Hook Tests

- [ ] 27. Update start-work hook tests for pipeline executor
  **What**: In `src/hooks/start-work-hook.test.ts`, add a `describe("pipeline executor")` block. Test cases:

  - Default (no pipeline): `switchAgent` is `"tapestry"` (existing test, kept as regression)
  - Custom executor: `switchAgent` is the pipeline executor name
  - Custom executor: `createWorkState` stores the executor name in `state.agent`
  - Custom executor in resume path: `switchAgent` uses pipeline executor
  - Custom executor in plan discovery: `switchAgent` uses pipeline executor
  - Custom executor in validation failure: `switchAgent` still uses pipeline executor

  Pass `pipeline` through the `handleStartWork` input.
  **Files**: `src/hooks/start-work-hook.test.ts`
  **Acceptance**: All tests pass. Existing tests unchanged.

### Phase 12: Workflow Integration Tests

- [ ] 28. Add pipeline role-swapping workflow integration tests
  **What**: In `src/workflow.test.ts`, add a `describe("Pipeline Role-Swapping")` block with end-to-end tests:

  - Custom executor: `/start-work` returns `switchAgent` with custom executor name
  - Custom executor: work state stores custom executor name
  - Default pipeline: all existing tests pass unchanged (regression guard)
  - Custom pipeline with custom agent as reviewer: Tapestry prompt mentions custom reviewer name

  These tests should use the same test infrastructure (temp dirs, `createPlanFile`, `makeStartWorkPrompt`).

  > ℹ️ **[M4] Opportunistic fix**: When writing integration tests or touching `createHooks`, fix the pre-existing bug in `src/integration.test.ts` lines 105-108 where `createHooks` is called without the required `directory` parameter. Add `directory: tmpdir()` or an appropriate test fixture path.

  **Files**: `src/workflow.test.ts`, `src/integration.test.ts` (opportunistic fix)
  **Acceptance**: All tests pass.

### Phase 13: Fast-Path Guard Tests

- [ ] 29. Add fast-path guard tests for pipeline awareness
  **What**: Add tests to verify the fast-path guards in `loom/index.ts` and `tapestry/index.ts` correctly detect non-default pipeline config. These are critical to the H1+H2 fix.

  In `src/agents/loom/index.test.ts` (create if needed) or add to existing test file:
  - `createLoomAgentWithOptions` with no pipeline uses `LOOM_DEFAULTS.prompt` (fast-path)
  - `createLoomAgentWithOptions` with non-default pipeline calls `composeLoomPrompt` (prompt differs from defaults)
  - `createLoomAgentWithOptions` with default-equivalent pipeline uses fast-path (if using `pipelineIsDefault` approach)

  In `src/agents/tapestry/index.test.ts` (create if needed) or add to existing test file:
  - `createTapestryAgentWithOptions` with no pipeline uses `TAPESTRY_DEFAULTS.prompt` (fast-path)
  - `createTapestryAgentWithOptions` with non-default pipeline calls `composeTapestryPrompt` (prompt differs)

  **Files**: `src/agents/loom/index.test.ts` (new or existing), `src/agents/tapestry/index.test.ts` (new or existing)
  **Acceptance**: Tests prove that non-default pipeline config bypasses fast-path and triggers prompt recomposition.

### Phase 14: Documentation

- [ ] 30. Document pipeline config in `docs/configuration.md`
  **What**: Add a new section "## Pipeline Role Configuration" after the "## Agent Names" section (after line 121). Include:

  - Explanation of the pipeline concept
  - Full schema example:
  ```jsonc
  {
    "pipeline": {
      "planner": "pattern",         // Agent that creates plans (default: pattern)
      "executor": "tapestry",       // Agent that executes plans (default: tapestry)
      "reviewers": ["weft"],        // Agents that review work (default: ["weft"])
      "security_reviewer": "warp"   // Agent for security audits (default: warp)
    }
  }
  ```
  - Default values table
  - Example: using a custom agent as reviewer
  - Example: using a custom agent as executor
  - Note about validation warnings for invalid/disabled agents
  - Note that pipeline shape is fixed — only the agents filling roles can be changed
  - Note that assigning the same agent to multiple roles is valid

  Update the "Full Schema" JSONC block (around line 28-103) to include the `pipeline` field.
  **Files**: `docs/configuration.md`
  **Acceptance**: Documentation accurately describes the feature with working examples.

## Verification

- [ ] Run `bun run tsc --noEmit` — zero type errors
- [ ] Run `bun test` — all tests pass
- [ ] Run `bun test src/config/schema.test.ts` — schema tests pass
- [ ] Run `bun test src/config/pipeline.test.ts` — pipeline resolver tests pass (including `pipelineIsDefault`)
- [ ] Run `bun test src/config/merge.test.ts` — merge tests pass
- [ ] Run `bun test src/agents/loom/prompt-composer.test.ts` — Loom prompt tests pass
- [ ] Run `bun test src/agents/tapestry/prompt-composer.test.ts` — Tapestry prompt tests pass
- [ ] Run `bun test src/hooks/start-work-hook.test.ts` — start-work hook tests pass
- [ ] Run `bun test src/workflow.test.ts` — workflow integration tests pass
- [ ] Run `bun test src/agents/loom/index.test.ts` — fast-path guard tests pass (H1 fix verified)
- [ ] Run `bun test src/agents/tapestry/index.test.ts` — fast-path guard tests pass (H2 fix verified)
- [ ] Verify backward compatibility: `composeLoomPrompt()` with no options produces identical output to pre-change baseline
- [ ] Verify backward compatibility: `composeTapestryPrompt()` with no options produces identical output to pre-change baseline
- [ ] Verify backward compatibility: `handleStartWork` with no pipeline config returns `switchAgent: "tapestry"`
- [ ] Verify fast-path bypass: `createLoomAgentWithOptions` with non-default pipeline produces different prompt than defaults
- [ ] Verify fast-path bypass: `createTapestryAgentWithOptions` with non-default pipeline produces different prompt than defaults
- [ ] No regressions: `bun test` passes end-to-end with zero failures
