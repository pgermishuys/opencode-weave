---
name: sdd-planning
description: "Spec-Driven Development: Implementation planning format, constitution check gates, and Weave plan bridge"
---

<SDDPlanning>

## SDD Implementation Planning

Planning in Spec-Driven Development produces **two complementary artifacts**:

1. **SDD Plan** at `.specify/features/{slug}/plan.md` — the technical design document
2. **Weave Plan** at `.weave/plans/{slug}.md` — the Tapestry-executable task checklist

Both must be created. The Weave plan bridges SDD methodology with Weave's execution engine.

---

### SDD Plan Format (`.specify/features/{slug}/plan.md`)

```markdown
# Implementation Plan: [Feature Name]
**Feature**: [{slug}](./)
**Status**: Draft | Approved
**Spec**: [spec.md](./spec.md)

## Technical Context
- **Stack**: [languages, frameworks, databases, runtimes]
- **Architecture pattern**: [MVC / layered / event-driven / etc.]
- **Key dependencies**: [list any new dependencies required]
- **Unknowns**: [mark as UNKNOWN — resolved in Phase 0]

## Constitution Check
| Principle | Status | Notes |
|-----------|--------|-------|
| [Principle Name] | ✅ Complies | [how] |
| [Principle Name] | ⚠ Partial | [gap and mitigation] |
| [Principle Name] | ❌ Violation | [BLOCKING — must resolve before proceeding] |

**Rule**: Any ❌ violation blocks the plan. Fix the violation or amend the constitution before continuing.

## Phase 0: Research
*Resolve all UNKNOWN items from Technical Context before designing.*

- [ ] Research [UNKNOWN item] → output findings to `./research.md`
- [ ] Investigate [integration point] → document API/contract details
- [ ] Spike [technical uncertainty] → prototype approach, document decision

## Phase 1: Design

### Data Model (`./data-model.md`)
For each entity:
```
Entity: [Name]
- id: UUID (primary key)
- [attribute]: [type] ([constraints: required, unique, indexed])
- created_at: timestamp
Relationships:
- belongs_to [ParentEntity] via [foreign_key]
- has_many [ChildEntities]
```

### API Contracts (if applicable)
For each endpoint:
```
[METHOD] /path/{param}
Request: { field: type }
Response 200: { field: type }
Response 4xx: { error: string, code: string }
Auth: required / none
```
```

---

### Weave Plan Format (`.weave/plans/{slug}.md`)

The Weave plan is the Tapestry-executable version. It must follow Weave's standard plan structure:

```markdown
# [Feature Name] — Implementation Plan

## TL;DR
> [One sentence summary of what will be built and why]

## Context

### Feature
[Brief description of the feature and its goal]

### Spec reference
[Link to spec: `.specify/features/{slug}/spec.md`]

### Key technical decisions
[1-3 bullets on the key architectural decisions from the SDD plan]

## Objectives
- [ ] [Deliverable 1]
- [ ] [Deliverable 2]
- [ ] [Deliverable 3]

## TODOs

### Phase 0: Setup
- [ ] T001 [P1] [US0] Scaffold directory structure and dependencies

### Phase 1: Foundation
- [ ] T002 [P1] [US1] Create [core entity] data model

### Phase 2: User Stories
- [ ] T003 [P1] [US1] Implement [user story 1 behavior]
- [ ] T004 [P2] [US2] Implement [user story 2 behavior]

### Phase 3: Polish
- [ ] T005 [P1] [US1] Handle [edge case from spec]
- [ ] T006 [P2] [US2] Add error messages per spec SC-003

## Verification
- [ ] All FRs in spec.md have corresponding passing tests
- [ ] All SCs in spec.md are verifiable
- [ ] Constitution compliance confirmed
```

### Task Format Reference

Tasks in the Weave plan follow this format:
```
- [ ] T### [P1/P2/P3] [US#] Task description
```

- `T###`: Sequential number (T001, T002, ...)
- `[P1/P2/P3]`: Priority (P1 = must-have FR, P2 = should-have, P3 = nice-to-have)
- `[US#]`: User story reference from the spec (US1, US2, ...)
- Description: What to build — specific enough to be independently verifiable

### Phase Organization

| Phase | Purpose |
|-------|---------|
| Setup (T001–T010) | Scaffolding, dependencies, project config, directory structure |
| Foundation (T011–T030) | Core data models, base components, shared utilities, DB migrations |
| User Stories (T031–T080) | One group per user story — grouped by US1, US2, ... |
| Polish (T081–T099) | Error handling, edge cases, performance, documentation, cleanup |

---

### Constitution Check Protocol

Before writing any plan tasks, read the constitution and check each principle:

1. **Identify relevant principles** — which principles apply to this feature?
2. **Check compliance** — will the planned implementation comply?
3. **Mark status** — ✅ complies, ⚠ partial (document mitigation), ❌ violation (BLOCKING)
4. **Stop on ❌** — a constitutional violation must be resolved before the plan can proceed

If a violation is found, report it clearly:
```
## ❌ CONSTITUTIONAL VIOLATION DETECTED

**Principle**: [Principle Name]
**Violation**: [What the planned implementation would do that violates this principle]
**Resolution options**:
1. Change the implementation approach to [alternative]
2. Amend the constitution to allow [exception] (requires ratification)
3. Defer this feature until the violation is resolved
```

</SDDPlanning>
