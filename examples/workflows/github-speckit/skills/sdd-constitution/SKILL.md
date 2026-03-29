---
name: sdd-constitution
description: "Spec-Driven Development: Constitution format, versioning rules, and governance methodology"
---

<SDDConstitution>

## Constitution Format

The constitution lives at `.specify/memory/constitution.md` and defines project principles that govern all downstream artifacts — specs, plans, and tasks must all comply with it.

### Template Structure

```markdown
# [PROJECT_NAME] Constitution
**Version**: X.Y.Z | **Ratified**: YYYY-MM-DD | **Last Amended**: YYYY-MM-DD

## Core Principles

### [PRINCIPLE_NAME]
[Description using MUST/SHOULD language]
**Rationale**: [Why this principle exists and what problems it prevents]

## Governance
**Amendment procedure**: [How to propose and ratify changes]
**Versioning policy**: Semantic versioning — MAJOR.MINOR.PATCH
**Compliance review**: [When and how compliance is assessed]
```

### Versioning Rules (Semantic)

- **MAJOR** (X.0.0): Backward-incompatible changes — removing or fundamentally redefining a principle
- **MINOR** (X.Y.0): Additive changes — new principle, new section, or materially expanded scope
- **PATCH** (X.Y.Z): Non-breaking changes — clarifications, wording improvements, typo fixes

### Sync Impact Report

When updating an existing constitution, prepend a Sync Impact Report as an HTML comment before the document:

```html
<!-- Sync Impact Report
Version change: X.Y.Z → X.Y.Z
Modified principles: [principle name: old behavior → new behavior]
Added sections: [list or "none"]
Removed sections: [list or "none"]
Follow-up TODOs: [list of downstream artifacts that need review, or "none"]
-->
```

### Quality Rules

- **Declarative and testable**: Each principle must describe a verifiable behavior or constraint
- **MUST/SHOULD language**: Use MUST for non-negotiable requirements, SHOULD for strong recommendations
- **Explicit rationale**: Every principle needs a "why" — what problem does it prevent?
- **Concise**: 3–7 principles (fewer is better; too many means poor prioritization)
- **ISO dates**: All dates in YYYY-MM-DD format
- **No implementation details**: Principles govern behavior, not technology choices

### Example Constitution

```markdown
# MyApp Constitution
**Version**: 1.2.0 | **Ratified**: 2025-01-15 | **Last Amended**: 2025-06-01

## Core Principles

### Code Quality
All production code MUST have automated tests covering the critical path.
New features SHOULD achieve ≥80% line coverage.
**Rationale**: Untested code is a liability that slows future changes and causes regressions.

### Security First
User data MUST be encrypted at rest and in transit.
Authentication tokens MUST have an expiry of ≤24 hours.
**Rationale**: Security failures erode user trust and create legal liability.

### Performance
API responses MUST complete within 500ms at p95 under normal load.
**Rationale**: Slow responses directly reduce user engagement and retention.

## Governance
**Amendment procedure**: Propose via PR, require 2 reviewer approvals, ratified when merged.
**Versioning policy**: Semantic versioning — MAJOR for removals, MINOR for additions, PATCH for fixes.
**Compliance review**: Reviewed at each quarterly planning cycle.
```

</SDDConstitution>
