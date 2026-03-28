import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "fs"
import { dirname, join } from "path"
import type { EvalRunResult } from "./types"

export const EVALS_DIR = ".weave/evals"
export const EVAL_RUNS_DIR = ".weave/evals/runs"
export const EVAL_LATEST_FILE = ".weave/evals/latest.json"

export function ensureEvalStorageDir(directory: string): string {
  const fullPath = join(directory, EVAL_RUNS_DIR)
  if (!existsSync(fullPath)) {
    mkdirSync(fullPath, { recursive: true, mode: 0o700 })
  }
  return fullPath
}

export function getDefaultEvalRunPath(directory: string, runId: string): string {
  return join(directory, EVAL_RUNS_DIR, `${runId}.json`)
}

export function writeEvalRunResult(directory: string, result: EvalRunResult, outputPath?: string): string {
  const destination = outputPath ?? getDefaultEvalRunPath(directory, result.runId)
  const destinationDir = dirname(destination)

  if (!existsSync(destinationDir)) {
    mkdirSync(destinationDir, { recursive: true, mode: 0o700 })
  }

  writeFileSync(destination, JSON.stringify(result, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 })

  const latestPath = join(directory, EVAL_LATEST_FILE)
  const latestDir = dirname(latestPath)
  if (!existsSync(latestDir)) {
    mkdirSync(latestDir, { recursive: true, mode: 0o700 })
  }
  writeFileSync(latestPath, JSON.stringify(result, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 })

  return destination
}

export function getDefaultJsonlPath(directory: string, suiteId: string): string {
  return join(directory, "evals", "results", `${suiteId}.jsonl`)
}

export function appendEvalRunJsonl(directory: string, result: EvalRunResult, jsonlPath?: string): string {
  const destination = jsonlPath ?? getDefaultJsonlPath(directory, result.suiteId)
  const destinationDir = dirname(destination)

  if (!existsSync(destinationDir)) {
    mkdirSync(destinationDir, { recursive: true, mode: 0o700 })
  }

  appendFileSync(destination, JSON.stringify(result) + "\n", { encoding: "utf-8", mode: 0o600 })

  return destination
}
