# Weave Evals

Weave uses a repo-native eval harness for prompt contracts, live routing checks, mock-backed trajectory coverage, and targeted behavior experiments.

## Current Coverage

- Deterministic prompt-contract suites: `prompt-contracts`, `prompt-smoke`
- Live provider-backed routing suites: `agent-routing-identity`, `agent-routing-intent`, `tapestry-review-routing`
- Mock-backed trajectory suites: `agent-trajectory`, `tapestry-review-trajectory`
- Targeted behavior experiments: `tapestry-execution-contracts`
- Built-in prompt coverage currently includes Loom, Tapestry, Pattern, Thread, Spindle, Weft, Warp, and Shuttle
- Machine-readable run artifacts are written under `.weave/evals/`

Keep deterministic eval smoke and runtime/session smoke separate:

- Eval smoke in this folder validates prompt and orchestration intent quickly
- Fleet/runtime smoke remains tracked separately in `.weave/plans/workflow-smoke-tests.md`

## Layout

- `evals/suites/*.jsonc` - suite manifests
- `evals/cases/**/*.jsonc` - committed eval cases
- `evals/scenarios/*.jsonc` - mock-backed trajectory scenarios
- `evals/rubrics/*.md` - judge rubrics
- `evals/results/*.jsonl` - committed behavioral history
- `.weave/evals/runs/*.json` - local run artifacts
- `.weave/evals/latest.json` - latest local run convenience copy

Suite manifests can optionally annotate published runs with family metadata in `suiteMetadata`:

- `familyId` and `familyTitle` identify the family section that owns the suite
- `viewId` and `viewTitle` identify the family-local page or tab that consumes the feed
- all family fields remain optional so older JSONL rows continue to validate unchanged

## Suite Roles

### Deterministic prompt contracts

- `prompt-contracts` - full deterministic prompt-contract suite
- `prompt-smoke` - tiny deterministic smoke subset for fast PR feedback

Current `prompt-smoke` composition:

- `loom-default-contract`
- `tapestry-default-contract`
- `thread-read-only-contract`
- `warp-security-audit-contract`
- `shuttle-default-contract`

### Live routing

- `agent-routing-identity` - strict Loom routing identity checks
- `agent-routing-intent` - looser Loom routing intent checks
- `tapestry-review-routing` - Tapestry routes completed work into post-execution review

### Trajectory / multi-turn behavior

- `agent-trajectory` - Loom multi-turn delegation chains
- `tapestry-review-trajectory` - Tapestry post-execution review chain replay

### Targeted execution-contract experiments

- `tapestry-execution-contracts` - live Tapestry behavior probes for continuation, interruption, blocked-stop, and review-boundary scenarios

This experimental suite is intentionally separate from Loom routing so it can be run against different provider/model combinations without disturbing the main Loom routing signal.

### Legacy compatibility artifacts

- `agent-routing` remains in the repo as a legacy compatibility manifest
- `evals/results/agent-routing.jsonl` remains readable during the family-first rollout
- new website routes read the split family feeds directly instead of depending on the legacy aggregate path

## Running Evals

### Deterministic suites

```bash
bun run eval --suite prompt-contracts

# Fast deterministic smoke suite
bun run eval:smoke
```

Useful filters:

```bash
bun run eval --suite prompt-contracts --agent loom
bun run eval --suite prompt-contracts --case loom-default-contract
bun run eval --suite prompt-contracts --tag composer --json
bun run eval --suite prompt-contracts --output /tmp/weave-evals.json

# Compare against baseline (defaults to evals/baselines/{suite}.json when present)
bun run eval --suite prompt-contracts --baseline evals/baselines/prompt-contracts.json
bun run eval --suite prompt-smoke --baseline evals/baselines/prompt-smoke.json

# Fail command when baseline comparison reports regression
bun run eval --suite prompt-contracts --baseline evals/baselines/prompt-contracts.json --fail-on-regression

# Refresh deterministic baselines intentionally
bun run eval --suite prompt-contracts --update-baseline
bun run eval --suite prompt-smoke --update-baseline
```

### Live routing and targeted behavior

```bash
# Loom routing identity
OPENROUTER_API_KEY=or_xxx bun run eval --suite agent-routing-identity --provider openrouter --model openai/gpt-4o-mini

# Loom routing intent
OPENROUTER_API_KEY=or_xxx bun run eval --suite agent-routing-intent --provider openrouter --model openai/gpt-4o-mini

# Tapestry review routing
OPENROUTER_API_KEY=or_xxx bun run eval --suite tapestry-review-routing --provider openrouter --model openai/gpt-4o-mini

# Tapestry execution-contract experiments (run separately for provider comparison)
OPENROUTER_API_KEY=or_xxx bun run eval --suite tapestry-execution-contracts --provider openrouter --model openai/gpt-5.4
OPENROUTER_API_KEY=or_xxx bun run eval --suite tapestry-execution-contracts --provider openrouter --model anthropic/claude-sonnet-4.6
```

