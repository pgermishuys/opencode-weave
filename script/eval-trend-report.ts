#!/usr/bin/env bun
/**
 * eval-trend-report.ts
 *
 * Reads eval JSONL files (either main framework `EvalRunResult` or legacy
 * spike `RunSummary` format) and produces trend analysis — score trajectories,
 * flaky case detection, regression alerts — with console output and GitHub
 * Actions Job Summary integration.
 *
 * Usage:
 *   bun run script/eval-trend-report.ts [options]
 *
 * Options:
 *   --suite <name>      Suite name — resolves to evals/results/{name}.jsonl
 *   --file <path>       Explicit JSONL file path (overrides --suite)
 *   --last <n>          Only analyze the last N runs (default: all)
 *   --check             Enable regression checking (exit 1 on regression)
 *   --threshold <n>     Minimum acceptable score (default: 0.80)
 *   --json              Output raw trend data as JSON
 *   --help              Show this help message
 */

import { readFileSync, appendFileSync } from "fs"
import pc from "picocolors"

// ─── Types ────────────────────────────────────────────────────────────────────

// Legacy spike format (from the retired eval spike script)
interface SpikeCheckResult {
  kind: "expected" | "forbidden"
  pattern: string
  passed: boolean
  message: string
}

interface SpikeCaseResult {
  caseId: string
  passed: boolean
  score: number
  checks: SpikeCheckResult[]
  modelResponse: string
  durationMs: number
  error?: string
}

interface SpikeRunSummary {
  timestamp: string
  env: "local" | "ci"
  model: string
  totalCases: number
  passedCases: number
  failedCases: number
  score: number
  durationMs: number
  results: SpikeCaseResult[]
}

// Normalized internal type used for all trend analysis
interface TrendCaseResult {
  caseId: string
  passed: boolean
  score: number
}

interface TrendRun {
  timestamp: string
  model: string
  totalCases: number
  passedCases: number
  failedCases: number
  score: number
  durationMs: number
  caseResults: TrendCaseResult[]
}

interface CaseHistory {
  caseId: string
  appearances: number
  passes: number
  failures: number
  passRate: number
  isFlaky: boolean
  lastResult: "pass" | "fail"
  trend: ("pass" | "fail")[]
}

interface Regression {
  kind: "score-below-threshold" | "score-decline" | "case-regression" | "new-failure"
  message: string
  caseId?: string
}

interface TrendData {
  runs: TrendRun[]
  latestRun: TrendRun
  previousRun: TrendRun | null
  caseHistory: Map<string, CaseHistory>
}

// ─── JSONL Parser ─────────────────────────────────────────────────────────────

// Main framework EvalRunResult shape (only the fields we need for trend analysis)
interface MainFormatRun {
  runId: string
  startedAt: string
  finishedAt: string
  suiteId: string
  model?: string
  summary: {
    totalCases: number
    passedCases: number
    failedCases: number
    errorCases: number
    normalizedScore: number
  }
  caseResults: Array<{
    caseId: string
    status: "passed" | "failed" | "error"
    normalizedScore: number
  }>
}

function isMainFormat(parsed: Record<string, unknown>): boolean {
  return "suiteId" in parsed && "summary" in parsed && "caseResults" in parsed
}

function isSpikeFormat(parsed: Record<string, unknown>): boolean {
  return "model" in parsed && "score" in parsed && "timestamp" in parsed
}

function normalizeMainRun(run: MainFormatRun): TrendRun {
  const startMs = new Date(run.startedAt).getTime()
  const endMs = new Date(run.finishedAt).getTime()
  return {
    timestamp: run.startedAt,
    model: run.model ?? "unknown",
    totalCases: run.summary.totalCases,
    passedCases: run.summary.passedCases,
    failedCases: run.summary.failedCases + run.summary.errorCases,
    score: run.summary.normalizedScore,
    durationMs: endMs - startMs,
    caseResults: run.caseResults.map((cr) => ({
      caseId: cr.caseId,
      passed: cr.status === "passed",
      score: cr.normalizedScore,
    })),
  }
}

