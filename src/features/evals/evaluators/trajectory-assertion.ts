import type {
  AssertionResult,
  EvalArtifacts,
  TrajectoryAssertionEvaluator,
  TrajectoryTrace,
} from "../types"
import { isTrajectoryTrace } from "../types"

function getWeight(spec: TrajectoryAssertionEvaluator): number {
  return spec.weight ?? 1
}

function distributeWeight(totalWeight: number, count: number): number {
  return count > 0 ? totalWeight / count : totalWeight
}

function countAssertionTypes(spec: TrajectoryAssertionEvaluator): number {
  let count = 0
  if (spec.expectedSequence) count++
  if (spec.expectedDelegationTargets) count++
  if (spec.requiredAgents) count++
  if (spec.requiredDelegationTargets) count++
  if (spec.forbiddenAgents) count++
  if (spec.forbiddenDelegationTargets) count++
  if (spec.minTurns !== undefined) count++
  if (spec.maxTurns !== undefined) count++
  return Math.max(count, 1)
}

function checkExpectedSequence(
  trace: TrajectoryTrace,
  expectedSequence: string[],
  weight: number,
): AssertionResult {
  const actual = trace.delegationSequence
  const matches =
    actual.length === expectedSequence.length &&
    actual.every((agent, i) => agent === expectedSequence[i])

  return {
    evaluatorKind: "trajectory-assertion",
    passed: matches,
    score: matches ? weight : 0,
    maxScore: weight,
    message: matches
      ? `Delegation sequence matches: [${expectedSequence.join(" → ")}]`
      : `Delegation sequence mismatch: expected [${expectedSequence.join(" → ")}], got [${actual.join(" → ")}]`,
  }
}

function checkExpectedDelegationTargets(
  trace: TrajectoryTrace,
  expectedDelegationTargets: string[],
  weight: number,
): AssertionResult {
  const actual = trace.delegationTargets ?? []
  const matches =
    actual.length === expectedDelegationTargets.length &&
    actual.every((target, i) => target === expectedDelegationTargets[i])

  return {
    evaluatorKind: "trajectory-assertion",
    passed: matches,
    score: matches ? weight : 0,
    maxScore: weight,
    message: matches
      ? `Delegation targets match: [${expectedDelegationTargets.join(" → ")}]`
      : `Delegation targets mismatch: expected [${expectedDelegationTargets.join(" → ")}], got [${actual.join(" → ")}]`,
  }
}

function checkRequiredAgents(
  trace: TrajectoryTrace,
  requiredAgents: string[],
  weight: number,
): AssertionResult[] {
  const observed = new Set(trace.delegationSequence)
  const perAgent = distributeWeight(weight, requiredAgents.length)

  return requiredAgents.map((agent) => {
    const passed = observed.has(agent)
    return {
      evaluatorKind: "trajectory-assertion" as const,
      passed,
      score: passed ? perAgent : 0,
      maxScore: perAgent,
      message: passed
        ? `Required agent present: ${agent}`
        : `Required agent missing: ${agent} (observed: [${trace.delegationSequence.join(", ")}])`,
    }
  })
}

function checkRequiredDelegationTargets(
  trace: TrajectoryTrace,
  requiredDelegationTargets: string[],
  weight: number,
): AssertionResult[] {
  const observed = new Set(trace.delegationTargets ?? [])
  const perTarget = distributeWeight(weight, requiredDelegationTargets.length)

  return requiredDelegationTargets.map((target) => {
    const passed = observed.has(target)
    return {
      evaluatorKind: "trajectory-assertion" as const,
      passed,
      score: passed ? perTarget : 0,
      maxScore: perTarget,
      message: passed
        ? `Required delegation target present: ${target}`
        : `Required delegation target missing: ${target} (observed: [${(trace.delegationTargets ?? []).join(", ")}])`,
    }
  })
}

function checkForbiddenAgents(
  trace: TrajectoryTrace,
  forbiddenAgents: string[],
  weight: number,
): AssertionResult[] {
  const observed = new Set(trace.delegationSequence)
  const perAgent = distributeWeight(weight, forbiddenAgents.length)

  return forbiddenAgents.map((agent) => {
    const passed = !observed.has(agent)
    return {
      evaluatorKind: "trajectory-assertion" as const,
      passed,
      score: passed ? perAgent : 0,
      maxScore: perAgent,
      message: passed
        ? `Forbidden agent correctly absent: ${agent}`
        : `Forbidden agent present: ${agent} (observed: [${trace.delegationSequence.join(", ")}])`,
    }
  })
}

