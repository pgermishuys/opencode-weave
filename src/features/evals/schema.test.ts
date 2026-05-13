import { describe, expect, it } from "bun:test"
import {
  EvalCaseSchema,
  EvalCaseResultSchema,
  EvalSuiteMetadataSchema,
  EvalSuiteManifestSchema,
  EvalRunResultSchema,
  TrajectoryScenarioSchema,
  TrajectoryTraceSchema,
  TrajectoryTurnSchema,
  TrajectoryAssertionEvaluatorSchema,
} from "./schema"

describe("eval schemas", () => {
  it("validates a phase1 prompt-render case", () => {
    const result = EvalCaseSchema.safeParse({
      id: "loom-default-contract",
      title: "Loom default",
      phase: "prompt",
      target: { kind: "builtin-agent-prompt", agent: "loom" },
      executor: { kind: "prompt-render" },
      evaluators: [{ kind: "contains-all", patterns: ["<Role>"] }],
    })
    expect(result.success).toBe(true)
  })

  it("validates builtin Tapestry target variants with categories", () => {
    const result = EvalCaseSchema.safeParse({
      id: "tapestry-categories-contract",
      title: "Tapestry categories variant",
      phase: "prompt",
      target: {
        kind: "builtin-agent-prompt",
        agent: "tapestry",
        variant: {
          disabledAgents: ["pattern"],
          categories: {
            frontend: {
              patterns: ["src/**/*.tsx"],
            },
          },
        },
      },
      executor: { kind: "prompt-render" },
      evaluators: [{ kind: "contains-all", patterns: ["<Role>"] }],
    })
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.target).toEqual({
      kind: "builtin-agent-prompt",
      agent: "tapestry",
      variant: {
        disabledAgents: ["pattern"],
        categories: {
          frontend: {
            patterns: ["src/**/*.tsx"],
          },
        },
      },
    })
  })

  it("validates builtin target variants with agentOverrides", () => {
    const result = EvalCaseSchema.safeParse({
      id: "loom-agent-overrides-contract",
      title: "Loom agent overrides variant",
      phase: "prompt",
      target: {
        kind: "builtin-agent-prompt",
        agent: "loom",
        variant: {
          agentOverrides: {
            weft: {
              review_models: ["anthropic/claude-sonnet-4"],
            },
          },
        },
      },
      executor: { kind: "prompt-render" },
      evaluators: [{ kind: "contains-all", patterns: ["<Role>"] }],
    })

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.target).toEqual({
      kind: "builtin-agent-prompt",
      agent: "loom",
      variant: {
        agentOverrides: {
          weft: {
            review_models: ["anthropic/claude-sonnet-4"],
          },
        },
      },
    })
  })

  it("validates builtin Loom target variants with agentOverrides", () => {
    const result = EvalCaseSchema.safeParse({
      id: "loom-agent-overrides-contract",
      title: "Loom agentOverrides variant",
      phase: "prompt",
      target: {
        kind: "builtin-agent-prompt",
        agent: "loom",
        variant: {
          agentOverrides: {
            loom: { model: "openrouter/openai/gpt-5" },
            weft: { review_models: ["anthropic/claude-sonnet-4"] },
          },
        },
      },
      executor: { kind: "prompt-render" },
      evaluators: [{ kind: "contains-all", patterns: ["<Role>"] }],
    })

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.target).toEqual({
      kind: "builtin-agent-prompt",
      agent: "loom",
      variant: {
        agentOverrides: {
          loom: { model: "openrouter/openai/gpt-5" },
          weft: { review_models: ["anthropic/claude-sonnet-4"] },
        },
      },
    })
  })

  it("rejects malformed builtin target agentOverrides", () => {
    const result = EvalCaseSchema.safeParse({
      id: "loom-agent-overrides-invalid",
      title: "Invalid agentOverrides variant",
      phase: "prompt",
      target: {
        kind: "builtin-agent-prompt",
        agent: "loom",
        variant: {
          agentOverrides: {
            weft: { review_models: ["claude-sonnet-4"] },
          },
        },
      },
      executor: { kind: "prompt-render" },
      evaluators: [{ kind: "contains-all", patterns: ["<Role>"] }],
    })

    expect(result.success).toBe(false)
  })

  it("rejects malformed builtin Tapestry target categories", () => {
    const result = EvalCaseSchema.safeParse({
      id: "tapestry-categories-invalid",
      title: "Invalid Tapestry categories variant",
      phase: "prompt",
      target: {
        kind: "builtin-agent-prompt",
        agent: "tapestry",
        variant: {
          categories: {
            frontend: {
              patterns: [123],
            },
          },
        },
      },
      executor: { kind: "prompt-render" },
      evaluators: [{ kind: "contains-all", patterns: ["<Role>"] }],
    })

    expect(result.success).toBe(false)
  })

  it("rejects malformed builtin target agentOverrides", () => {
    const result = EvalCaseSchema.safeParse({
      id: "loom-agent-overrides-invalid",
      title: "Invalid Loom agent overrides variant",
      phase: "prompt",
      target: {
        kind: "builtin-agent-prompt",
        agent: "loom",
        variant: {
          agentOverrides: {
            weft: {
              review_models: ["claude-sonnet-4"],
            },
          },
        },
      },
      executor: { kind: "prompt-render" },
      evaluators: [{ kind: "contains-all", patterns: ["<Role>"] }],
    })

    expect(result.success).toBe(false)
  })

  it("rejects unknown kind values", () => {
    const result = EvalCaseSchema.safeParse({
      id: "bad",
      title: "Bad",
      phase: "prompt",
      target: { kind: "not-real", agent: "loom" },
      executor: { kind: "prompt-render" },
      evaluators: [{ kind: "contains-all", patterns: ["x"] }],
    })
    expect(result.success).toBe(false)
  })

  it("validates suite manifests", () => {
    const result = EvalSuiteManifestSchema.safeParse({
      id: "prompt-contracts",
      title: "Prompt contracts",
      phase: "prompt",
      caseFiles: ["evals/cases/loom/default-contract.jsonc"],
    })
    expect(result.success).toBe(true)
  })

  it("validates suite metadata with routing kind", () => {
    const result = EvalSuiteMetadataSchema.safeParse({
      title: "Agent Routing Identity",
      routingKind: "identity",
    })
    expect(result.success).toBe(true)
  })

  it("validates suite metadata with optional family and view labels", () => {
    const result = EvalSuiteMetadataSchema.safeParse({
      title: "Loom Routing Identity",
      routingKind: "identity",
      familyId: "loom-routing",
      familyTitle: "Loom Routing",
      viewId: "identity",
      viewTitle: "Identity",
    })
    expect(result.success).toBe(true)
  })

  it("validates section-contains-all evaluator", () => {
    const result = EvalCaseSchema.safeParse({
      id: "loom-role-scope",
      title: "Loom role scoped contains",
      phase: "prompt",
      target: { kind: "builtin-agent-prompt", agent: "loom" },
      executor: { kind: "prompt-render" },
      evaluators: [{ kind: "section-contains-all", section: "Role", patterns: ["Loom"] }],
    })
    expect(result.success).toBe(true)
  })

  it("validates llm-judge evaluator with phrase checks", () => {
    const result = EvalCaseSchema.safeParse({
      id: "routing-judge-test",
      title: "Routing judge validation",
      phase: "routing",
      target: { kind: "builtin-agent-prompt", agent: "loom" },
      executor: { kind: "model-response", provider: "github-models", model: "gpt-5", input: "test" },
      evaluators: [
        {
          kind: "llm-judge",
          rubricRef: "evals/rubrics/loom-routing-rubric.md",
          expectedContains: ["delegate"],
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it("validates llm-judge evaluator with expectedAnyOf", () => {
    const result = EvalCaseSchema.safeParse({
      id: "routing-judge-anyof-test",
      title: "Routing judge any-of validation",
      phase: "routing",
      target: { kind: "builtin-agent-prompt", agent: "loom" },
      executor: { kind: "model-response", provider: "github-models", model: "gpt-5", input: "test" },
      evaluators: [
        {
          kind: "llm-judge",
          expectedAnyOf: ["delegate to pattern", "ask Pattern to plan"],
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it("validates model-response executor with openrouter provider", () => {
    const result = EvalCaseSchema.safeParse({
      id: "routing-openrouter-test",
      title: "Routing with OpenRouter",
      phase: "routing",
      target: { kind: "builtin-agent-prompt", agent: "loom" },
      executor: {
        kind: "model-response",
        provider: "openrouter",
        model: "anthropic/claude-3.5-sonnet",
        input: "test",
      },
      evaluators: [{ kind: "llm-judge", expectedContains: ["thread"] }],
    })
    expect(result.success).toBe(true)
  })

  it("rejects invalid model-response executor missing provider", () => {
    const result = EvalCaseSchema.safeParse({
      id: "routing-invalid-executor",
      title: "Invalid model-response executor",
      phase: "routing",
      target: { kind: "builtin-agent-prompt", agent: "loom" },
      executor: { kind: "model-response", model: "gpt-5", input: "test" },
      evaluators: [{ kind: "llm-judge" }],
    })
    expect(result.success).toBe(false)
  })

  it("rejects unsupported model-response provider values", () => {
    const result = EvalCaseSchema.safeParse({
      id: "routing-invalid-provider",
      title: "Invalid provider",
      phase: "routing",
      target: { kind: "builtin-agent-prompt", agent: "loom" },
      executor: { kind: "model-response", provider: "openai", model: "gpt-5", input: "test" },
      evaluators: [{ kind: "llm-judge" }],
    })
    expect(result.success).toBe(false)
  })

  it("validates eval run results with optional run metadata", () => {
    const result = EvalRunResultSchema.safeParse({
      runId: "eval_123",
      startedAt: "2026-04-09T00:00:00.000Z",
      finishedAt: "2026-04-09T00:00:10.000Z",
      suiteId: "agent-routing",
      phase: "routing",
      suiteMetadata: {
        title: "Agent Routing Identity",
        routingKind: "identity",
        familyId: "loom-routing",
        familyTitle: "Loom Routing",
        viewId: "identity",
        viewTitle: "Identity",
      },
      runMetadata: {
        provider: "openrouter",
        model: "anthropic/claude-3.5-sonnet",
        modelKey: "openrouter/anthropic/claude-3.5-sonnet",
        source: "workflow_dispatch",
        repo: "pgermishuys/weave",
        branch: "main",
        commitSha: "abc123",
        runGroup: "commit:abc123",
        workflow: "Agent Evals",
        job: "agent-routing",
        matrix: {
          provider: "openrouter",
          model: "anthropic/claude-3.5-sonnet",
        },
      },
      summary: {
        totalCases: 1,
        passedCases: 1,
        failedCases: 0,
        errorCases: 0,
        totalScore: 1,
        normalizedScore: 1,
        maxScore: 1,
      },
      caseResults: [],
    })
    expect(result.success).toBe(true)
  })

  it("validates eval run results without run metadata for backward compatibility", () => {
    const result = EvalRunResultSchema.safeParse({
      runId: "eval_legacy",
      startedAt: "2026-04-09T00:00:00.000Z",
      finishedAt: "2026-04-09T00:00:10.000Z",
      suiteId: "agent-routing",
      phase: "routing",
      summary: {
        totalCases: 1,
        passedCases: 1,
        failedCases: 0,
        errorCases: 0,
        totalScore: 1,
        normalizedScore: 1,
        maxScore: 1,
      },
      caseResults: [],
    })
    expect(result.success).toBe(true)
  })

  describe("trajectory schemas", () => {
    it("validates a trajectory turn", () => {
      const result = TrajectoryTurnSchema.safeParse({
        turn: 1,
        role: "user",
        content: "Hello",
      })
      expect(result.success).toBe(true)
    })

    it("validates an assistant trajectory turn with all fields", () => {
      const result = TrajectoryTurnSchema.safeParse({
        turn: 2,
        role: "assistant",
        agent: "loom",
        content: "Delegating to pattern",
        mockResponse: "Let me delegate to Pattern for planning.",
        expectedDelegation: "pattern",
      })
      expect(result.success).toBe(true)
    })

    it("rejects trajectory turn with missing content", () => {
      const result = TrajectoryTurnSchema.safeParse({
        turn: 1,
        role: "user",
      })
      expect(result.success).toBe(false)
    })

    it("rejects trajectory turn with invalid role", () => {
      const result = TrajectoryTurnSchema.safeParse({
        turn: 1,
        role: "system",
        content: "Hello",
      })
      expect(result.success).toBe(false)
    })

    it("rejects trajectory turn with non-positive turn number", () => {
      const result = TrajectoryTurnSchema.safeParse({
        turn: 0,
        role: "user",
        content: "Hello",
      })
      expect(result.success).toBe(false)
    })

    it("validates a complete trajectory scenario", () => {
      const result = TrajectoryScenarioSchema.safeParse({
        id: "test-scenario",
        title: "Test Scenario",
        description: "A test scenario",
        agents: ["loom", "pattern"],
        turns: [
          { turn: 1, role: "user", content: "Build a feature" },
          { turn: 2, role: "assistant", agent: "loom", content: "Delegating", mockResponse: "mock" },
        ],
      })
      expect(result.success).toBe(true)
    })

    it("rejects trajectory scenario with empty agents", () => {
      const result = TrajectoryScenarioSchema.safeParse({
        id: "bad-scenario",
        title: "Bad",
        agents: [],
        turns: [
          { turn: 1, role: "user", content: "Hello" },
          { turn: 2, role: "assistant", content: "Hi" },
        ],
      })
      expect(result.success).toBe(false)
    })

    it("validates trajectory traces with delegation targets", () => {
      const result = TrajectoryTraceSchema.safeParse({
        scenarioId: "loom-delegates-to-pattern",
        turns: [
          {
            turn: 1,
            agent: "user",
            role: "user",
            response: "Build a feature",
            durationMs: 1,
          },
          {
            turn: 2,
            agent: "loom",
            role: "assistant",
            response: "Delegating to pattern",
            expectedDelegation: "pattern",
            observedDelegation: "pattern",
            durationMs: 2,
          },
        ],
        delegationSequence: ["loom", "pattern", "loom"],
        delegationTargets: ["pattern"],
        totalTurns: 4,
        completedTurns: 2,
      })

      expect(result.success).toBe(true)
    })

    it("rejects trajectory traces with malformed delegation targets", () => {
      const result = EvalCaseResultSchema.safeParse({
        caseId: "trajectory-test",
        status: "passed",
        score: 1,
        normalizedScore: 1,
        maxScore: 1,
        durationMs: 5,
        artifacts: {
          trace: {
            scenarioId: "loom-delegates-to-pattern",
            turns: [
              {
                turn: 1,
                agent: "loom",
                role: "assistant",
                response: "Delegating to pattern",
                observedDelegation: "pattern",
                durationMs: 2,
              },
            ],
            delegationSequence: ["loom", "pattern"],
            delegationTargets: ["pattern", 42],
            totalTurns: 2,
            completedTurns: 1,
          },
        },
        assertionResults: [],
        errors: [],
      })

      expect(result.success).toBe(false)
    })

    it("rejects trajectory scenario with fewer than 2 turns", () => {
      const result = TrajectoryScenarioSchema.safeParse({
        id: "too-short",
        title: "Too Short",
        agents: ["loom"],
        turns: [{ turn: 1, role: "user", content: "Hello" }],
      })
      expect(result.success).toBe(false)
    })

    it("rejects trajectory scenario with missing id", () => {
      const result = TrajectoryScenarioSchema.safeParse({
        title: "No ID",
        agents: ["loom"],
        turns: [
          { turn: 1, role: "user", content: "Hello" },
          { turn: 2, role: "assistant", content: "Hi" },
        ],
      })
      expect(result.success).toBe(false)
    })

    it("validates trajectory-assertion evaluator with all optional fields", () => {
      const result = TrajectoryAssertionEvaluatorSchema.safeParse({
        kind: "trajectory-assertion",
        expectedSequence: ["loom", "pattern", "loom"],
        expectedDelegationTargets: ["shuttle", "shuttle-frontend"],
        requiredAgents: ["pattern"],
        requiredDelegationTargets: ["shuttle"],
        forbiddenAgents: ["spindle"],
        forbiddenDelegationTargets: ["shuttle-manual-only"],
        minTurns: 3,
        maxTurns: 10,
        weight: 2,
      })
      expect(result.success).toBe(true)
    })

    it("rejects trajectory-assertion with invalid delegation targets", () => {
      const result = TrajectoryAssertionEvaluatorSchema.safeParse({
        kind: "trajectory-assertion",
        expectedDelegationTargets: ["shuttle", 42],
      })
      expect(result.success).toBe(false)
    })

    it("validates trajectory-assertion evaluator with only kind", () => {
      const result = TrajectoryAssertionEvaluatorSchema.safeParse({
        kind: "trajectory-assertion",
      })
      expect(result.success).toBe(true)
    })

    it("rejects trajectory-assertion with invalid minTurns", () => {
      const result = TrajectoryAssertionEvaluatorSchema.safeParse({
        kind: "trajectory-assertion",
        minTurns: -1,
      })
      expect(result.success).toBe(false)
    })

    it("rejects trajectory-assertion with non-integer maxTurns", () => {
      const result = TrajectoryAssertionEvaluatorSchema.safeParse({
        kind: "trajectory-assertion",
        maxTurns: 2.5,
      })
      expect(result.success).toBe(false)
    })

    it("validates a phase3 trajectory eval case", () => {
      const result = EvalCaseSchema.safeParse({
        id: "trajectory-test",
        title: "Trajectory Test",
        phase: "trajectory",
        target: { kind: "trajectory-agent", agent: "loom", scenarioRef: "evals/scenarios/test.jsonc" },
        executor: { kind: "trajectory-run", scenarioRef: "evals/scenarios/test.jsonc" },
        evaluators: [
          {
            kind: "trajectory-assertion",
            expectedSequence: ["loom", "pattern"],
            requiredAgents: ["pattern"],
          },
        ],
      })
      expect(result.success).toBe(true)
    })
  })
})
