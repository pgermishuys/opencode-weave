# Consolidate Eval Spike into Main Framework

## TL;DR
> **Summary**: Port the 5 missing capabilities (JSONL trend tracking, GitHub Actions Job Summary, trend analysis, auto-commit, case-insensitive matching) from the eval spike into the main eval framework, add the missing `route-to-shuttle-specialist-hard` test case, then retire the spike workflow and script.
> **Estimated Effort**: Large

## Context

### Original Request
The project has two overlapping eval workflows:
1. **Main eval framework** (`evals.yml` → `script/eval.ts` → `src/features/evals/`) — runs deterministic prompt-contract evals and a `phase2-routing` job using `agent-routing` suite with `model-response` executor and `llm-judge` evaluator.
2. **Eval spike** (`eval-spike-github-models.yml` → `script/eval-spike-github-models.ts`) — a standalone prototype that calls GitHub Models API with hardcoded cases, grades responses, tracks trends in JSONL, writes GitHub Actions Job Summaries, runs trend analysis, and auto-commits results.

The spike was the precursor. Its cases have been backported to the `agent-routing` suite. But the spike has 5 capabilities the main framework lacks, plus 1 missing test case.

### Key Findings

**Architecture of the main framework:**
- `script/eval.ts` is the CLI entry point. It calls `runEvalSuite()` from `src/features/evals/runner.ts`.
- `runEvalSuite()` returns `RunEvalSuiteOutput = { result: EvalRunResult, artifactPath: string, consoleSummary: string }`.
- `EvalRunResult` contains `runId`, `startedAt`, `finishedAt`, `suiteId`, `phase`, `summary: EvalRunSummary`, `caseResults: EvalCaseResult[]`.
- Results are written to `.weave/evals/runs/{runId}.json` (gitignored, ephemeral) and `.weave/evals/latest.json` via `storage.ts`.
- `reporter.ts` produces plain-text console output only — no Markdown, no Job Summary.
- `evals.yml` uploads `.weave/evals/` as an artifact and has no trend tracking, no Job Summary, no auto-commit.

**Architecture of the spike:**
- `script/eval-spike-github-models.ts` has its own hardcoded `EVAL_CASES`, its own `RunSummary` type, its own grading logic.
- It appends each run as a full `RunSummary` JSON line to `evals/results/github-models-spike.jsonl` (git-tracked).
- It writes a rich Markdown table to `GITHUB_STEP_SUMMARY`.
- `script/eval-trend-report.ts` reads the JSONL file and produces sparklines, flaky detection, regression alerts. It also writes its own Job Summary section.
- `eval-spike-github-models.yml` auto-commits the JSONL file back to `main` and runs trend analysis with `--check --threshold 0.80`.

**Case-sensitivity bug in `llm-judge.ts`:**
- Line 16: `output.includes(pattern)` — case-sensitive.
- Spike's `gradeResponse()` does `modelResponse.toLowerCase()` and `pattern.toLowerCase()` before comparison.
- This means a model response like "I'll delegate to Thread" would fail the `llm-judge` check for `"thread"` but pass in the spike.

**Missing test case:**
- `route-to-shuttle-specialist-hard` exists only in the spike (line 123 of `eval-spike-github-models.ts`). It's a harder variant without the magic phrase "category-specific specialized work".

**Existing JSONL trend data:**
- `evals/results/github-models-spike.jsonl` has 5 runs of data. The format uses the spike's `RunSummary` type, which differs from `EvalRunResult`. Key differences:
  - Spike: `{ timestamp, env, model, totalCases, passedCases, failedCases, score, durationMs, results: CaseResult[] }`
  - Main: `{ runId, startedAt, finishedAt, suiteId, phase, summary: EvalRunSummary, caseResults: EvalCaseResult[] }`
- The trend report script (`eval-trend-report.ts`) is tightly coupled to the spike's `RunSummary` format.

**What `.gitignore` covers:**
- `.weave/*` is gitignored (except `plans/` and `designs/`), so `.weave/evals/runs/*.json` files are ephemeral.
- `evals/results/` is git-tracked — the JSONL file lives here and persists across runs.

**Workflow differences:**
- `evals.yml` phase2-routing: triggers on schedule (weekly Mon 10:00 UTC), workflow_dispatch, and when prompts change on PR/push. Non-blocking (`continue-on-error: true`).
- `eval-spike-github-models.yml`: triggers on schedule (weekly Mon 09:00 UTC) and workflow_dispatch. Has `contents: write` + `models: read` permissions. Auto-commits JSONL.