function normalizeSpikeRun(run: SpikeRunSummary): TrendRun {
  return {
    timestamp: run.timestamp,
    model: run.model,
    totalCases: run.totalCases,
    passedCases: run.passedCases,
    failedCases: run.failedCases,
    score: run.score,
    durationMs: run.durationMs,
    caseResults: (run.results ?? []).map((r) => ({
      caseId: r.caseId,
      passed: r.passed,
      score: r.score,
    })),
  }
}

function parseJsonl(filePath: string): TrendRun[] {
  let content: string
  try {
    content = readFileSync(filePath, "utf8")
  } catch {
    console.error(pc.red(`Error: Could not read file: ${filePath}`))
    process.exit(1)
  }

  const lines = content.split("\n").filter((line) => line.trim().length > 0)

  if (lines.length === 0) {
    console.error(pc.yellow("No data found in JSONL file."))
    process.exit(0)
  }

  const runs: TrendRun[] = []

  for (let i = 0; i < lines.length; i++) {
    try {
      const parsed = JSON.parse(lines[i]) as Record<string, unknown>
      if (isMainFormat(parsed)) {
        runs.push(normalizeMainRun(parsed as unknown as MainFormatRun))
      } else if (isSpikeFormat(parsed)) {
        runs.push(normalizeSpikeRun(parsed as unknown as SpikeRunSummary))
      } else {
        console.warn(pc.yellow(`Warning: Skipping unrecognized format on line ${i + 1}`))
      }
    } catch {
      console.warn(pc.yellow(`Warning: Skipping malformed line ${i + 1}`))
    }
  }

  // Sort by timestamp ascending
  runs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

  return runs
}

// ─── Trend Analysis Engine ────────────────────────────────────────────────────

function buildCaseHistory(runs: TrendRun[]): Map<string, CaseHistory> {
  const historyMap = new Map<string, CaseHistory>()

  for (const run of runs) {
    for (const result of run.caseResults) {
      let history = historyMap.get(result.caseId)
      if (!history) {
        history = {
          caseId: result.caseId,
          appearances: 0,
          passes: 0,
          failures: 0,
          passRate: 0,
          isFlaky: false,
          lastResult: result.passed ? "pass" : "fail",
          trend: [],
        }
        historyMap.set(result.caseId, history)
      }

      history.appearances++
      if (result.passed) {
        history.passes++
      } else {
        history.failures++
      }
      history.lastResult = result.passed ? "pass" : "fail"
      history.trend.push(result.passed ? "pass" : "fail")
    }
  }

  // Compute derived fields
  for (const history of historyMap.values()) {
    history.passRate = history.appearances > 0 ? history.passes / history.appearances : 0
    history.isFlaky =
      history.appearances >= 3 && history.passRate > 0 && history.passRate < 1
  }

  return historyMap
}

function analyzeTrend(runs: TrendRun[]): TrendData {
  const caseHistory = buildCaseHistory(runs)

  return {
    runs,
    latestRun: runs[runs.length - 1],
    previousRun: runs.length >= 2 ? runs[runs.length - 2] : null,
    caseHistory,
  }
}

