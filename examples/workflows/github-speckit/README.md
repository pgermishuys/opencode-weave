# GitHub Spec Kit — Weave Workflow Package

A [Weave](https://github.com/your-org/weave) workflow package that brings [GitHub Spec Kit](https://github.com/github/spec-kit)'s Spec-Driven Development (SDD) methodology into Weave's multi-agent orchestration system.

Adds **4 mandatory review gates** that Spec Kit lacks — making it suitable for regulated environments that require formal specification artifacts and auditable review checkpoints.

## What This Provides

- **11-step SDD workflow** (`spec-driven`) orchestrated by Weave's workflow engine
- **5 skills** that teach agents the SDD artifact formats and methodology
- **No CLI required** — no Spec Kit CLI, no Python, no shell scripts
- **Review gates** at spec, plan, code, and security checkpoints (Weft + Warp)

## Quick Start

### Step 1: Add to your Weave config

Merge the following into your project's `.opencode/weave-opencode.jsonc`:

```jsonc
{
  "workflows": {
    "directories": ["examples/workflows/github-speckit/workflows"]
  },
  "skill_directories": ["examples/workflows/github-speckit/skills"],
  "agents": {
    "shuttle": {
      "skills": ["sdd-constitution", "sdd-specification", "sdd-clarify"]
    },
    "pattern": {
      "skills": ["sdd-planning"]
    },
    "thread": {
      "skills": ["sdd-analysis"]
    }
  }
}
```

> **Path note**: Adjust the directory paths to match where you placed this package. See `config/weave-opencode.jsonc` for options A, B, and C.

### Step 2: Run the workflow

```
/run-workflow spec-driven "Build user authentication"
```

That's it. Weave handles the rest — agents are assigned, artifacts flow between steps, and review gates pause the workflow if quality thresholds aren't met.

## Configuration

Full example config in [`config/weave-opencode.jsonc`](config/weave-opencode.jsonc).

The key fields:

| Config field | Purpose |
|---|---|
| `workflows.directories` | Points Weave at this package's `workflows/` directory |
| `skill_directories` | Points Weave at this package's `skills/` directory |
| `agents.shuttle.skills` | Gives Shuttle the constitution/spec/clarify formats |
| `agents.pattern.skills` | Gives Pattern the SDD plan format |
| `agents.thread.skills` | Gives Thread the analysis methodology |

## Workflow Steps

The `spec-driven` workflow has 11 steps:

| # | Step | Type | Agent | What it does |
|---|------|------|-------|-------------|
| 1 | Constitution | interactive | Shuttle | Create/update `.specify/memory/constitution.md` — the governance document |
| 2 | Specify | autonomous | Shuttle | Write feature spec at `.specify/features/{slug}/spec.md` (FR-001, SC-001 format) |
| 3 | **Spec Review** | **gate** | **Weft** | Review spec for completeness and constitution alignment — pauses on [REJECT] |
| 4 | Clarify | interactive | Shuttle | Resolve ambiguities via structured questioning (11-category taxonomy, max 5 questions) |
| 5 | Plan | autonomous | Pattern | Create SDD plan + Weave execution plan |
| 6 | **Plan Review** | **gate** | **Weft** | Review plan for spec coverage and feasibility — pauses on [REJECT] |
| 7 | Tasks | autonomous | Shuttle | Generate granular task list (T001 [P1] [US1] format) |
| 8 | Analyze | autonomous | Thread | Read-only cross-artifact consistency analysis (6 detection passes) |
| 9 | Implement | autonomous | Shuttle | Execute tasks phase by phase, checking off as it goes |
| 10 | **Code Review** | **gate** | **Weft** | Review implementation against spec — pauses on [REJECT] |
| 11 | **Security Review** | **gate** | **Warp** | OWASP Top 10 audit + credential safety — pauses on [REJECT] |

Gates marked in **bold** are blocking — the workflow pauses and waits for human action if a gate rejects.

## Artifact Structure

After running the workflow, your project will have:

```
.specify/
└── memory/
│   └── constitution.md        # Project governance (Step 1)
└── features/
    └── {slug}/
        ├── spec.md             # Feature specification (Step 2)
        ├── checklists/
        │   └── requirements.md # Quality checklist (Step 2)
        ├── plan.md             # SDD implementation plan (Step 5)
        ├── tasks.md            # Granular task list (Step 7)
        ├── analysis.md         # Cross-artifact findings (Step 8)
        └── research.md         # Phase 0 research (Step 5, if needed)

.weave/
└── plans/
    └── {slug}.md               # Weave execution plan (Step 5)
```

## Skills Reference

| Skill | Teaches | Used by |
|-------|---------|---------|
| `sdd-constitution` | Constitution template, versioning rules (semver), Sync Impact Report format, quality rules | Shuttle (Step 1) |
| `sdd-specification` | Spec format (FR-001, SC-001, P1/P2/P3 stories), quality validation checklist, reasonable defaults | Shuttle (Step 2) |
| `sdd-clarify` | 11-category ambiguity taxonomy, prioritization heuristic (Impact × Uncertainty), questioning protocol | Shuttle (Step 4) |
| `sdd-planning` | SDD plan format (Phase 0/1), constitution check gates, Weave plan bridge format, task T### format | Pattern (Step 5) |
| `sdd-analysis` | Semantic model building, 6 detection passes, severity assignment (CRITICAL/HIGH/MEDIUM/LOW), report format | Thread (Step 8) |

## Design Decisions

### Why separate `.specify/` from `.weave/`?

- `.specify/` = SDD specification artifacts (specs, plans, research, data models) — belongs to the feature
- `.weave/` = Weave execution artifacts (plans with checkboxes, state, learnings) — belongs to the execution engine
- The Weave plan at `.weave/plans/{slug}.md` bridges the two: it's the Tapestry-executable version of the SDD plan

### Why 11 steps instead of Spec Kit's 7?

Spec Kit has 7 phases: constitution → specify → clarify → plan → tasks → implement (+ optional analyze). This package adds 4 mandatory review gates:

1. **Spec review** (after specify) — catches bad specs before planning wastes effort
2. **Plan review** (after plan) — catches infeasible plans before task generation
3. **Code review** (after implement) — enforces quality before security review
4. **Security audit** (after implement) — mandatory for regulated environments; Spec Kit has none

### Why not use Spec Kit's CLI?

This package is configuration-only — no CLI, no Python, no shell scripts. All orchestration is handled by Weave's workflow engine. This makes it work in any environment where Weave runs.

### Agent assignments

| Agent | Role |
|-------|------|
| **Shuttle** | Full tool access for file creation and editing — handles constitution, spec, clarify, tasks, implement |
| **Pattern** | Specialist planner — reads code, produces `.weave/plans/*.md`, never implements |
| **Thread** | Read-only explorer — cross-artifact analysis without modifying anything |
| **Weft** | Code reviewer — produces [APPROVE]/[REJECT] verdicts at gate steps |
| **Warp** | Security auditor — OWASP checks, credential safety, constitution compliance |

## Upstream

Based on [github/spec-kit](https://github.com/github/spec-kit) @ `f8da535` (2026-03-27).

Check for updates: https://github.com/github/spec-kit/releases

> An automated GitHub Action (`speckit-upstream-check.yml`) runs monthly and opens an issue if the upstream has changed since this version was pinned. See `.github/workflows/speckit-upstream-check.yml`.