### Mock-backed trajectory suites

```bash
bun run eval --suite agent-trajectory
bun run eval --suite agent-trajectory --case trajectory-loom-delegates-to-pattern
bun run eval --suite tapestry-review-trajectory
```

Filter precedence and behavior:

- `--suite` selects the manifest; defaults to `prompt-contracts`
- `--case` narrows within the selected suite
- `--agent` and `--tag` are intersecting filters
- `--provider` and `--model` override case defaults for the run
- `--output` overrides the primary artifact path
- `--json` changes stdout formatting only; artifacts are still written

Exit codes:

- `0` all selected cases passed
- `1` one or more selected cases failed
- `2` usage or selector error
- `3` schema/load/config error
- `4` unexpected internal runner error

## Writing Cases

Use the least brittle evaluator that proves the contract:

- structural prompt checks first (`xml-sections-present`, `ordered-contains`, `tool-policy`)
- `llm-judge` for live single-turn routing or behavior intent
- `trajectory-assertion` for multi-turn delegation order

Trajectory suites are currently mock-backed replays. Delegation evidence inside a trajectory trace is derived from canned response text, not from runtime tool telemetry; use integration tests for proof of actual task-tool delegation.

Prefer stable contract anchors over brittle paragraph equality. If a future prompt needs an eval-only boundary, use:

```html
<!-- weave-eval:anchor-name -->
```

Only use exact phrase checks when wording itself is normative.

### Trajectory scenario format

Scenarios live in `evals/scenarios/` as `.jsonc` files. Each scenario defines a multi-turn conversation:

```jsonc
{
  "id": "scenario-id",
  "title": "Human-readable title",
  "description": "What this scenario tests",
  "agents": ["loom", "pattern"],
  "turns": [
    { "turn": 1, "role": "user", "content": "User message" },
    {
      "turn": 2,
      "role": "assistant",
      "agent": "loom",
      "content": "Description",
      "mockResponse": "Canned response for mock mode",
      "expectedDelegation": "pattern"
    }
  ]
}
```

Trajectory assertions currently support:

| Assertion | What it checks |
|-----------|---------------|
| `expectedSequence` | Observed delegation sequence matches exactly |
| `requiredAgents` | Each listed agent appears at least once |
| `forbiddenAgents` | Listed agents never appear |
| `minTurns` | Completed turn count is at or above threshold |
| `maxTurns` | Completed turn count is at or below threshold |

`expectedDelegation` in scenario fixtures is a mock expectation anchor only. It helps document the intended delegation step for a canned turn, but runtime delegation proof still lives in integration tests rather than in the deterministic trajectory harness.

## Coverage

Coverage threshold for `src/features/evals/**` remains 85% for lines and functions, excluding fixtures.

```bash
bun run eval:coverage
```

## CI Strategy

- `ci.yml` runs `prompt-smoke` for fast blocking feedback
- `evals.yml` runs `prompt-contracts` and `prompt-smoke` with baseline comparison and coverage checks
- `evals.yml` also runs a non-blocking behavioral matrix over:
  - `agent-routing-identity`
  - `agent-routing-intent`
  - `agent-trajectory`
  - `tapestry-review-trajectory`
- The live behavioral matrix currently standardizes on `openrouter` in CI
- `tapestry-execution-contracts` runs in its own non-blocking CI lane with a dedicated model set (`openai/gpt-5.4`, `anthropic/claude-sonnet-4.6`)
- the fan-in job also preserves `evals/results/agent-routing.jsonl` as a legacy compatibility feed backed by the split Loom identity stream
- Targeted suites such as `tapestry-review-routing` and `tapestry-execution-contracts` stay isolated so they can use different model sets without changing Loom routing coverage

Behavioral evals run on schedule, `workflow_dispatch`, and on PR/push when eval-, prompt-, or workflow-related files change.

## Guardrails

- Supported live providers today: `github-models` and `openrouter`
- `openrouter` requires `OPENROUTER_API_KEY`
- Never store provider secrets in case files, suite files, committed baselines, or artifacts
- Artifacts must not include auth headers, API keys, bearer tokens, or raw provider secret values
- Treat provider-backed behavior suites as non-blocking until they prove stable enough to gate on trends or regressions

## Future Direction

- Extend behavioral suites with stronger task/todo/tool assertions when continuation-state coverage becomes important
- Keep provider-comparison suites isolated from baseline deterministic prompt contracts
- If Promptfoo is adopted later, keep it behind executor/judge adapters rather than making it the schema owner