function detectRegressions(data: TrendData, threshold: number): Regression[] {
  const regressions: Regression[] = []
  const { latestRun, runs } = data

  // 1. Score drop below threshold
  if (latestRun.score < threshold) {
    regressions.push({
      kind: "score-below-threshold",
      message: `Latest score ${latestRun.score.toFixed(2)} is below threshold ${threshold.toFixed(2)}`,
    })
  }

  // 2. Score decline vs average of last 3 runs
  if (runs.length >= 2) {
    const recentRuns = runs.slice(-Math.min(4, runs.length), -1) // last 3 (excluding latest)
    if (recentRuns.length > 0) {
      const avgRecent = recentRuns.reduce((sum, r) => sum + r.score, 0) / recentRuns.length
      if (avgRecent - latestRun.score > 0.10) {
        regressions.push({
          kind: "score-decline",
          message: `Latest score ${latestRun.score.toFixed(2)} is more than 0.10 below recent average ${avgRecent.toFixed(2)}`,
        })
      }
    }
  }

  // 3. Case regression: passed in last 3 consecutive runs, now fails
  for (const result of latestRun.caseResults) {
    if (result.passed) continue

    const history = data.caseHistory.get(result.caseId)
    if (!history || history.trend.length < 2) continue

    // Check if it passed in the last 3 consecutive runs before this one
    const beforeLatest = history.trend.slice(0, -1)
    const lastThree = beforeLatest.slice(-3)
    if (lastThree.length >= 3 && lastThree.every((r) => r === "pass")) {
      regressions.push({
        kind: "case-regression",
        caseId: result.caseId,
        message: `${result.caseId}: was passing in last 3 runs, now failing`,
      })
    }
  }

  // 4. New failure: case that has never failed before fails for the first time
  for (const result of latestRun.caseResults) {
    if (result.passed) continue

    const history = data.caseHistory.get(result.caseId)
    if (!history) continue

    // Only 1 failure total (the current one) and appeared more than once
    if (history.failures === 1 && history.appearances >= 2) {
      // Check it's not already flagged as case-regression
      const alreadyFlagged = regressions.some(
        (r) => r.kind === "case-regression" && r.caseId === result.caseId,
      )
      if (!alreadyFlagged) {
        regressions.push({
          kind: "new-failure",
          caseId: result.caseId,
          message: `${result.caseId}: first-ever failure (was passing in ${history.appearances - 1} prior run(s))`,
        })
      }
    }
  }

  return regressions
}

function detectFlakyCases(data: TrendData): CaseHistory[] {
  const flaky: CaseHistory[] = []
  for (const history of data.caseHistory.values()) {
    if (history.isFlaky) {
      flaky.push(history)
    }
  }
  // Sort by pass rate ascending (worst first)
  flaky.sort((a, b) => a.passRate - b.passRate)
  return flaky
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

const SPARKLINE_CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]

function sparkline(values: number[]): string {
  if (values.length === 0) return ""
  // Show last 12 data points
  const display = values.slice(-12)
  return display
    .map((v) => {
      const clamped = Math.max(0, Math.min(1, v))
      const index = Math.round(clamped * 7)
      return SPARKLINE_CHARS[index]
    })
    .join("")
}

// ─── Formatting Helpers ───────────────────────────────────────────────────────