## Objectives

### Core Objective
Consolidate all eval spike capabilities into the main eval framework so there is one canonical eval pipeline, then remove the spike.

### Deliverables
- [ ] JSONL append-only trend tracking integrated into the main framework
- [ ] GitHub Actions Job Summary output for eval runs
- [ ] Trend analysis script adapted to read main framework output format
- [ ] Auto-commit of JSONL results in CI workflow
- [ ] Case-insensitive string matching in `llm-judge.ts`
- [ ] Missing `route-to-shuttle-specialist-hard` test case added
- [ ] Spike workflow and script retired (deleted)
- [ ] Existing JSONL trend history preserved/migrated

### Definition of Done
- [ ] `bun test` passes (all existing tests + new tests)
- [ ] `bun run eval --suite agent-routing` produces JSONL output in `evals/results/agent-routing.jsonl`
- [ ] `bun run eval:trend --file evals/results/agent-routing.jsonl` works
- [ ] `evals.yml` phase2-routing job writes Job Summary, appends JSONL, runs trend check, and auto-commits
- [ ] `eval-spike-github-models.yml` and `script/eval-spike-github-models.ts` are deleted
- [ ] No regressions in deterministic eval suites (`prompt-contracts`, `prompt-smoke`)

### Guardrails (Must NOT)
- Must NOT break existing deterministic eval baselines or the `prompt-contracts`/`prompt-smoke` suites
- Must NOT change the `EvalRunResult` type in a backward-incompatible way (new optional fields only)
- Must NOT remove the per-run JSON files in `.weave/evals/runs/` — keep them for debugging
- Must NOT change how `phase2-routing` handles the GITHUB_TOKEN (it already uses `secrets.GITHUB_TOKEN`)
- Must NOT apply case-insensitive matching to deterministic evaluators (they check rendered prompts where case matters)

## TODOs

### Slice 1: Fix the case-sensitivity bug (no dependencies, safe to parallelize)

- [x] 1. **Fix case-insensitive matching in `llm-judge.ts`**
  **What**: Change `output.includes(pattern)` to lowercase both sides before comparison, matching the spike's `gradeResponse()` behavior. This only affects `llm-judge` evaluator — the deterministic evaluators (`contains-all`, `excludes-all`, etc.) operate on rendered prompts where case is significant and must NOT be changed.
  **Files**:
    - `src/features/evals/evaluators/llm-judge.ts` — lowercase `output` and `pattern` in both `includes()` calls (lines 16 and 29)
  **Acceptance**:
    - Existing `llm-judge.test.ts` tests pass
    - New test: `"Thread"` in output matches expected `"thread"` pattern (case-insensitive)
    - New test: `"I Will Implement This Directly"` in output matches forbidden `"I will implement this directly"` (case-insensitive)

- [x] 2. **Add case-sensitivity tests to `llm-judge.test.ts`**
  **What**: Add test cases that verify case-insensitive matching works correctly.
  **Files**:
    - `src/features/evals/evaluators/llm-judge.test.ts` — add 2 new test cases
  **Acceptance**:
    - `bun test src/features/evals/evaluators/llm-judge.test.ts` passes

### Slice 2: Add the missing test case (no dependencies, safe to parallelize with Slice 1)

- [x] 3. **Create `route-to-shuttle-specialist-hard.jsonc` case file**
  **What**: Create a new eval case file matching the spike's `route-to-shuttle-specialist-hard` case. This is the harder shuttle routing variant that does NOT use the magic phrase "category-specific specialized work". Use the same structure as `route-to-shuttle-specialist.jsonc`.
  **Files**:
    - `evals/cases/loom/phase2/route-to-shuttle-specialist-hard.jsonc` — new file
  **Acceptance**:
    - File follows the same JSONC structure as existing phase2 cases
    - `id` is `"loom-phase2-route-to-shuttle-specialist-hard"`
    - `input` matches the spike: `"We have a product catalog domain that needs GraphQL schema generation — types, resolvers, and input validation. Please delegate to the right specialist agent for this domain work."`
    - `expectedContains: ["shuttle"]`, `forbiddenContains: ["I will implement this directly"]`
    - Tags include `"spike-backport"`

