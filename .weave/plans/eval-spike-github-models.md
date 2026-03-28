# GitHub Models Eval Spike

## TL;DR
> **Summary**: Build a standalone TypeScript eval script that calls GitHub Models API with Loom's real system prompt, grades routing decisions with deterministic string checks, and runs locally or in CI via a dedicated GitHub Actions workflow.
> **Estimated Effort**: Medium

## Context
### Original Request
Create a self-contained eval spike that validates Loom's routing decisions against a live LLM (GPT-4o Mini via GitHub Models API). The spike comprises a standalone script, a GitHub Actions workflow, and a carefully designed set of 10 eval cases covering delegation, self-handling, and ambiguous scenarios.

### Key Findings
- **`resolveBuiltinAgentTarget`** (`src/features/evals/targets/builtin-agent-target.ts`) renders Loom's prompt via `composeLoomPrompt({ disabledAgents })` — the spike should reuse this directly rather than reimplementing prompt assembly.
- **`composeLoomPrompt()`** (`src/agents/loom/prompt-composer.ts`) builds the full system prompt with Role, Delegation, PlanWorkflow, ReviewWorkflow, and Style sections. The prompt explicitly names all agents (thread, spindle, pattern, tapestry, shuttle, weft, warp) and describes when each should be used.
- **Existing grading logic** (`src/features/evals/evaluators/llm-judge.ts`) uses `expectedContains` / `forbiddenContains` with weighted scoring — the spike should replicate this simple `string.includes()` approach inline.
- **Phase 2 cases** (`evals/cases/loom/phase2/*.jsonc`) exist for exploration, planning, and security — they use the `model-response` executor which is currently mock-only. The spike bypasses this entire framework to hit a real API.
- **Existing eval workflow** (`.github/workflows/evals.yml`) uses `bun install --frozen-lockfile` + `bun run eval` — the spike workflow should follow the same setup pattern but remain completely independent.
- **`evals/results/` directory doesn't exist yet** — the spike will create it with `mkdir -p` for the JSONL output file.
- **Project uses Bun** as its runtime and `"type": "module"` in package.json — the script should use Bun-native APIs (`Bun.file`, `Bun.write`) where convenient, but `fetch` for the HTTP call (standard, no extra deps).
- **tsconfig.json excludes `script/`** from compilation — scripts run directly via `bun run script/...` without needing to be in the compiled output.
- **Loom's prompt mentions agents by lowercase name** in the delegation section (e.g., "Use thread for fast codebase exploration", "Use pattern for detailed planning"). String checks should match against lowercase agent names to be robust.
- **Rate limits**: GitHub Models Low tier = 15 req/min, 150 req/day, 8K input / 4K output tokens. With 10 cases, a single run uses ~6.7% of daily quota. Sequential calls with 1s delay between them will stay well within the per-minute limit.

## Objectives
### Core Objective
Prove that Loom's system prompt, when paired with a real LLM, produces correct routing decisions for representative user inputs — and build the infrastructure to track this over time.

### Deliverables
- [x] `script/eval-spike-github-models.ts` — Standalone eval script with 10 inline cases, GitHub Models API integration, console + summary output, and JSONL logging
- [x] `.github/workflows/eval-spike-github-models.yml` — CI workflow with manual trigger, schedule, and auto-commit of results
- [x] `evals/results/.gitkeep` — Ensure the results directory exists in the repo

### Definition of Done
- [ ] `GITHUB_TOKEN=ghp_xxx bun run script/eval-spike-github-models.ts` runs locally, prints formatted results, and appends to JSONL
- [ ] The GitHub Actions workflow runs successfully on `workflow_dispatch`
- [ ] Job Summary contains a markdown table with pass/fail emoji and collapsible raw responses
- [ ] JSONL file is auto-committed on main branch runs
- [ ] At least 8/10 cases pass on first run (validates case design, not just infrastructure)

### Guardrails (Must NOT)
- Must NOT modify any existing eval infrastructure (`src/features/evals/*`, `script/eval.ts`, `.github/workflows/evals.yml`)
- Must NOT introduce new npm dependencies — use only `fetch`, Bun built-ins, and existing project imports
- Must NOT store or log the `GITHUB_TOKEN` value
- Must NOT use `--force` or destructive git operations in the auto-commit step
- Must NOT exceed GitHub Models rate limits (sequential calls with delay)

---

## Eval Cases

