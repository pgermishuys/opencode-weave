import { loadTrajectoryScenario } from "../loader"
import type {
  EvalArtifacts,
  ExecutionContext,
  ResolvedTarget,
  TrajectoryRunExecutor,
  TrajectoryTrace,
  TrajectoryTurnResult,
} from "../types"

// Trajectory evals are intentionally mock-backed and text-based for now.
// They replay canned assistant responses and derive delegation intent from those
// responses only; runtime proof of actual delegation remains owned by
// integration tests that inspect task-tool activity.
const DELEGATION_PATTERNS = [
  /\[delegates?\s+to\s+([\w]+(?:-[\w]+)*)\]/i,
  /delegating\s+to\s+([\w]+(?:-[\w]+)*)/i,
  /delegate\s+to\s+([\w]+(?:-[\w]+)*)/i,
  /use\s+([\w]+(?:-[\w]+)*)\s+(?:for|to)/i,
  /route\s+to\s+([\w]+(?:-[\w]+)*)/i,
  /routing\s+to\s+([\w]+(?:-[\w]+)*)/i,
]

export function detectDelegation(response: string): string | null {
  for (const pattern of DELEGATION_PATTERNS) {
    const match = response.match(pattern)
    if (match?.[1]) {
      return match[1].toLowerCase()
    }
  }
  return null
}

export async function executeTrajectoryRun(
  resolvedTarget: ResolvedTarget,
  executor: TrajectoryRunExecutor,
  context: ExecutionContext,
): Promise<EvalArtifacts> {
  const scenario = loadTrajectoryScenario(context.directory, executor.scenarioRef)

  const turnResults: TrajectoryTurnResult[] = []
  const delegationSequence: string[] = []
  const delegationTargets: string[] = []
  const assistantResponses: string[] = []

  for (const turn of scenario.turns) {
    const turnStart = Date.now()

    if (turn.role === "user") {
      turnResults.push({
        turn: turn.turn,
        agent: "user",
        role: "user",
        response: turn.content,
        durationMs: Date.now() - turnStart,
      })
      continue
    }

    // Assistant turn
    let response: string
    // Trajectory evals use mock responses embedded in scenario files.
    // Live trajectory execution is a future concern.
    response = turn.mockResponse ?? turn.content

    const observedDelegation = detectDelegation(response)
    if (observedDelegation) {
      delegationTargets.push(observedDelegation)
    }

    // The delegation sequence tracks acting agents (who produced each turn),
    // not delegation targets. The turn.agent field identifies the acting agent.
    if (turn.agent) {
      delegationSequence.push(turn.agent)
    }

    assistantResponses.push(response)

    turnResults.push({
      turn: turn.turn,
      agent: turn.agent ?? "unknown",
      role: "assistant",
      response,
      expectedDelegation: turn.expectedDelegation,
      observedDelegation,
      durationMs: Date.now() - turnStart,
    })
  }

  const trace: TrajectoryTrace = {
    scenarioId: scenario.id,
    turns: turnResults,
    delegationSequence,
    delegationTargets,
    totalTurns: scenario.turns.length,
    completedTurns: turnResults.length,
  }

  return {
    ...resolvedTarget.artifacts,
    modelOutput: assistantResponses.join("\n\n---\n\n"),
    trace,
  }
}
