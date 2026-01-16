#!/usr/bin/env bun
// script/verify.ts — End-to-end verification for weave-opencode

interface CheckResult {
  name: string
  passed: boolean
  output?: string
}

function runCheck(name: string, cmd: string[]): CheckResult {
  const result = Bun.spawnSync(cmd, { cwd: process.cwd() })
  const passed = result.exitCode === 0
  const output =
    new TextDecoder().decode(result.stdout) +
    new TextDecoder().decode(result.stderr)
  return { name, passed, output: output.trim() }
}

const checks: CheckResult[] = []

// 1. typecheck
checks.push(runCheck("typecheck", ["bun", "run", "typecheck"]))

// 2. test
const testResult = runCheck("test", ["bun", "test"])
// Try to extract test count from output
const testOutput = testResult.output ?? ""
const testCountMatch = testOutput.match(/(\d+)\s+pass/)
const testCount = testCountMatch ? ` (${testCountMatch[1]} passed)` : ""
checks.push({ ...testResult, name: `test${testCount}` })

// 3. build
const buildResult = runCheck("build", ["bun", "run", "build"])
checks.push(buildResult)

// 4. plugin-export — depends on dist/index.js from build above
checks.push(
  runCheck("plugin-export", [
    "bun",
    "-e",
    "import p from './dist/index.js'; process.exit(typeof p === 'function' ? 0 : 1)",
  ])
)

// 5. no-function-exports — depends on dist/index.js
checks.push(
  runCheck("no-function-exports", [
    "bun",
    "-e",
    "import * as m from './dist/index.js'; const fns = Object.entries(m).filter(([k,v]) => typeof v === 'function' && k !== 'default'); process.exit(fns.length === 0 ? 0 : 1)",
  ])
)

// 6. 6-agents
checks.push(
  runCheck("6-agents", [
    "bun",
    "-e",
    "import { createBuiltinAgents } from './src/agents/builtin-agents.ts'; const a = createBuiltinAgents(); process.exit(Object.keys(a).length === 6 ? 0 : 1)",
  ])
)

// 7. config-schema
checks.push(
  runCheck("config-schema", [
    "bun",
    "-e",
    "import { WeaveConfigSchema } from './src/config/schema.ts'; const r = WeaveConfigSchema.safeParse({}); process.exit(r.success ? 0 : 1)",
  ])
)

// Print results
for (const check of checks) {
  const status = check.passed ? "✓ PASS" : "✗ FAIL"
  console.log(`${status}  ${check.name}`)
  if (!check.passed && check.output) {
    console.log(
      "       " + check.output.split("\n").slice(0, 5).join("\n       ")
    )
  }
}

const allPassed = checks.every((c) => c.passed)
console.log()
console.log(allPassed ? "ALL CHECKS PASSED ✓" : "SOME CHECKS FAILED ✗")
process.exit(allPassed ? 0 : 1)