function formatDelta(current: number, previous: number): string {
  const delta = current - previous
  if (Math.abs(delta) < 0.005) return "—"
  const sign = delta > 0 ? "+" : ""
  return `${sign}${delta.toFixed(2)}`
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function formatDate(iso: string): string {
  return iso.slice(0, 10) // YYYY-MM-DD
}

function trendEmoji(results: ("pass" | "fail")[]): string {
  const last6 = results.slice(-6)
  return last6.map((r) => (r === "pass" ? "✅" : "❌")).join("")
}

function caseStatus(
  history: CaseHistory,
  regressions: Regression[],
): { label: string; color: (s: string) => string } {
  const isRegressed = regressions.some(
    (r) => (r.kind === "case-regression" || r.kind === "new-failure") && r.caseId === history.caseId,
  )
  if (isRegressed) return { label: "regressed", color: pc.red }
  if (history.isFlaky) return { label: "flaky", color: pc.yellow }
  if (history.passRate === 1) return { label: "stable", color: pc.green }
  return { label: "unstable", color: pc.yellow }
}

// ─── Console Output Renderer ──────────────────────────────────────────────────

function printConsoleReport(
  data: TrendData,
  regressions: Regression[],
  flakyCases: CaseHistory[],
  jsonlPath: string,
): void {
  const { runs, latestRun, previousRun } = data
  const runCount = runs.length

  console.log("")
  console.log(pc.bold(`── Eval Trend Report ${"─".repeat(35)}`))
  console.log(
    `JSONL: ${pc.dim(jsonlPath)} (${runCount} run${runCount !== 1 ? "s" : ""})`,
  )
  console.log(
    `Model: ${pc.cyan(latestRun.model)} | Period: ${formatDate(runs[0].timestamp)} → ${formatDate(latestRun.timestamp)}`,
  )
  console.log("")

  // ── Score Trend
  console.log(pc.bold(`── Score Trend ${"─".repeat(41)}`))
  const scores = runs.map((r) => r.score)
  const spark = sparkline(scores)
  if (runCount > 1) {
    console.log(
      `  ${spark}  (${scores[0].toFixed(2)} → ${scores[scores.length - 1].toFixed(2)})`,
    )
  } else {
    console.log(`  ${spark}`)
  }

  const latestPassRate = `${latestRun.passedCases}/${latestRun.totalCases} passed`
  if (previousRun) {
    const delta = formatDelta(latestRun.score, previousRun.score)
    console.log(
      `  Latest: ${latestRun.score.toFixed(2)} (${latestPassRate}) | Previous: ${previousRun.score.toFixed(2)} (${delta})`,
    )
  } else {
    console.log(`  Latest: ${latestRun.score.toFixed(2)} (${latestPassRate}) | Previous: N/A`)
  }

  const bestScore = Math.max(...scores)
  const worstScore = Math.min(...scores)
  const bestIdx = scores.indexOf(bestScore) + 1
  const worstIdx = scores.indexOf(worstScore) + 1
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length
  console.log(
    `  Best: ${bestScore.toFixed(2)} (run #${bestIdx}) | Worst: ${worstScore.toFixed(2)} (run #${worstIdx})`,
  )
  console.log(`  Average: ${avgScore.toFixed(2)}`)
  console.log("")

  // ── Duration Trend
  console.log(pc.bold(`── Duration Trend ${"─".repeat(38)}`))
  const durations = runs.map((r) => r.durationMs)
  const maxDuration = Math.max(...durations)
  const durationNormalized = durations.map((d) => (maxDuration > 0 ? d / maxDuration : 0))
  const durationSpark = sparkline(durationNormalized)
  if (runCount > 1) {
    console.log(
      `  ${durationSpark}  (${formatDuration(durations[0])} → ${formatDuration(durations[durations.length - 1])})`,
    )
  } else {
    console.log(`  ${durationSpark}`)
  }
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length
  console.log(
    `  Latest: ${formatDuration(latestRun.durationMs)} | Average: ${formatDuration(avgDuration)}`,
  )
  console.log("")

  // ── Per-Case Stability
  const caseHistories = Array.from(data.caseHistory.values()).sort(
    (a, b) => b.passRate - a.passRate || a.caseId.localeCompare(b.caseId),
  )

  if (caseHistories.length > 0) {
    console.log(pc.bold(`── Per-Case Stability ${"─".repeat(34)}`))
    const headerCase = "Case".padEnd(40)
    const headerRate = "Pass Rate".padEnd(14)
    const headerTrend = "Trend".padEnd(14)
    const headerStatus = "Status"
    console.log(
      `  ${pc.dim(headerCase)} ${pc.dim(headerRate)} ${pc.dim(headerTrend)} ${pc.dim(headerStatus)}`,
    )

    for (const history of caseHistories) {
      const status = caseStatus(history, regressions)
      const rateStr = `${(history.passRate * 100).toFixed(0)}% (${history.passes}/${history.appearances})`
      const trend = trendEmoji(history.trend)
      const statusLabel = status.color(
        status.label === "flaky"
          ? `${status.label} \u26a0\ufe0f`
          : status.label === "regressed"
            ? `\u274c ${status.label}`
            : status.label,
      )
      console.log(
        `  ${history.caseId.padEnd(40)} ${rateStr.padEnd(14)} ${trend.padEnd(14)} ${statusLabel}`,
      )
    }
    console.log("")
  }

  // ── Flaky Cases
  if (flakyCases.length > 0) {
    console.log(pc.bold(`── Flaky Cases ${"─".repeat(41)}`))
    for (const fc of flakyCases) {
      const failedRunIndices: number[] = []
      let runIdx = 0
      for (const run of runs) {
        runIdx++
        const result = run.caseResults.find((r: TrendCaseResult) => r.caseId === fc.caseId)
        if (result && !result.passed) {
          failedRunIndices.push(runIdx)
        }
      }
      console.log(
        pc.yellow(
          `  \u26a0\ufe0f  ${fc.caseId}  (${(fc.passRate * 100).toFixed(0)}% — failed in run${failedRunIndices.length > 1 ? "s" : ""} #${failedRunIndices.join(", #")})`,
        ),
      )
    }
    console.log("")
  }

  // ── Regressions
  if (regressions.length > 0) {
    console.log(pc.bold(`── Regressions ${"─".repeat(41)}`))
    for (const reg of regressions) {
      console.log(pc.red(`  \u274c  ${reg.message}`))
    }
    console.log("")
  } else {
    console.log(pc.green("  No regressions detected."))
    console.log("")
  }
}

// ─── GitHub Actions Job Summary Renderer ──────────────────────────────────────

function writeJobSummary(
  data: TrendData,
  regressions: Regression[],
  flakyCases: CaseHistory[],
): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (!summaryPath) return

  const { runs, latestRun, previousRun } = data
  const runCount = runs.length
  const scores = runs.map((r) => r.score)
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length
  const bestScore = Math.max(...scores)
  const worstScore = Math.min(...scores)
  const durations = runs.map((r) => r.durationMs)
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length

  let md = `\n## 📈 Eval Trend Report\n\n`
  md += `**Runs analyzed**: ${runCount} | **Period**: ${formatDate(runs[0].timestamp)} → ${formatDate(latestRun.timestamp)} | **Model**: ${latestRun.model}\n\n`

  // Score sparkline
  md += `### Score Trend\n`
  const spark = sparkline(scores)
  if (runCount > 1) {
    md += `\`${spark}\` ${scores[0].toFixed(2)} → **${scores[scores.length - 1].toFixed(2)}** (avg: ${avgScore.toFixed(2)})\n\n`
  } else {
    md += `\`${spark}\` **${scores[0].toFixed(2)}** (single run)\n\n`
  }

  // Metrics table
  const latestPct = `${((latestRun.passedCases / latestRun.totalCases) * 100).toFixed(0)}%`
  const prevPct = previousRun
    ? `${((previousRun.passedCases / previousRun.totalCases) * 100).toFixed(0)}%`
    : "N/A"
  const scoreDelta = previousRun ? formatDelta(latestRun.score, previousRun.score) : "N/A"
  const durationDelta = previousRun
    ? formatDelta(latestRun.durationMs / 1000, previousRun.durationMs / 1000).replace(/([+-]?\d+\.\d+)/, "$1s")
    : "N/A"

  md += `| Metric | Latest | Previous | Delta | Best | Worst |\n`
  md += `|--------|--------|----------|-------|------|-------|\n`
  md += `| Score | ${latestRun.score.toFixed(2)} | ${previousRun ? previousRun.score.toFixed(2) : "N/A"} | ${scoreDelta} | ${bestScore.toFixed(2)} | ${worstScore.toFixed(2)} |\n`
  md += `| Pass Rate | ${latestPct} | ${prevPct} | — | — | — |\n`
  md += `| Duration | ${formatDuration(latestRun.durationMs)} | ${previousRun ? formatDuration(previousRun.durationMs) : "N/A"} | ${durationDelta} | ${formatDuration(Math.min(...durations))} | ${formatDuration(Math.max(...durations))} |\n\n`

  // Per-case stability
  const caseHistories = Array.from(data.caseHistory.values()).sort(
    (a, b) => b.passRate - a.passRate || a.caseId.localeCompare(b.caseId),
  )

  if (caseHistories.length > 0) {
    md += `### Per-Case Stability\n\n`
    md += `| Case | Pass Rate | Last 6 | Status |\n`
    md += `|------|-----------|--------|--------|\n`

    for (const history of caseHistories) {
      const status = caseStatus(history, regressions)
      const rateStr = `${(history.passRate * 100).toFixed(0)}% (${history.passes}/${history.appearances})`
      const trend = trendEmoji(history.trend)
      const statusEmoji =
        status.label === "regressed"
          ? "🔴 regressed"
          : status.label === "flaky"
            ? "🟡 flaky"
            : "🟢 stable"
      md += `| ${history.caseId} | ${rateStr} | ${trend} | ${statusEmoji} |\n`
    }
    md += "\n"
  }

  // Alerts
  if (flakyCases.length > 0 || regressions.length > 0) {
    md += `### Alerts\n`
    if (flakyCases.length > 0) {
      const flakyList = flakyCases
        .map((fc) => `\`${fc.caseId}\` (${(fc.passRate * 100).toFixed(0)}%)`)
        .join(", ")
      md += `> ⚠️ **Flaky**: ${flakyList}\n`
    }
    for (const reg of regressions) {
      md += `> 🔴 **Regression**: ${reg.message}\n`
    }
    md += "\n"
  }

  appendFileSync(summaryPath, md, "utf8")
}