function checkForbiddenDelegationTargets(
  trace: TrajectoryTrace,
  forbiddenDelegationTargets: string[],
  weight: number,
): AssertionResult[] {
  const observed = new Set(trace.delegationTargets ?? [])
  const perTarget = distributeWeight(weight, forbiddenDelegationTargets.length)

  return forbiddenDelegationTargets.map((target) => {
    const passed = !observed.has(target)
    return {
      evaluatorKind: "trajectory-assertion" as const,
      passed,
      score: passed ? perTarget : 0,
      maxScore: perTarget,
      message: passed
        ? `Forbidden delegation target correctly absent: ${target}`
        : `Forbidden delegation target present: ${target} (observed: [${(trace.delegationTargets ?? []).join(", ")}])`,
    }
  })
}

function checkMinTurns(trace: TrajectoryTrace, minTurns: number, weight: number): AssertionResult {
  const passed = trace.completedTurns >= minTurns
  return {
    evaluatorKind: "trajectory-assertion",
    passed,
    score: passed ? weight : 0,
    maxScore: weight,
    message: passed
      ? `Turn count ${trace.completedTurns} meets minimum ${minTurns}`
      : `Turn count ${trace.completedTurns} below minimum ${minTurns}`,
  }
}

function checkMaxTurns(trace: TrajectoryTrace, maxTurns: number, weight: number): AssertionResult {
  const passed = trace.completedTurns <= maxTurns
  return {
    evaluatorKind: "trajectory-assertion",
    passed,
    score: passed ? weight : 0,
    maxScore: weight,
    message: passed
      ? `Turn count ${trace.completedTurns} within maximum ${maxTurns}`
      : `Turn count ${trace.completedTurns} exceeds maximum ${maxTurns}`,
  }
}

export function runTrajectoryAssertionEvaluator(
  spec: TrajectoryAssertionEvaluator,
  artifacts: EvalArtifacts,
): AssertionResult[] {
  if (!isTrajectoryTrace(artifacts.trace)) {
    return [
      {
        evaluatorKind: "trajectory-assertion",
        passed: false,
        score: 0,
        maxScore: getWeight(spec),
        message: "Trajectory trace missing or invalid in artifacts — cannot run trajectory assertions",
      },
    ]
  }

  const trace = artifacts.trace
  const totalWeight = getWeight(spec)
  const assertionCount = countAssertionTypes(spec)
  const perAssertion = distributeWeight(totalWeight, assertionCount)
  const results: AssertionResult[] = []

  if (spec.expectedSequence) {
    results.push(checkExpectedSequence(trace, spec.expectedSequence, perAssertion))
  }

  if (spec.expectedDelegationTargets) {
    results.push(
      checkExpectedDelegationTargets(trace, spec.expectedDelegationTargets, perAssertion),
    )
  }

  if (spec.requiredAgents) {
    results.push(...checkRequiredAgents(trace, spec.requiredAgents, perAssertion))
  }

  if (spec.requiredDelegationTargets) {
    results.push(
      ...checkRequiredDelegationTargets(trace, spec.requiredDelegationTargets, perAssertion),
    )
  }

  if (spec.forbiddenAgents) {
    results.push(...checkForbiddenAgents(trace, spec.forbiddenAgents, perAssertion))
  }

  if (spec.forbiddenDelegationTargets) {
    results.push(
      ...checkForbiddenDelegationTargets(trace, spec.forbiddenDelegationTargets, perAssertion),
    )
  }

  if (spec.minTurns !== undefined) {
    results.push(checkMinTurns(trace, spec.minTurns, perAssertion))
  }

  if (spec.maxTurns !== undefined) {
    results.push(checkMaxTurns(trace, spec.maxTurns, perAssertion))
  }

  // If no specific assertions configured, just verify trace exists
  if (results.length === 0) {
    results.push({
      evaluatorKind: "trajectory-assertion",
      passed: trace.completedTurns > 0,
      score: trace.completedTurns > 0 ? totalWeight : 0,
      maxScore: totalWeight,
      message:
        trace.completedTurns > 0
          ? `Trajectory completed with ${trace.completedTurns} turns`
          : "Trajectory completed with 0 turns",
    })
  }

  return results
}