- [x] 4. **Register the new case in `agent-routing.jsonc` suite manifest**
  **What**: Add the new case file path to the `caseFiles` array.
  **Files**:
    - `evals/suites/agent-routing.jsonc` — add `"evals/cases/loom/phase2/route-to-shuttle-specialist-hard.jsonc"` to `caseFiles`
  **Acceptance**:
    - `bun run eval --suite agent-routing --case loom-phase2-route-to-shuttle-specialist-hard --json` loads the case without error (dry validation — actual API call requires token)

### Slice 3: JSONL trend tracking in the main framework (depends on nothing)

- [x] 5. **Add JSONL append function to `storage.ts`**
  **What**: Create a new function `appendEvalRunJsonl(directory: string, result: EvalRunResult, jsonlPath?: string)` that appends a single JSON line to a JSONL file. The default path should be `evals/results/{suiteId}.jsonl` (e.g., `evals/results/agent-routing.jsonl`). The JSONL line should contain the full `EvalRunResult` — this is the main framework's canonical type, not the spike's `RunSummary`.
  **Files**:
    - `src/features/evals/storage.ts` — add `appendEvalRunJsonl()` function and `getDefaultJsonlPath()` helper
  **Acceptance**:
    - Function creates parent directory if needed
    - Function appends (not overwrites) — uses `appendFileSync`
    - Each line is `JSON.stringify(result) + "\n"` (no pretty-printing)
    - Exported from `src/features/evals/index.ts`

- [x] 6. **Add `--jsonl` flag to `script/eval.ts` CLI**
  **What**: Add a `--jsonl [path]` CLI flag that, when present, causes the runner to append the `EvalRunResult` to a JSONL file after the run completes. If no path is given, use the default `evals/results/{suiteId}.jsonl`. This flag should be independent of `--output` (which controls the per-run JSON file).
  **Files**:
    - `script/eval.ts` — add `jsonlPath` to `CliOptions`, parse `--jsonl` flag, call `appendEvalRunJsonl()` after run
  **Acceptance**:
    - `bun run eval --suite prompt-contracts --jsonl` appends to `evals/results/prompt-contracts.jsonl`
    - `bun run eval --suite agent-routing --jsonl evals/results/custom.jsonl` appends to custom path
    - Existing behavior without `--jsonl` is unchanged

- [x] 7. **Add unit tests for `appendEvalRunJsonl`**
  **What**: Test the JSONL append function with a temporary file.
  **Files**:
    - `src/features/evals/storage.test.ts` — new or existing test file
  **Acceptance**:
    - Test verifies append behavior (two calls → two lines)
    - Test verifies each line is valid JSON parseable as `EvalRunResult`
    - `bun test src/features/evals/storage.test.ts` passes

### Slice 4: GitHub Actions Job Summary (depends on nothing, safe to parallelize with Slices 1-3)

- [x] 8. **Add Job Summary renderer to `reporter.ts`**
  **What**: Add a function `formatJobSummaryMarkdown(result: EvalRunResult): string` that produces a Markdown table similar to the spike's `writeJobSummary()`. Include: header with suite/score/duration, per-case result table (case ID, result icon, normalized score), and a collapsible details section for failed cases showing assertion messages.
  **Files**:
    - `src/features/evals/reporter.ts` — add `formatJobSummaryMarkdown()` function
  **Acceptance**:
    - Output includes a Markdown table with `| Case | Result | Score |` columns
    - Failed cases show assertion failure messages in a `<details>` block
    - Function is pure (no side effects — just returns a string)
    - Exported from `src/features/evals/index.ts`

- [x] 9. **Write Job Summary from `script/eval.ts` when in CI**
  **What**: After the eval run completes, if `process.env.GITHUB_STEP_SUMMARY` is set, append the formatted Markdown to the summary file. Use `appendFileSync` to write to the path in `GITHUB_STEP_SUMMARY`.
  **Files**:
    - `script/eval.ts` — add Job Summary write after run, using `formatJobSummaryMarkdown()`
  **Acceptance**:
    - Job Summary is written when `GITHUB_STEP_SUMMARY` env var is set
    - Job Summary is NOT written for local runs (no env var)
    - Existing console output is unchanged