// ─── CLI Argument Parsing ─────────────────────────────────────────────────────

const DEFAULT_THRESHOLD = 0.8

interface ParsedArgs {
  file?: string
  suite?: string
  last?: number
  check: boolean
  threshold: number
  json: boolean
  help: boolean
}

function resolveJsonlPath(args: ParsedArgs): string {
  if (args.file) return args.file
  if (args.suite) return `evals/results/${args.suite}.jsonl`
  return ""
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    check: false,
    threshold: DEFAULT_THRESHOLD,
    json: false,
    help: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--help" || arg === "-h") {
      args.help = true
    } else if (arg === "--check") {
      args.check = true
    } else if (arg === "--json") {
      args.json = true
    } else if (arg === "--file" && argv[i + 1]) {
      args.file = argv[++i]
    } else if (arg === "--suite" && argv[i + 1]) {
      args.suite = argv[++i]
    } else if (arg === "--last" && argv[i + 1]) {
      const n = parseInt(argv[++i], 10)
      if (!isNaN(n) && n > 0) {
        args.last = n
      }
    } else if (arg === "--threshold" && argv[i + 1]) {
      const t = parseFloat(argv[++i])
      if (!isNaN(t)) {
        args.threshold = t
      }
    }
  }

  return args
}

function printUsage(): void {
  console.log(`
Usage: bun run script/eval-trend-report.ts [options]

  Either --suite or --file is required.

Options:
  --suite <name>      Suite name — resolves to evals/results/{name}.jsonl
  --file <path>       Explicit JSONL file path (overrides --suite)
  --last <n>          Only analyze the last N runs (default: all)
  --check             Enable regression checking (exit 1 on regression)
  --threshold <n>     Minimum acceptable score (default: ${DEFAULT_THRESHOLD})
  --json              Output raw trend data as JSON
  --help              Show this help message

Examples:
  bun run script/eval-trend-report.ts --suite agent-routing
  bun run script/eval-trend-report.ts --file evals/results/custom.jsonl
  bun run script/eval-trend-report.ts --suite agent-routing --check --threshold 0.80
  bun run script/eval-trend-report.ts --suite agent-routing --last 5 --json
`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printUsage()
    return
  }

  const filePath = resolveJsonlPath(args)
  if (!filePath) {
    console.error(pc.red("Error: Either --suite or --file is required."))
    printUsage()
    process.exit(2)
  }

  // Parse JSONL
  let runs = parseJsonl(filePath)

  // Apply --last filter
  if (args.last !== undefined && args.last < runs.length) {
    runs = runs.slice(-args.last)
  }

  // Analyze
  const data = analyzeTrend(runs)
  const regressions = detectRegressions(data, args.threshold)
  const flakyCases = detectFlakyCases(data)

  // Output
  if (args.json) {
    const jsonOutput = {
      runs: data.runs,
      latestRun: data.latestRun,
      previousRun: data.previousRun,
      caseHistory: Object.fromEntries(data.caseHistory),
      regressions,
      flakyCases,
    }
    console.log(JSON.stringify(jsonOutput, null, 2))
  } else {
    printConsoleReport(data, regressions, flakyCases, filePath)

    // GitHub Actions Job Summary
    if (process.env.GITHUB_STEP_SUMMARY) {
      writeJobSummary(data, regressions, flakyCases)
    }
  }

  // Exit code for --check
  if (args.check && regressions.length > 0) {
    console.log(pc.red(`\nRegression check failed: ${regressions.length} regression(s) detected.`))
    process.exit(1)
  }
}

main()
