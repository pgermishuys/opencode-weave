---
name: sdd-specification
description: "Spec-Driven Development: Feature specification format, quality validation checklist, and requirement writing rules"
---

<SDDSpecification>

## Feature Specification Format

Specs live at `.specify/features/{slug}/spec.md` where `{slug}` is the feature name in lowercase with hyphens (e.g., `user-authentication`).

### Mandatory Sections

All feature specs MUST contain these sections:

#### 1. Header
```markdown
# Feature: [Name]
**Status**: Draft | In Review | Approved | Implemented
**Version**: 0.1.0
**Goal**: [One sentence — what user problem does this solve?]
```

#### 2. User Scenarios (P1/P2/P3 priority)
```markdown
## User Scenarios
- **[US1] [P1]** As a [role], I want to [action] so that [outcome]
  - **Given** [precondition], **When** [action], **Then** [observable outcome]
- **[US2] [P2]** As a [role], I want to [action] so that [outcome]
  - **Given** [precondition], **When** [action], **Then** [observable outcome]
```
Priority: P1 = must-have, P2 = should-have, P3 = nice-to-have

#### 3. Functional Requirements (FR-001 format)
```markdown
## Functional Requirements
- **[FR-001]** The system MUST [behavior] [when condition / so that outcome]
- **[FR-002]** The system SHOULD [behavior] [context]
- **[FR-003]** [NEEDS CLARIFICATION] The system MUST [behavior] — unclear whether [ambiguity]
```
Rules: MUST for non-negotiable, SHOULD for important-but-flexible. Maximum **3** `[NEEDS CLARIFICATION]` markers.

#### 4. Success Criteria (SC-001 format)
```markdown
## Success Criteria
- **[SC-001]** [Measurable, technology-agnostic criterion]
- **[SC-002]** [Criterion that can be objectively verified]
```

#### 5. Edge Cases
```markdown
## Edge Cases
- [Boundary condition]: [Expected behavior]
- [Error scenario]: [How the system responds]
- [Concurrent access scenario]: [Expected outcome]
```

#### 6. Key Entities (if data is involved)
```markdown
## Key Entities
- **[EntityName]**: [Description]
  - Attributes: [name: type, name: type]
  - Relationships: [belongs to X, has many Y]
  - Constraints: [unique on X, required Y]
```

#### 7. Assumptions
```markdown
## Assumptions
- [Reasonable default that was assumed without asking — documented for transparency]
```

### Quality Validation Checklist

Before marking a spec ready for review:

- [ ] All mandatory sections are present
- [ ] All FRs are testable (not vague — "fast" is not testable, "< 500ms p95" is)
- [ ] No implementation details in requirements (says WHAT, not HOW)
- [ ] User value is clear in every user story
- [ ] Success criteria are measurable and technology-agnostic
- [ ] Edge cases cover error scenarios and boundary conditions
- [ ] Maximum 3 `[NEEDS CLARIFICATION]` markers (more = spec not ready)
- [ ] Constitution alignment verified (no principle violated)
- [ ] Assumptions documented (not hidden)
- [ ] Each user story has at least one FR

### Reasonable Defaults (Do Not Ask About These)

When writing specs, assume these defaults without asking the user:

- **Data retention**: Standard retention per platform defaults unless compliance requires otherwise
- **Performance**: 500ms p95 for API responses, 3s for page loads
- **Error handling**: Show user-friendly messages, log technical details
- **Authentication**: Use existing project auth method (JWT/session/OAuth as applicable)
- **Pagination**: Default page size 20, maximum 100
- **Logging**: Log errors and key business events

### Clarifications Section

After the clarification step, a `## Clarifications` section is appended:
```markdown
## Clarifications
### Session YYYY-MM-DD
**Q**: [Question asked]
**A**: [Answer received]
**Impact**: [Which FR/SC was updated and how]
```

</SDDSpecification>
