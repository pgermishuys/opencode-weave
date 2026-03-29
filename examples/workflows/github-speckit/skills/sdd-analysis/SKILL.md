---
name: sdd-analysis
description: "Spec-Driven Development: Cross-artifact consistency analysis — semantic model building, 6 detection passes, severity assignment"
---

<SDDAnalysis>

## Cross-Artifact Consistency Analysis

The analyze step performs a **read-only** pass across all SDD artifacts to detect inconsistencies, coverage gaps, and constitution violations **before** implementation begins. Do NOT modify any files during analysis — write findings to a report only.

---

### Step 1: Build a Semantic Model

Before running detection passes, build an inventory from all artifacts:

**From the spec (`spec.md`)**:
- List all FR-### requirements (ID, description, priority MUST/SHOULD)
- List all user stories (US#, priority P1/P2/P3, acceptance scenarios)
- List all SC-### success criteria (ID, description)
- List all declared edge cases
- Note any `[NEEDS CLARIFICATION]` markers remaining

**From the plan (`plan.md`)**:
- List all Phase 0 research items (resolved vs. UNKNOWN)
- List constitution check results (✅/⚠/❌ per principle)
- Note any explicitly out-of-scope items

**From the tasks (`tasks.md`)**:
- List all tasks (T###, priority, US reference)
- Build a task → US mapping
- Build a task → FR mapping (inferred from task descriptions)

**From the constitution (`memory/constitution.md`)**:
- List all principles with their MUST/SHOULD rules

---

### Step 2: Six Detection Passes

Run each pass in order. Record every finding with a unique ID (A001, A002, ...).

#### Pass 1: Coverage Gaps
Check that every requirement has a corresponding task:
- Every FR-### → at least one task that addresses it
- Every SC-### → at least one task whose acceptance criteria verifies it
- Every user story (P1) → at least one P1 task

Findings: FRs with no task, SCs with no verifiable task, unimplemented P1 stories.

#### Pass 2: Duplication
Look for redundancy that could cause implementation conflicts:
- Overlapping tasks that would modify the same component
- Duplicate requirements (same behavior expressed differently as FR-X and FR-Y)
- Duplicate success criteria

Findings: Pairs of tasks/requirements that overlap, with recommendation to merge or clarify scope boundary.

#### Pass 3: Ambiguity
Identify requirements that have multiple valid interpretations:
- FRs using vague language ("appropriate", "fast", "intuitive") without measurable criteria
- Tasks with unclear acceptance criteria ("works correctly", "handles errors")
- Success criteria that cannot be objectively verified

Findings: Each ambiguous item with the specific vague language quoted.

#### Pass 4: Constitution Alignment
Check tasks against constitutional principles:
- Would implementing this task violate a MUST principle?
- Does any task assume behavior that contradicts a constitutional constraint?
- Are performance-related tasks aligned with any performance principles?

Findings: Tasks that would violate principles, with the specific principle cited.

#### Pass 5: Inconsistency
Look for internal contradictions:
- Two FRs that specify conflicting behavior for the same scenario
- A task assumption that contradicts the spec's stated constraints
- An edge case in the spec that contradicts a functional requirement

Findings: Pairs of items that conflict, with the contradiction described precisely.

#### Pass 6: Underspecification
Identify items that are too vague to implement:
- Tasks with no files listed and no acceptance criteria
- FRs with no corresponding SC (how will we know it's done?)
- User stories with no acceptance scenarios (Given/When/Then)
- Phase 0 unknowns that were never resolved

Findings: Each underspecified item with what information is missing.

---

### Step 3: Severity Assignment

Assign severity to each finding:

| Severity | Meaning | Action Required |
|----------|---------|-----------------|
| **CRITICAL** | Blocks implementation — ambiguity could cause wrong architecture or data model | Must fix before starting implementation |
| **HIGH** | Significant risk — likely to cause bugs, missed requirements, or rework | Strongly recommended to fix before implementation |
| **MEDIUM** | Notable gap — could cause problems but workaround exists | Fix when possible, document if deferring |
| **LOW** | Minor improvement — good to have but low impact | Fix in Polish phase or future iteration |

---

### Step 4: Report Format

Write the analysis report to `{feature_dir}/analysis.md`:

```markdown
# Cross-Artifact Analysis: [Feature Name]
**Date**: YYYY-MM-DD
**Analyst**: Thread (read-only)
**Artifacts analyzed**:
- spec.md (FRs: N, SCs: N, User Stories: N)
- plan.md (tasks: N, constitution checks: N)
- tasks.md (tasks: N)
- constitution.md (principles: N)

## Summary
- **FR coverage**: N% of FRs have at least one task
- **SC coverage**: N% of SCs are verifiable through tasks
- **P1 story coverage**: N% of P1 user stories have P1 tasks
- **Critical findings**: N
- **High findings**: N
- **Total findings**: N

## Findings

| ID | Category | Severity | Location | Summary | Recommendation |
|----|----------|----------|----------|---------|----------------|
| A001 | Coverage Gap | HIGH | FR-003 | No task covers FR-003 (rate limiting) | Add task in Phase 2: User Stories |
| A002 | Ambiguity | CRITICAL | FR-007 | "reasonable response time" — no measurable target | Define as SC — suggest < 200ms p95 |
| A003 | Constitution | HIGH | T015 | Task stores PII in logs, violating Security principle | Remove PII from log statements |

## No Findings Categories
[List any of the 6 passes that found zero issues]

## Metrics
- Semantic model: N FRs, N SCs, N user stories, N tasks, N principles
- Coverage gaps: N FRs uncovered, N SCs unverifiable
- Longest dependency chain: T### → T### → T### (N tasks)
```

**Limits**: Maximum 50 findings total. If more than 50 are found, keep all CRITICAL and HIGH, then top MEDIUM by impact, then sample LOW.

---

### Analysis vs. Review

The analysis step is distinct from the review gates:
- **Analysis** (Thread, step 8): Mechanical consistency check — finds gaps, conflicts, and coverage holes. Produces a findings report. Does NOT block workflow progression.
- **Code Review** (Weft, step 10): Quality judgment after implementation — assesses whether the code is correct, readable, and well-tested. CAN block with `[REJECT]`.
- **Security Review** (Warp, step 11): Security audit after implementation. CAN block with `[REJECT]`.

The analysis report is an INPUT to the implement step — Shuttle should address CRITICAL and HIGH findings during implementation.

</SDDAnalysis>