- [x] 10. **Add tests for `formatJobSummaryMarkdown`**
  **What**: Unit tests for the Job Summary renderer.
  **Files**:
    - `src/features/evals/reporter.test.ts` — new test file
  **Acceptance**:
    - Test verifies Markdown contains case IDs and result icons
    - Test verifies failed cases include assertion messages
    - `bun test src/features/evals/reporter.test.ts` passes

### Slice 5: Adapt trend analysis script (depends on Slice 3 for JSONL format)

- [x] 11. **Refactor `eval-trend-report.ts` to support both JSONL formats**
  **What**: The trend report script currently reads the spike's `RunSummary` type. Refactor it to also accept the main framework's `EvalRunResult` format. The simplest approach: detect the format by checking for the presence of `suiteId` (main) vs `model` (spike) at the top level, then normalize both into a common internal `TrendRun` type for analysis. This preserves backward compatibility with existing JSONL data.
  **Files**:
    - `script/eval-trend-report.ts` — refactor `parseJsonl()` to detect and normalize both formats; update internal types
  **Acceptance**:
    - `bun run eval:trend --file evals/results/github-models-spike.jsonl` still works (backward compat)
    - `bun run eval:trend --file evals/results/agent-routing.jsonl` works with new format
    - `--check --threshold 0.80` exit code behavior is preserved
    - Sparklines, flaky detection, regression alerts all work with new format
  **Notes**: The key mapping is:
    - Spike `timestamp` → Main `startedAt`
    - Spike `score` → Main `summary.normalizedScore`
    - Spike `totalCases` → Main `summary.totalCases`
    - Spike `passedCases` → Main `summary.passedCases`
    - Spike `results[].caseId` → Main `caseResults[].caseId`
    - Spike `results[].passed` → Main `caseResults[].status === "passed"`
    - Spike `results[].score` → Main `caseResults[].normalizedScore`
    - Spike `durationMs` → Main: compute from `finishedAt - startedAt`

- [x] 12. **Update `--file` default path or add `--suite` flag to trend report**
  **What**: Currently defaults to `evals/results/github-models-spike.jsonl`. Add a `--suite <name>` flag that resolves to `evals/results/{name}.jsonl` as a convenience. Keep `--file` for explicit paths. Update the default to be `--suite` required OR `--file` required (no implicit default pointing to spike file).
  **Files**:
    - `script/eval-trend-report.ts` — add `--suite` argument parsing, update default behavior
  **Acceptance**:
    - `bun run eval:trend --suite agent-routing` reads `evals/results/agent-routing.jsonl`
    - `bun run eval:trend --file evals/results/github-models-spike.jsonl` still works
    - Running with neither `--suite` nor `--file` prints usage/error

- [x] 13. **Add trend report Job Summary for routing suite**
  **What**: The trend report already writes to `GITHUB_STEP_SUMMARY` — verify this works with the new format. No code change expected, but test it.
  **Files**: No file changes — validation only
  **Acceptance**:
    - Verify the `writeJobSummary()` function in `eval-trend-report.ts` produces valid Markdown for `EvalRunResult`-sourced data

### Slice 6: Update CI workflow (`evals.yml`) (depends on Slices 3-5)

- [x] 14. **Add JSONL append, Job Summary, and trend check to `phase2-routing` job in `evals.yml`**
  **What**: Update the `phase2-routing` job to:
    1. Pass `--jsonl` flag to the eval run so results are appended to `evals/results/agent-routing.jsonl`
    2. The Job Summary write happens automatically (since `GITHUB_STEP_SUMMARY` is set in CI)
    3. Add a "Generate trend report" step that runs `bun run eval:trend --suite agent-routing --check --threshold 0.80` (non-blocking, `continue-on-error: true`)
    4. Add an auto-commit step that commits `evals/results/agent-routing.jsonl` back to `main` (only on `push` to `main` or `schedule`)
  **Files**:
    - `.github/workflows/evals.yml` — modify `phase2-routing` job
  **Acceptance**:
    - The `phase2-routing` job has steps: checkout → setup-bun → install → run eval (with `--jsonl`) → trend report → auto-commit → upload artifacts
    - Auto-commit step has guard: `if: github.ref == 'refs/heads/main' && always()`
    - Auto-commit uses `git config` for `github-actions[bot]` and commits with `[skip ci]`
    - The job has `permissions: contents: write` for auto-commit
    - Trend report step uses `continue-on-error: true`