### Case Design Principles
1. **Check lowercase agent names** — Loom's prompt uses lowercase (`thread`, `pattern`, `warp`, etc.)
2. **`forbiddenContains` is conservative** — only forbid patterns that are clearly wrong (don't forbid agents that might reasonably be mentioned alongside the correct one)
3. **Ambiguous cases test consistency, not a single right answer** — they check that _at least one_ correct agent is mentioned
4. **Case-insensitive matching is NOT needed** — the model will echo the lowercase names from the prompt

### Case 1: Thread Delegation — Codebase Exploration
```
id: "route-to-thread-exploration"
input: "Find all authentication-related files in the codebase and summarize their responsibilities."
expectedContains: ["thread"]
forbiddenContains: ["implement directly", "I'll handle this myself"]
notes: "Clear exploration ask. Thread is explicitly described as 'fast codebase exploration (read-only, cheap)' in the prompt. This should be unambiguous."
```

### Case 2: Spindle Delegation — External Research
```
id: "route-to-spindle-research"
input: "Research how the Stripe API handles idempotency keys and summarize the best practices from their docs."
expectedContains: ["spindle"]
forbiddenContains: ["implement directly", "I'll handle this myself"]
notes: "Pure external research task. Spindle is described as 'external docs and research (read-only)'. No codebase interaction needed."
```

### Case 3: Pattern Delegation — Complex Feature Planning
```
id: "route-to-pattern-planning"
input: "I need to add a webhook system with event types, delivery tracking, retry logic, and a management UI. Plan this out before we start."
expectedContains: ["pattern"]
forbiddenContains: ["I will implement this directly"]
notes: "Multi-file, multi-concern feature that clearly needs a plan. The prompt says 'Use pattern for detailed planning before complex implementations'. The user even says 'plan this out'."
```

### Case 4: Warp Delegation — Security-Sensitive Changes
```
id: "route-to-warp-security"
input: "Review the changes to our JWT token validation and OAuth callback handler before we ship."
expectedContains: ["warp"]
forbiddenContains: ["skip security review", "no security review needed"]
notes: "The prompt makes Warp MANDATORY for 'auth, crypto, certificates, tokens, signatures, input validation, secrets, passwords, sessions, CORS, CSP, .env files, or OAuth/OIDC/SAML flows'. JWT + OAuth is a direct hit."
```

### Case 5: Weft Delegation — Code Review (Non-Security)
```
id: "route-to-weft-review"
input: "I just refactored the logging module across 5 files. Can you review the changes for quality and consistency?"
expectedContains: ["weft"]
forbiddenContains: ["I'll handle this myself"]
notes: "Non-security code review of non-trivial changes (5 files). The prompt says 'Delegate to Weft after non-trivial changes (3+ files, or when quality matters)'. Warp should NOT be required since logging isn't security-sensitive."
```

### Case 6: Shuttle Delegation — Specialized Domain Work
```
id: "route-to-shuttle-specialist"
input: "I need a domain specialist to handle the GraphQL schema generation for our product catalog — types, resolvers, and input validation schemas. This is category-specific specialized work."
expectedContains: ["shuttle"]
forbiddenContains: ["I will implement this directly"]
notes: "Category-specific specialized work with explicit domain-specialist framing. The prompt says 'Use shuttle for category-specific specialized work'. The input mirrors this language directly to reduce ambiguity."
```

### Case 7: Self-Handle — Simple Factual Question
```
id: "self-handle-simple-question"
input: "What's the difference between a Promise and an Observable in JavaScript?"
expectedContains: []
forbiddenContains: ["thread", "pattern", "spindle", "warp", "weft", "shuttle", "delegate", "Task"]
notes: "A quick factual question Loom can answer directly. The prompt says 'Simple tasks (quick answers, single-file fixes, small edits) — do them yourself'. No agent delegation should occur. We check that NO agent name appears in the response."
```

### Case 8: Self-Handle — Single-File Quick Fix
```
id: "self-handle-single-file-fix"
input: "There's a typo in src/utils/format.ts on line 42 — it says 'formated' instead of 'formatted'. Fix it."
expectedContains: []
forbiddenContains: ["pattern", "spindle", "warp", "weft", "shuttle", "delegate to"]
notes: "Single-file, single-line fix. Loom should handle this directly. The prompt explicitly says to skip the plan workflow for 'quick fixes, single-file changes'. Note: we don't forbid 'thread' because Loom might reasonably say it'll check the file first, though ideally it just does it."
```

### Case 9: Ambiguous — Exploration + Security Overlap
```
id: "ambiguous-exploration-security"
input: "Scan the authentication module for potential security vulnerabilities and summarize what you find."
expectedContains: []
forbiddenContains: ["I'll handle this myself", "implement directly"]
notes: "Gray zone: could be Thread (exploration/scanning) or Warp (security analysis) or both. We don't mandate a specific agent — we just verify that delegation happens (not self-handling). The model might mention thread, warp, or both."
```

### Case 10: Ambiguous — Research + Planning Overlap
```
id: "ambiguous-research-planning"
input: "Research how other projects implement OAuth2 PKCE flow, then create a plan for adding it to our app."
expectedContains: []
forbiddenContains: ["I'll handle this myself", "implement directly"]
notes: "Two-phase task: research (Spindle) then planning (Pattern). A good response mentions both agents. We verify delegation happens without mandating the exact combination, since the model might propose different valid orderings."
```

---

## TODOs

- [x] 1. **Create `evals/results/.gitkeep`**
  **What**: Create the results directory with a `.gitkeep` file so it exists in the repo for JSONL output.
  **Files**: `evals/results/.gitkeep` (create, empty file)
  **Acceptance**: `ls evals/results/.gitkeep` succeeds

- [x] 2. **Build the standalone eval script**
  **What**: Create `script/eval-spike-github-models.ts` — a single self-contained TypeScript file that does everything.
  **Files**: `script/eval-spike-github-models.ts` (create)
  **Acceptance**: `bun run script/eval-spike-github-models.ts --help` prints usage; `GITHUB_TOKEN=test bun run script/eval-spike-github-models.ts --dry-run` shows cases without calling the API

  The script structure (in order of implementation within the file):

  ### 2a. Types and constants
  ```
  interface EvalCase {
    id: string
    input: string
    expectedContains: string[]
    forbiddenContains: string[]
    notes: string
  }

  interface CaseResult {
    caseId: string
    passed: boolean
    score: number         // 0.0–1.0
    checks: CheckResult[]
    modelResponse: string
    durationMs: number
    error?: string
  }

  interface CheckResult {
    kind: "expected" | "forbidden"
    pattern: string
    passed: boolean
    message: string
  }

  interface RunSummary {
    timestamp: string
    env: "local" | "ci"
    model: string
    totalCases: number
    passedCases: number
    failedCases: number
    score: number          // 0.0–1.0 aggregate
    durationMs: number
    results: CaseResult[]
  }

  const DEFAULT_MODEL = "gpt-4o-mini"
  const API_URL = "https://models.inference.ai.azure.com/chat/completions"
  const RESULTS_PATH = "evals/results/github-models-spike.jsonl"
  const DELAY_BETWEEN_CALLS_MS = 1000
  ```

  ### 2b. Inline eval cases
  Define all 10 cases from the Eval Cases section above as a `const EVAL_CASES: EvalCase[]` array.

  ### 2c. Prompt rendering
  ```typescript
  import { resolveBuiltinAgentTarget } from "../src/features/evals/targets/builtin-agent-target"

  function renderLoomPrompt(): string {
    const resolved = resolveBuiltinAgentTarget({
      kind: "builtin-agent-prompt",
      agent: "loom",
    })
    return resolved.artifacts.renderedPrompt!
  }
  ```
  This reuses the existing prompt infrastructure exactly.

  ### 2d. GitHub Models API caller
  ```typescript
  async function callGitHubModels(
    systemPrompt: string,
    userMessage: string,
    model: string,
    token: string,
  ): Promise<{ content: string; durationMs: number }> {
    const start = Date.now()
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0,
        max_tokens: 1024,
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`GitHub Models API error ${response.status}: ${body}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content ?? ""
    return { content, durationMs: Date.now() - start }
  }
  ```

  Key decisions:
  - `temperature: 0` for maximum determinism
  - `max_tokens: 1024` — routing decisions don't need long responses, saves quota
  - Simple error handling with full error body for debugging

  ### 2e. Grading function
  ```typescript
  function gradeResponse(evalCase: EvalCase, modelResponse: string): { passed: boolean; score: number; checks: CheckResult[] } {
    const checks: CheckResult[] = []
    const lowerResponse = modelResponse.toLowerCase()

    for (const pattern of evalCase.expectedContains) {
      const found = lowerResponse.includes(pattern.toLowerCase())
      checks.push({
        kind: "expected",
        pattern,
        passed: found,
        message: found
          ? `PASS: response contains '${pattern}'`
          : `FAIL: response missing '${pattern}'`,
      })
    }

    for (const pattern of evalCase.forbiddenContains) {
      const found = lowerResponse.includes(pattern.toLowerCase())
      checks.push({
        kind: "forbidden",
        pattern,
        passed: !found,
        message: !found
          ? `PASS: response excludes '${pattern}'`
          : `FAIL: response contains forbidden '${pattern}'`,
      })
    }

    // A case with no checks passes if the model produced any output
    if (checks.length === 0) {
      const hasOutput = modelResponse.trim().length > 0
      checks.push({
        kind: "expected",
        pattern: "<non-empty-output>",
        passed: hasOutput,
        message: hasOutput ? "PASS: model produced output" : "FAIL: empty model output",
      })
    }

    const passedChecks = checks.filter((c) => c.passed).length
    const score = checks.length > 0 ? passedChecks / checks.length : 0
    const passed = checks.every((c) => c.passed)

    return { passed, score, checks }
  }
  ```

  **Important design note**: Use case-insensitive matching (`toLowerCase()`) for robustness. The model might capitalize agent names differently than the prompt. This differs from the existing `llm-judge.ts` which uses exact `string.includes()`, but for a spike hitting a real LLM, case-insensitive is more practical.

  ### 2f. Console output formatting
  Use `picocolors` (already a project dependency) for colored console output:
  ```
  ── GitHub Models Eval Spike ──────────────────────────
  Model: gpt-4o-mini | Env: local | Cases: 10

  ✅ route-to-thread-exploration          1.00  (2/2 checks)
  ✅ route-to-spindle-research            1.00  (2/2 checks)
  ❌ route-to-pattern-planning            0.50  (1/2 checks)
     FAIL: response missing 'pattern'
  ...

  ── Summary ─────────────────────────────────────────
  Passed: 8/10 (80.0%) | Score: 0.90 | Duration: 14.2s
  Results appended to: evals/results/github-models-spike.jsonl
  ```

  For failed cases, print the failing check messages indented below the case line.

  ### 2g. GitHub Actions Job Summary output
  When `process.env.GITHUB_STEP_SUMMARY` is set, append markdown to that file:

  ```markdown
  ## 🧪 GitHub Models Eval Spike

  **Model**: `gpt-4o-mini` | **Score**: 8/10 (80.0%) | **Duration**: 14.2s

  | Case | Result | Score | Checks |
  |------|--------|-------|--------|
  | route-to-thread-exploration | ✅ Pass | 1.00 | 2/2 |
  | route-to-pattern-planning | ❌ Fail | 0.50 | 1/2 |
  | ... | ... | ... | ... |

  <details>
  <summary>📋 Case Details</summary>

  ### route-to-thread-exploration ✅
  **Input**: Find all authentication-related files...
  **Checks**: ✅ contains 'thread' | ✅ excludes 'implement directly'
  <details>
  <summary>Raw Response</summary>

  ```
  [model response text]
  ```
  </details>

  ### route-to-pattern-planning ❌
  **Input**: I need to add a webhook system...
  **Checks**: ❌ contains 'pattern' | ✅ excludes 'I will implement this directly'
  <details>
  <summary>Raw Response</summary>

  ```
  [model response text]
  ```
  </details>

  </details>
  ```

  Use `fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown)`.

  ### 2h. JSONL output
  After all cases run, append a single line to the JSONL file:
  ```json
  {"timestamp":"2026-03-28T12:00:00.000Z","env":"local","model":"gpt-4o-mini","totalCases":10,"passedCases":8,"failedCases":2,"score":0.9,"durationMs":14200,"results":[...per-case results...]}
  ```

  Create the directory with `mkdirSync(dirname(RESULTS_PATH), { recursive: true })` before writing.

  ### 2i. CLI argument parsing
  Minimal arg parsing (no deps):
  - `--model <name>` — override the default model (default: `gpt-4o-mini`)
  - `--dry-run` — print cases and rendered prompt length, don't call API
  - `--help` — print usage
  - `--case <id>` — run only a specific case (can repeat)

  ### 2j. Main function
  ```typescript
  async function main() {
    const args = parseArgs(process.argv.slice(2))

    if (args.help) { printUsage(); return }

    const token = process.env.GITHUB_TOKEN
    if (!token && !args.dryRun) {
      console.error("Error: GITHUB_TOKEN environment variable is required")
      process.exit(1)
    }

    const model = args.model ?? DEFAULT_MODEL
    const env = process.env.CI ? "ci" : "local"
    const systemPrompt = renderLoomPrompt()
    const casesToRun = args.caseIds
      ? EVAL_CASES.filter(c => args.caseIds!.includes(c.id))
      : EVAL_CASES

    if (args.dryRun) {
      console.log(`Dry run: ${casesToRun.length} cases, prompt length: ${systemPrompt.length}`)
      for (const c of casesToRun) {
        console.log(`  - ${c.id}: "${c.input.slice(0, 80)}..."`)
      }
      return
    }

    // Run cases sequentially with delay
    const results: CaseResult[] = []
    const runStart = Date.now()
    for (let i = 0; i < casesToRun.length; i++) {
      if (i > 0) await sleep(DELAY_BETWEEN_CALLS_MS)
      const evalCase = casesToRun[i]
      try {
        const { content, durationMs } = await callGitHubModels(systemPrompt, evalCase.input, model, token!)
        const grade = gradeResponse(evalCase, content)
        results.push({ caseId: evalCase.id, ...grade, modelResponse: content, durationMs })
      } catch (error) {
        results.push({
          caseId: evalCase.id,
          passed: false,
          score: 0,
          checks: [],
          modelResponse: "",
          durationMs: 0,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    const totalDurationMs = Date.now() - runStart

    // Build summary
    const summary: RunSummary = { ... }

    // Output
    printConsoleResults(summary)
    appendJsonlResult(summary)
    if (process.env.GITHUB_STEP_SUMMARY) {
      writeJobSummary(summary)
    }

    // Exit code
    const failRate = summary.failedCases / summary.totalCases
    process.exit(failRate > 0.5 ? 1 : 0)  // Fail CI only if >50% cases fail (spike tolerance)
  }
  ```

  **Exit code policy**: Exit 1 only if >50% of cases fail. This is a spike — we expect some flakiness. The exact threshold can be tuned later.

- [x] 3. **Create the GitHub Actions workflow**
  **What**: Create `.github/workflows/eval-spike-github-models.yml` — a standalone workflow for running the spike.
  **Files**: `.github/workflows/eval-spike-github-models.yml` (create)
  **Acceptance**: `act -j eval-spike-github-models workflow_dispatch` runs locally (if `act` available), or manual dispatch on GitHub succeeds

  Workflow structure:

  ```yaml
  name: "Eval Spike: GitHub Models"

  on:
    workflow_dispatch:
      inputs:
        model:
          description: "Model to evaluate (default: gpt-4o-mini)"
          required: false
          default: "gpt-4o-mini"
    schedule:
      - cron: "0 9 * * 1"  # Weekly on Monday at 09:00 UTC

  permissions:
    contents: write    # For auto-commit of JSONL results
    models: read       # For GitHub Models API access

  jobs:
    eval-spike:
      name: "GitHub Models Eval"
      runs-on: ubuntu-latest

      steps:
        - uses: actions/checkout@v6

        - uses: oven-sh/setup-bun@v2
          with:
            bun-version: latest

        - name: Install dependencies
          run: bun install --frozen-lockfile

        - name: Run eval spike
          env:
            GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          run: |
            bun run script/eval-spike-github-models.ts \
              --model "${{ inputs.model || 'gpt-4o-mini' }}"

        - name: Commit JSONL results
          if: github.ref == 'refs/heads/main' && always()
          run: |
            git config user.name "github-actions[bot]"
            git config user.email "github-actions[bot]@users.noreply.github.com"
            git add evals/results/github-models-spike.jsonl
            git diff --cached --quiet || git commit -m "chore(evals): update github-models spike results [skip ci]"
            git push

        - name: Upload JSONL artifact
          uses: actions/upload-artifact@v4
          if: always()
          with:
            name: eval-spike-results
            path: evals/results/github-models-spike.jsonl
            if-no-files-found: ignore
  ```

  Key decisions:
  - **`permissions: contents: write`** — needed for auto-commit. `models: read` enables GitHub Models API access.
  - **`secrets.GITHUB_TOKEN`** — built-in, no extra secrets needed. The same token works for both git push and API auth.
  - **`schedule: "0 9 * * 1"`** — Weekly Monday 9AM UTC. Frequent enough to catch prompt regressions, not so frequent it burns quota.
  - **Auto-commit only on main** — branch runs and manual dispatches from non-main don't commit.
  - **`always()` on commit step** — commit results even if the eval had failures (we want to track trends).
  - **`git diff --cached --quiet || git commit`** — only commit if there are actual changes (handles reruns gracefully).

- [x] 4. **Add npm script alias**
  **What**: Add a `eval:spike` script to `package.json` for convenience.
  **Files**: `package.json` (modify)
  **Acceptance**: `bun run eval:spike -- --dry-run` works

  Add to `"scripts"`:
  ```json
  "eval:spike": "bun run script/eval-spike-github-models.ts"
  ```

- [x] 5. **Test locally with dry-run**
  **What**: Verify the script loads, renders the prompt, and prints case info without calling the API.
  **Files**: None (verification only)
  **Acceptance**: `bun run script/eval-spike-github-models.ts --dry-run` prints all 10 cases with their IDs and truncated inputs, shows prompt length, exits 0

- [x] 6. **Test locally with live API**
  **What**: Run the full spike against GitHub Models with a real token.
  **Files**: None (verification only)
  **Acceptance**: `GITHUB_TOKEN=ghp_xxx bun run script/eval-spike-github-models.ts` completes all 10 cases, prints formatted results, creates/appends to `evals/results/github-models-spike.jsonl`

- [x] 7. **Validate CI workflow syntax**
  **What**: Ensure the workflow YAML is valid and the job would run correctly.
  **Files**: None (verification only)
  **Acceptance**: `bun run typecheck` passes (script doesn't break types); workflow YAML is valid (no syntax errors)

---

## Verification

- [ ] `bun run typecheck` passes (script imports resolve correctly)
- [ ] `bun run script/eval-spike-github-models.ts --dry-run` exits 0, prints 10 cases
- [ ] `bun run script/eval-spike-github-models.ts --dry-run --case route-to-thread-exploration` prints only 1 case
- [ ] `GITHUB_TOKEN=<token> bun run script/eval-spike-github-models.ts` completes with >=8/10 passing
- [ ] `evals/results/github-models-spike.jsonl` exists and contains valid JSON lines after a run
- [ ] `GITHUB_STEP_SUMMARY=/tmp/summary.md GITHUB_TOKEN=<token> bun run script/eval-spike-github-models.ts` writes valid markdown to the summary file
- [ ] No existing tests regress: `bun test` passes
- [ ] No existing evals regress: `bun run eval --suite phase1-core` passes

## Potential Pitfalls

| Risk | Mitigation |
|------|------------|
| **GitHub Models rate limiting** | Sequential calls with 1s delay; 10 cases = 10 requests, well within 15/min limit. The script logs a clear error on 429 responses. |
| **Model non-determinism at temperature 0** | Temperature 0 minimizes but doesn't eliminate variation. Cases are designed with broad enough `expectedContains` (single agent name) that minor wording changes don't cause failures. |
| **`GITHUB_TOKEN` scope for Models API** | The built-in `secrets.GITHUB_TOKEN` in GitHub Actions should have Models API access. If not, the workflow will fail with a clear 401/403 — document that a PAT with `models:read` scope may be needed as fallback. |
| **Self-handle cases are fragile** | Cases 7-8 forbid all agent names, which could false-fail if the model mentions agents while explaining _why_ it's not delegating (e.g., "I don't need to use thread for this"). If this happens, relax `forbiddenContains` to only forbid action phrases like "delegate to thread" / "I'll ask thread". |
| **Shuttle case may be weak** | Shuttle's prompt description ("category-specific specialized work") is vague. The model might route DB migrations to Pattern or Tapestry instead. If this case consistently fails, either refine the input to be more clearly shuttle-domain, or accept it as a real signal about prompt clarity. |
| **JSONL auto-commit race conditions** | If two workflow runs overlap on main, git push could fail. The `|| true` isn't added intentionally — a failed push means we lost a result, which is acceptable for a spike. Could add retry logic later if needed. |
| **Windows line endings in JSONL** | The script should use `\n` explicitly (not `os.EOL`) for JSONL output to keep the file consistent across platforms. |
