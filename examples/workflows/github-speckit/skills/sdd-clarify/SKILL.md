---
name: sdd-clarify
description: "Spec-Driven Development: Ambiguity detection taxonomy, prioritization heuristic, and sequential questioning protocol"
---

<SDDClarify>

## Ambiguity Detection and Clarification

The clarify step resolves ambiguities in a feature spec through structured questioning. The goal is to fill critical gaps before planning begins — not to achieve perfection.

### Ambiguity Taxonomy (11 Categories)

Scan the spec for ambiguities across these categories:

1. **Functional Scope** — Unclear boundaries: what's in vs. out of this feature? What adjacent behaviors are excluded?
2. **Domain/Data** — Undefined entities, unclear relationships, missing data shapes or validation rules
3. **UX Flow** — Unclear user journeys, missing steps between screens/states, ambiguous interaction sequences
4. **Non-Functional** — Missing performance targets, scale assumptions, reliability requirements, or SLA expectations
5. **Integration** — Unspecified interactions with external systems, APIs, or third-party services
6. **Edge Cases** — Unhandled boundary conditions, concurrent access scenarios, failure modes
7. **Constraints** — Unclear business rules, regulatory/compliance requirements, or technical limitations
8. **Terminology** — Ambiguous domain terms that could be interpreted differently by different stakeholders
9. **Completion Signals** — Unclear definition of "done" — how will success be measured in production?
10. **Placeholders** — Explicit `[NEEDS CLARIFICATION]` markers left in the spec
11. **Unresolved** — Conflicting requirements or contradictory assumptions within the spec

### Prioritization Heuristic

For each ambiguity found, score it: **Priority = Impact × Uncertainty**

- **Impact** (1–3): How much does this ambiguity affect architecture, data model, API contracts, test strategy, UX, or compliance?
  - 1 = cosmetic/wording only
  - 2 = affects task breakdown or test coverage
  - 3 = affects architecture, data model, or compliance
- **Uncertainty** (1–3): How unclear is this?
  - 1 = reasonable default is obvious
  - 2 = multiple valid interpretations, no clear winner
  - 3 = fundamentally unknown, must ask

**Only ask about ambiguities with score ≥ 4.** Lower-score ambiguities should be resolved using reasonable defaults.

### Questioning Protocol

**Rules:**
- **Maximum 5 questions** — prioritize the highest-scoring ambiguities
- **One question at a time** — wait for the answer before asking the next
- **Multiple-choice format** — always provide options with a recommended choice
- **One clear recommendation** — mark the best option as `(recommended)` based on common practice

**Question format:**
```
**Question [N]/[max]: [Category]**

[Clear, specific question — what exactly needs to be decided?]

Options:
A. [Option A description] (recommended)
B. [Option B description]
C. [Option C description]
D. Other — please describe
```

**Why multiple-choice?** It anchors the conversation, reduces back-and-forth, and forces the agent to have thought through the options. It also makes it easy for the user to accept a default.

### Spec Update Protocol

After each answer:

1. **Update the spec inline** — find the most relevant section (FR, SC, Edge Cases, Assumptions) and update it to reflect the decision
2. **Record the Q&A** — append to the `## Clarifications` section:

```markdown
## Clarifications

### Session YYYY-MM-DD
**Q1 [Functional Scope]**: [Question text]
**A**: [Answer received]
**Impact**: Updated FR-003 to clarify that [decision]. Added edge case for [scenario].

**Q2 [Domain/Data]**: [Question text]
**A**: [Answer received]
**Impact**: Updated Key Entities — User entity now includes [attribute].
```

### Coverage Summary

After all questions are answered (or the 5-question limit is reached), provide a coverage summary table:

```markdown
## Clarification Coverage Summary
| Category | Status |
|----------|--------|
| Functional Scope | ✅ Resolved |
| Domain/Data | ✅ Resolved |
| UX Flow | ⏭ Deferred (reasonable default applied) |
| Non-Functional | ✅ Resolved |
| Integration | ➖ Not applicable |
| Edge Cases | ✅ Resolved |
| Constraints | ⏭ Deferred |
| Terminology | ✅ Resolved |
| Completion Signals | ✅ Resolved |
| Placeholders | ✅ All [NEEDS CLARIFICATION] markers resolved |
| Unresolved | ✅ No conflicts found |
```

Status values:
- ✅ Resolved — question asked and answered, spec updated
- ⏭ Deferred — reasonable default applied, documented in Assumptions
- ➖ Not applicable — category has no ambiguities in this spec
- ⚠ Outstanding — ambiguity exists but question limit reached (document as risk)

### When to Stop Without Asking

Do NOT ask about ambiguities that:
- Have an obvious industry-standard default (e.g., "should passwords be hashed?" — yes, always)
- Are purely cosmetic (e.g., exact button label text)
- Would only affect P3 (nice-to-have) requirements
- Can be trivially reversed without architectural impact

Document these as Assumptions instead.

</SDDClarify>
