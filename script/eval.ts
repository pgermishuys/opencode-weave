#!/usr/bin/env bun

import {
  compareDeterministicBaseline,
  deriveDeterministicBaseline,
  runEvalSuite,
  EvalConfigError,
  loadEvalCasesForSuite,
  loadEvalSuiteManifest,
  readDeterministicBaseline,
} from "../src/features/evals"
import type { LoadedEvalCase } from "../src/features/evals"
import { existsSync, mkdirSync, writeFileSync } from "fs"
import { dirname, join } from "path"

interface CliOptions {
  suite: string
  caseIds?: string[]
  agents?: string[]
  tags?: string[]
  json: boolean
  outputPath?: string
  baselinePath?: string
  updateBaseline: boolean
  failOnRegression: boolean
}

function printUsage(): void {
  console.error(
    "Usage: bun run eval [--suite prompt-contracts] [--case id] [--agent loom] [--tag contract] [--json] [--output path] [--baseline path] [--update-baseline] [--fail-on-regression]",
  )
}

function getDefaultBaselinePath(directory: string, suite: string): string {
  return join(directory, "evals", "baselines", `${suite}.json`)
}

function writeBaseline(path: string, baseline: ReturnType<typeof deriveDeterministicBaseline>): void {
  const dir = dirname(path)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  writeFileSync(path, JSON.stringify(baseline, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 })
}

function parseMultiValue(value: string | undefined, flag: string): string {
  if (!value) {
    throw new Error(`Missing value for ${flag}`)
  }
  return value
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    suite: "prompt-contracts",
    json: false,
    updateBaseline: false,
    failOnRegression: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--suite":
        options.suite = parseMultiValue(argv[++index], "--suite")
        break
      case "--case":
        options.caseIds = [...(options.caseIds ?? []), parseMultiValue(argv[++index], "--case")]
        break
      case "--agent":
        options.agents = [...(options.agents ?? []), parseMultiValue(argv[++index], "--agent")]
        break
      case "--tag":
        options.tags = [...(options.tags ?? []), parseMultiValue(argv[++index], "--tag")]
        break
      case "--json":
        options.json = true
        break
      case "--output":
        options.outputPath = parseMultiValue(argv[++index], "--output")
        break
      case "--baseline":
        options.baselinePath = parseMultiValue(argv[++index], "--baseline")
        break
      case "--update-baseline":
        options.updateBaseline = true
        break
      case "--fail-on-regression":
        options.failOnRegression = true
        break
      default:
        throw new Error(`Unknown flag: ${arg}`)
    }
  }

  if (options.updateBaseline && options.caseIds && options.caseIds.length > 0) {
    throw new Error("--update-baseline is not supported with --case filters")
  }

  return options
}

function uniq(values: string[] | undefined): string[] {
  return [...new Set(values ?? [])]
}

function listAllowed(evalCases: LoadedEvalCase[]): { caseIds: string[]; agents: string[]; tags: string[] } {
  const caseIds = evalCases.map((evalCase) => evalCase.id)
  const agents = evalCases.flatMap((evalCase) =>
    evalCase.target.kind === "builtin-agent-prompt" ? [evalCase.target.agent] : [],
  )
  const tags = evalCases.flatMap((evalCase) => evalCase.tags ?? [])

  return {
    caseIds: uniq(caseIds).sort(),
    agents: uniq(agents).sort(),
    tags: uniq(tags).sort(),
  }
}

function formatAllowedValues(label: string, values: string[]): string {
  return values.length > 0 ? `${label}: ${values.join(", ")}` : `${label}: <none>`
}

function validateSelectors(options: CliOptions): void {
  const suite = loadEvalSuiteManifest(process.cwd(), options.suite)
  const evalCases = loadEvalCasesForSuite(process.cwd(), suite)
  const allowed = listAllowed(evalCases)

  const unknownCaseIds = uniq(options.caseIds).filter((caseId) => !allowed.caseIds.includes(caseId))
  const unknownAgents = uniq(options.agents).filter((agent) => !allowed.agents.includes(agent))
  const unknownTags = uniq(options.tags).filter((tag) => !allowed.tags.includes(tag))

  if (unknownCaseIds.length === 0 && unknownAgents.length === 0 && unknownTags.length === 0) {
    return
  }

  const lines: string[] = []
  if (unknownCaseIds.length > 0) {
    lines.push(`Unknown --case value(s): ${unknownCaseIds.join(", ")}`)
    lines.push(formatAllowedValues("Allowed case ids", allowed.caseIds))
  }
  if (unknownAgents.length > 0) {
    lines.push(`Unknown --agent value(s): ${unknownAgents.join(", ")}`)
    lines.push(formatAllowedValues("Allowed agents", allowed.agents))
  }
  if (unknownTags.length > 0) {
    lines.push(`Unknown --tag value(s): ${unknownTags.join(", ")}`)
    lines.push(formatAllowedValues("Allowed tags", allowed.tags))
  }

  throw new EvalConfigError(lines.join("\n"))
}

async function main(): Promise<void> {
  let options: CliOptions
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    printUsage()
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(2)
  }

  try {
    validateSelectors(options)

    const baselinePath = options.baselinePath ?? getDefaultBaselinePath(process.cwd(), options.suite)

    const output = await runEvalSuite({
      directory: process.cwd(),
      suite: options.suite,
      filters: {
        caseIds: options.caseIds,
        agents: options.agents,
        tags: options.tags,
      },
      outputPath: options.outputPath,
      mode: process.env.CI ? "ci" : "local",
    })

    const baseline = deriveDeterministicBaseline(output.result)
    let baselineComparisonText = ""
    let baselineRegression = false

    if (options.updateBaseline) {
      writeBaseline(baselinePath, baseline)
      baselineComparisonText = `Baseline updated: ${baselinePath}`
    } else if (existsSync(baselinePath)) {
      const comparison = compareDeterministicBaseline(readDeterministicBaseline(baselinePath), output.result)
      baselineComparisonText = `Baseline comparison (${baselinePath}): ${comparison.outcome}`
      if (comparison.regressions.length > 0) {
        baselineComparisonText += `\n- Regressions:\n${comparison.regressions.map((entry) => `  - ${entry}`).join("\n")}`
        baselineRegression = true
      }
      if (comparison.informational.length > 0) {
        baselineComparisonText += `\n- Informational:\n${comparison.informational.map((entry) => `  - ${entry}`).join("\n")}`
      }
    } else if (options.baselinePath) {
      throw new EvalConfigError(`Baseline file not found: ${baselinePath}`)
    }

    if (output.result.summary.totalCases === 0) {
      console.error("No eval cases matched the selected filters after applying valid selectors")
      process.exit(2)
    }

    if (options.json) {
      process.stdout.write(JSON.stringify(output.result, null, 2) + "\n")
    } else {
      process.stdout.write(output.consoleSummary + "\n")
      process.stdout.write(`Artifact: ${output.artifactPath}\n`)
      if (baselineComparisonText) {
        process.stdout.write(`${baselineComparisonText}\n`)
      }
    }

    if (options.failOnRegression && baselineRegression) {
      process.exit(1)
    }

    process.exit(output.result.summary.failedCases > 0 || output.result.summary.errorCases > 0 ? 1 : 0)
  } catch (error) {
    if (error instanceof EvalConfigError) {
      console.error(error.message)
      process.exit(3)
    }

    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
    process.exit(4)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(4)
})