- [x] 15. **Add `permissions` block to `evals.yml` for auto-commit**
  **What**: The spike workflow has `permissions: contents: write` at the workflow level. The main `evals.yml` does not. Add it to the `phase2-routing` job level (not workflow level, to avoid giving write permissions to the deterministic-evals job).
  **Files**:
    - `.github/workflows/evals.yml` — add `permissions` to `phase2-routing` job
  **Acceptance**:
    - Only `phase2-routing` job has `contents: write`
    - `deterministic-evals` job does NOT get `contents: write`

### Slice 7: Migrate trend history and retire spike (depends on all above)

- [x] 16. **Migrate existing JSONL trend data**
  **What**: The existing `evals/results/github-models-spike.jsonl` has 5 runs of historical data. Since Slice 5 makes the trend report script handle both formats, the simplest approach is:
    1. Copy `evals/results/github-models-spike.jsonl` to `evals/results/github-models-spike.jsonl.archive` (for posterity)
    2. The trend report can read the old spike format, so no data transformation is needed
    3. New runs will write to `evals/results/agent-routing.jsonl` in the main format
    4. The old spike JSONL is left as-is for historical reference but will no longer be appended to
  **Files**:
    - `evals/results/github-models-spike.jsonl` → rename to `evals/results/github-models-spike.jsonl.archive`
  **Acceptance**:
    - `bun run eval:trend --file evals/results/github-models-spike.jsonl.archive` still works
    - New trend data accumulates in `evals/results/agent-routing.jsonl`

- [x] 17. **Delete spike workflow and script**
  **What**: Remove the spike files now that all capabilities are in the main framework.
  **Files to delete**:
    - `.github/workflows/eval-spike-github-models.yml`
    - `script/eval-spike-github-models.ts`
  **Acceptance**:
    - Files are deleted
    - No remaining references to `eval-spike-github-models` in the codebase (check with grep)

- [x] 18. **Update `package.json` scripts**
  **What**: Remove `eval:spike` script alias. Update `eval:trend` to not use a default file path (since the spike file is gone).
  **Files**:
    - `package.json` — remove `"eval:spike"` entry, update `"eval:trend"` if needed
  **Acceptance**:
    - `bun run eval:spike` no longer exists
    - `bun run eval:trend --suite agent-routing` works
    - `bun run eval:trend` without arguments shows usage (not crash)

- [x] 19. **Final validation: run full eval suite**
  **What**: Run all eval suites to confirm nothing is broken.
  **Files**: No file changes — validation only
  **Acceptance**:
    - `bun run eval --suite prompt-contracts --baseline evals/baselines/prompt-contracts.json --fail-on-regression` passes
    - `bun run eval --suite prompt-smoke --baseline evals/baselines/prompt-smoke.json --fail-on-regression` passes
    - `bun run eval:coverage` passes
    - `bun test` passes

## Parallelization Guide

```
Slice 1 (case-sensitivity fix)    ──┐
Slice 2 (missing test case)       ──┤── Can all run in parallel
Slice 3 (JSONL tracking)          ──┤
Slice 4 (Job Summary)            ──┘
                                    │
Slice 5 (trend report refactor)  ───┤── Depends on Slice 3 (needs to know JSONL format)
                                    │
Slice 6 (CI workflow update)     ───┤── Depends on Slices 3, 4, 5
                                    │
Slice 7 (migrate + retire)       ───┘── Depends on everything above
```

## Verification

- [ ] All existing tests pass: `bun test`
- [ ] Deterministic baselines unchanged: `bun run eval --suite prompt-contracts --baseline evals/baselines/prompt-contracts.json --fail-on-regression`
- [ ] Smoke baselines unchanged: `bun run eval --suite prompt-smoke --baseline evals/baselines/prompt-smoke.json --fail-on-regression`
- [ ] Eval coverage check passes: `bun run eval:coverage`
- [ ] New test case loads: `bun run eval --suite agent-routing --case loom-phase2-route-to-shuttle-specialist-hard` (validates loading, not API call)
- [ ] JSONL append works: `bun run eval --suite prompt-contracts --jsonl` → verify `evals/results/prompt-contracts.jsonl` is created
- [ ] Trend report reads new format: `bun run eval:trend --file evals/results/prompt-contracts.jsonl`
- [ ] No references to deleted spike files: `grep -r "eval-spike-github-models" --include="*.ts" --include="*.yml" --include="*.json" .`
- [ ] `llm-judge` handles case differences: verified by new unit tests
