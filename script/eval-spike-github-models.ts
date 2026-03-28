#!/usr/bin/env bun
/**
 * eval-spike-github-models.ts
 *
 * Standalone eval spike: calls GitHub Models API with Loom's real system prompt
 * and grades routing decisions with deterministic string checks.
 *
 * Usage:
 *   bun run script/eval-spike-github-models.ts [options]
 *
 * Options:
 *   --model <name>   Override model (default: gpt-4o-mini)
 *   --dry-run        Print cases without calling the API
 *   --case <id>      Run only the specified case (repeatable)
 *   --help           Show this message
 */

import { appendFileSync, mkdirSync } from "fs"
import { dirname } from "path"
import pc from "picocolors"
import { resolveBuiltinAgentTarget } from "../src/features/evals/targets/builtin-agent-target"

// ─── Types ────────────────────────────────────────────────────────────────────

interface EvalCase {
  id: string
  input: string
  expectedContains: string[]
  forbiddenContains: string[]
  notes: string
}

interface CheckResult {
  kind: "expected" | "forbidden"
  pattern: string
  passed: boolean
  message: string
}

interface CaseResult {
  caseId: string
  passed: boolean
  score: number
  checks: CheckResult[]
  modelResponse: string
  durationMs: number
  error?: string
}

interface RunSummary {
  timestamp: string
  env: "local" | "ci"
  model: string
  totalCases: number
  passedCases: number
  failedCases: number
  score: number
  durationMs: number
  results: CaseResult[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "gpt-4o-mini"
const API_URL = "https://models.inference.ai.azure.com/chat/completions"
const RESULTS_PATH = "evals/results/github-models-spike.jsonl"
const DELAY_BETWEEN_CALLS_MS = 1000

// ─── Eval Cases ───────────────────────────────────────────────────────────────

const EVAL_CASES: EvalCase[] = [
  {
    id: "route-to-thread-exploration",
    input: "Find all authentication-related files in the codebase and summarize their responsibilities.",
    expectedContains: ["thread"],
    forbiddenContains: ["implement directly", "I'll handle this myself"],
    notes:
      "Clear exploration ask. Thread is explicitly described as 'fast codebase exploration (read-only, cheap)' in the prompt. This should be unambiguous.",
  },
  {
    id: "route-to-spindle-research",
    input: "Research how the Stripe API handles idempotency keys and summarize the best practices from their docs.",
    expectedContains: ["spindle"],
    forbiddenContains: ["implement directly", "I'll handle this myself"],
    notes:
      "Pure external research task. Spindle is described as 'external docs and research (read-only)'. No codebase interaction needed.",
  },
  {
    id: "route-to-pattern-planning",
    input:
      "I need to add a webhook system with event types, delivery tracking, retry logic, and a management UI. Plan this out before we start.",
    expectedContains: ["pattern"],
    forbiddenContains: ["I will implement this directly"],
    notes:
      "Multi-file, multi-concern feature that clearly needs a plan. The prompt says 'Use pattern for detailed planning before complex implementations'. The user even says 'plan this out'.",
  },
  {
    id: "route-to-warp-security",
    input: "Review the changes to our JWT token validation and OAuth callback handler before we ship.",
    expectedContains: ["warp"],
    forbiddenContains: ["skip security review", "no security review needed"],
    notes:
      "The prompt makes Warp MANDATORY for 'auth, crypto, certificates, tokens, signatures, input validation, secrets, passwords, sessions, CORS, CSP, .env files, or OAuth/OIDC/SAML flows'. JWT + OAuth is a direct hit.",
  },
  {
    id: "route-to-weft-review",
    input: "I just refactored the logging module across 5 files. Can you review the changes for quality and consistency?",
    expectedContains: ["weft"],
    forbiddenContains: ["I'll handle this myself"],
    notes:
      "Non-security code review of non-trivial changes (5 files). The prompt says 'Delegate to Weft after non-trivial changes (3+ files, or when quality matters)'. Warp should NOT be required since logging isn't security-sensitive.",
  },
  {
    id: "route-to-shuttle-specialist",
    input:
      "I need a domain specialist to handle the GraphQL schema generation for our product catalog — types, resolvers, and input validation schemas. This is category-specific specialized work.",
    expectedContains: ["shuttle"],
    forbiddenContains: ["I will implement this directly"],
    notes:
      "Category-specific specialized work with explicit domain-specialist framing. The prompt says 'Use shuttle for category-specific specialized work'. The input mirrors this language directly to reduce ambiguity.",
  },
  {
    id: "self-handle-simple-question",
    input: "What's the difference between a Promise and an Observable in JavaScript?",
    expectedContains: [],
    forbiddenContains: ["thread", "pattern", "spindle", "warp", "weft", "shuttle", "delegate", "Task"],
    notes:
      "A quick factual question Loom can answer directly. The prompt says 'Simple tasks (quick answers, single-file fixes, small edits) — do them yourself'. No agent delegation should occur. We check that NO agent name appears in the response.",
  },
  {
    id: "self-handle-single-file-fix",
    input: "There's a typo in src/utils/format.ts on line 42 — it says 'formated' instead of 'formatted'. Fix it.",
    expectedContains: [],
    forbiddenContains: ["pattern", "spindle", "warp", "weft", "shuttle", "delegate to"],
    notes:
      "Single-file, single-line fix. Loom should handle this directly. The prompt explicitly says to skip the plan workflow for 'quick fixes, single-file changes'. Note: we don't forbid 'thread' because Loom might reasonably say it'll check the file first, though ideally it just does it.",
  },
  {
    id: "ambiguous-exploration-security",
    input: "Scan the authentication module for potential security vulnerabilities and summarize what you find.",
    expectedContains: [],
    forbiddenContains: ["I'll handle this myself", "implement directly"],
    notes:
      "Gray zone: could be Thread (exploration/scanning) or Warp (security analysis) or both. We don't mandate a specific agent — we just verify that delegation happens (not self-handling).",
  },
  {
    id: "ambiguous-research-planning",
    input: "Research how other projects implement OAuth2 PKCE flow, then create a plan for adding it to our app.",
    expectedContains: [],
    forbiddenContains: ["I'll handle this myself", "implement directly"],
    notes:
      "Two-phase task: research (Spindle) then planning (Pattern). A good response mentions both agents. We verify delegation happens without mandating the exact combination.",
  },
]

// ─── Prompt Rendering ─────────────────────────────────────────────────────────

function renderLoomPrompt(): string {
  const resolved = resolveBuiltinAgentTarget({
    kind: "builtin-agent-prompt",
    agent: "loom",
  })
  return resolved.artifacts.renderedPrompt ?? ""
}

// ─── GitHub Models API Caller ─────────────────────────────────────────────────

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
      Authorization: `Bearer ${token}`,
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
    const body = (await response.text()).slice(0, 500)
    throw new Error(`GitHub Models API error ${response.status}: ${body}`)
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content ?? ""
  return { content, durationMs: Date.now() - start }
}

// ─── Grading ──────────────────────────────────────────────────────────────────

function gradeResponse(
  evalCase: EvalCase,
  modelResponse: string,
): { passed: boolean; score: number; checks: CheckResult[] } {
  const checks: CheckResult[] = []
  const lowerResponse = modelResponse.toLowerCase()

  for (const pattern of evalCase.expectedContains) {
    const found = lowerResponse.includes(pattern.toLowerCase())
    checks.push({
      kind: "expected",
      pattern,
      passed: found,
      message: found ? `PASS: response contains '${pattern}'` : `FAIL: response missing '${pattern}'`,
    })
  }

  for (const pattern of evalCase.forbiddenContains) {
    const found = lowerResponse.includes(pattern.toLowerCase())
    checks.push({
      kind: "forbidden",
      pattern,
      passed: !found,
      message: !found ? `PASS: response excludes '${pattern}'` : `FAIL: response contains forbidden '${pattern}'`,
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

// ─── Console Output ───────────────────────────────────────────────────────────

function printConsoleResults(summary: RunSummary): void {
  const separator = "─".repeat(55)
  console.log("")
  console.log(pc.bold(`── GitHub Models Eval Spike ${"─".repeat(27)}`))
  console.log(`Model: ${pc.cyan(summary.model)} | Env: ${pc.cyan(summary.env)} | Cases: ${summary.totalCases}`)
  console.log("")

  for (const result of summary.results) {
    const icon = result.passed ? pc.green("✅") : pc.red("❌")
    const scoreStr = result.score.toFixed(2).padStart(4)
    const checksStr = `(${result.checks.filter((c) => c.passed).length}/${result.checks.length} checks)`
    const idStr = result.caseId.padEnd(40)
    console.log(`${icon} ${idStr} ${scoreStr}  ${pc.dim(checksStr)}`)

    if (result.error) {
      console.log(`   ${pc.red("ERROR:")} ${result.error}`)
    } else if (!result.passed) {
      for (const check of result.checks.filter((c) => !c.passed)) {
        console.log(`   ${pc.red(check.message)}`)
      }
    }
  }

  console.log("")
  console.log(pc.bold(`── Summary ${"─".repeat(45)}`))
  const pctStr = ((summary.passedCases / summary.totalCases) * 100).toFixed(1)
  const durationSec = (summary.durationMs / 1000).toFixed(1)
  const scoreColor = summary.passedCases / summary.totalCases >= 0.8 ? pc.green : pc.yellow
  console.log(
    `Passed: ${scoreColor(`${summary.passedCases}/${summary.totalCases}`)} (${pctStr}%) | Score: ${summary.score.toFixed(2)} | Duration: ${durationSec}s`,
  )
  console.log(`Results appended to: ${pc.dim(RESULTS_PATH)}`)
  console.log(separator)
}

// ─── GitHub Actions Job Summary ───────────────────────────────────────────────

function writeJobSummary(summary: RunSummary): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (!summaryPath) return

  const pctStr = ((summary.passedCases / summary.totalCases) * 100).toFixed(1)
  const durationSec = (summary.durationMs / 1000).toFixed(1)

  let md = `## 🧪 GitHub Models Eval Spike\n\n`
  md += `**Model**: \`${summary.model}\` | **Score**: ${summary.passedCases}/${summary.totalCases} (${pctStr}%) | **Duration**: ${durationSec}s\n\n`

  md += `| Case | Result | Score | Checks |\n`
  md += `|------|--------|-------|--------|\n`
  for (const r of summary.results) {
    const resultIcon = r.passed ? "✅ Pass" : "❌ Fail"
    const passedChecks = r.checks.filter((c) => c.passed).length
    md += `| ${r.caseId} | ${resultIcon} | ${r.score.toFixed(2)} | ${passedChecks}/${r.checks.length} |\n`
  }

  md += `\n<details>\n<summary>📋 Case Details</summary>\n\n`

  for (const r of summary.results) {
    const icon = r.passed ? "✅" : "❌"
    const evalCase = EVAL_CASES.find((c) => c.id === r.caseId)
    md += `### ${r.caseId} ${icon}\n`
    if (evalCase) {
      md += `**Input**: ${evalCase.input}\n\n`
    }
    if (r.error) {
      md += `**Error**: ${r.error}\n\n`
    } else {
      const checkSummary = r.checks
        .map((c) => `${c.passed ? "✅" : "❌"} ${c.kind === "expected" ? "contains" : "excludes"} \`${c.pattern}\``)
        .join(" | ")
      md += `**Checks**: ${checkSummary}\n\n`
      md += `<details>\n<summary>Raw Response</summary>\n\n`
      md += "```\n"
      md += r.modelResponse
      md += "\n```\n"
      md += `</details>\n\n`
    }
  }

  md += `</details>\n`

  appendFileSync(summaryPath, md, "utf8")
}

// ─── JSONL Output ─────────────────────────────────────────────────────────────

function appendJsonlResult(summary: RunSummary): void {
  mkdirSync(dirname(RESULTS_PATH), { recursive: true })
  const line = JSON.stringify(summary) + "\n"
  appendFileSync(RESULTS_PATH, line, "utf8")
}

// ─── CLI Arg Parsing ──────────────────────────────────────────────────────────

interface ParsedArgs {
  model?: string
  dryRun: boolean
  help: boolean
  caseIds?: string[]
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { dryRun: false, help: false }
  const caseIds: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--help" || arg === "-h") {
      args.help = true
    } else if (arg === "--dry-run") {
      args.dryRun = true
    } else if (arg === "--model" && argv[i + 1]) {
      args.model = argv[++i]
    } else if (arg === "--case" && argv[i + 1]) {
      caseIds.push(argv[++i])
    }
  }

  if (caseIds.length > 0) {
    args.caseIds = caseIds
  }

  return args
}

function printUsage(): void {
  console.log(`
Usage: bun run script/eval-spike-github-models.ts [options]

Options:
  --model <name>   Model to use (default: ${DEFAULT_MODEL})
  --dry-run        Print cases without calling the API
  --case <id>      Run only this case (can repeat for multiple)
  --help           Show this help message

Environment:
  GITHUB_TOKEN     Required (unless --dry-run). PAT with models:read scope or
                   the built-in secrets.GITHUB_TOKEN in GitHub Actions.

Examples:
  bun run script/eval-spike-github-models.ts --dry-run
  bun run script/eval-spike-github-models.ts --case route-to-thread-exploration
  GITHUB_TOKEN=ghp_xxx bun run script/eval-spike-github-models.ts
  GITHUB_TOKEN=ghp_xxx bun run script/eval-spike-github-models.ts --model gpt-4o
`)
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printUsage()
    return
  }

  const token = process.env.GITHUB_TOKEN
  if (!token && !args.dryRun) {
    console.error(pc.red("Error: GITHUB_TOKEN environment variable is required"))
    console.error("Run with --dry-run to test without a token, or set GITHUB_TOKEN.")
    process.exit(1)
  }

  const model = args.model ?? DEFAULT_MODEL
  const env: "local" | "ci" = process.env.CI ? "ci" : "local"
  const systemPrompt = renderLoomPrompt()

  const casesToRun = args.caseIds ? EVAL_CASES.filter((c) => args.caseIds!.includes(c.id)) : EVAL_CASES

  if (args.caseIds && casesToRun.length === 0) {
    console.error(pc.red(`Error: No cases matched the given --case ids: ${args.caseIds.join(", ")}`))
    console.error(`Available case IDs: ${EVAL_CASES.map((c) => c.id).join(", ")}`)
    process.exit(1)
  }

  if (args.dryRun) {
    console.log(pc.bold("── Dry Run ──────────────────────────────────────────"))
    console.log(`Model: ${model} | Cases: ${casesToRun.length} | Prompt length: ${systemPrompt.length} chars`)
    console.log("")
    for (const c of casesToRun) {
      const preview = c.input.length > 80 ? c.input.slice(0, 80) + "…" : c.input
      console.log(`  ${pc.cyan(c.id)}`)
      console.log(`    "${preview}"`)
      if (c.expectedContains.length > 0) {
        console.log(`    expects: [${c.expectedContains.join(", ")}]`)
      }
      if (c.forbiddenContains.length > 0) {
        console.log(`    forbids: [${c.forbiddenContains.slice(0, 3).join(", ")}${c.forbiddenContains.length > 3 ? "…" : ""}]`)
      }
      console.log("")
    }
    return
  }

  console.log(pc.bold("── GitHub Models Eval Spike ─────────────────────────"))
  console.log(`Model: ${pc.cyan(model)} | Env: ${pc.cyan(env)} | Cases: ${casesToRun.length}`)
  console.log("")

  const results: CaseResult[] = []
  const runStart = Date.now()

  for (let i = 0; i < casesToRun.length; i++) {
    if (i > 0) await sleep(DELAY_BETWEEN_CALLS_MS)

    const evalCase = casesToRun[i]
    process.stdout.write(`  Running ${pc.dim(evalCase.id)}… `)

    try {
      const { content, durationMs } = await callGitHubModels(systemPrompt, evalCase.input, model, token!)
      const grade = gradeResponse(evalCase, content)
      results.push({
        caseId: evalCase.id,
        passed: grade.passed,
        score: grade.score,
        checks: grade.checks,
        modelResponse: content,
        durationMs,
      })
      console.log(grade.passed ? pc.green("✅") : pc.red("❌"))
    } catch (error) {
      console.log(pc.red("💥 error"))
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
  const passedCases = results.filter((r) => r.passed).length
  const failedCases = results.length - passedCases
  const aggregateScore =
    results.length > 0 ? results.reduce((sum, r) => sum + r.score, 0) / results.length : 0

  const summary: RunSummary = {
    timestamp: new Date().toISOString(),
    env,
    model,
    totalCases: results.length,
    passedCases,
    failedCases,
    score: aggregateScore,
    durationMs: totalDurationMs,
    results,
  }

  console.log("")
  printConsoleResults(summary)
  appendJsonlResult(summary)

  if (process.env.GITHUB_STEP_SUMMARY) {
    writeJobSummary(summary)
  }

  // Exit code: fail CI only if >50% of cases fail (spike tolerance)
  const failRate = failedCases / summary.totalCases
  if (failRate > 0.5) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(pc.red("Fatal error:"), err)
  process.exit(1)
})
