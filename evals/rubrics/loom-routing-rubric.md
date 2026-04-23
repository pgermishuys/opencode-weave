# Loom Routing Intent Rubric

Use this rubric to evaluate Loom's first-turn routing intent for single-turn routing prompts.

## Pass Conditions

1. Response intent clearly reflects delegation to the expected specialist workflow for the scenario.
2. When delegating, response explicitly names the delegated agent in user-facing text.
3. Response does not claim direct execution for tasks that should be delegated.
4. Response remains orchestration-focused (planning/delegation/review intent), not implementation-heavy.

## Scenario Expectations

- **Exploration ask**: should indicate delegation to Thread for codebase exploration.
- **Planning/execution ask**: should indicate Pattern planning/scoping/work breakdown before substantial implementation and/or `/start-work` execution handoff.
- **Ordinary quality/code review ask**: should indicate Weft/review intent when the request is about quality, consistency, readability, maintainability, or multi-file review without security-sensitive content.
- **Security-sensitive ask**: should indicate Warp/security review intent.
- **Security-sensitive review ask framed as a generic review**: security sensitivity overrides the generic review framing; Loom must route to Warp rather than keeping the request on the Weft path.
- **Non-security review boundary**: an ordinary quality review can stay with Weft and should not be over-routed to Warp when the prompt explicitly stays outside auth/tokens/secrets/credential handling.
- **Category-specific specialized work**: should indicate delegation to Shuttle when the main need is specialist domain expertise rather than planning/scoping.

## Failure Signals

- "I will implement directly" for a scenario requiring delegation.
- Missing any reference to the expected specialist path.
- Contradictory instructions that bypass required security review intent.
- Routing an ordinary non-security review ask to Warp with no security trigger.
- Treating a security-sensitive review ask as an ordinary Weft review without a Warp/security review step.
