# `/rate-userstories` - Epic and User Story Quality Evaluator

A coding-agent skill that evaluates epics and user stories in the [linearstories format](./USER_STORY_FORMAT.md), detects contradictions within and across issues, and emits reviewable replacement markdown.

## Usage

```text
/rate-userstories <path-to-markdown-file>
```

Examples:

```bash
/rate-userstories stories/q1-2026.md
/rate-userstories /Users/team/project/userstories.md
/rate-userstories templates/user-story.md
```

## Issue classification

The skill reads the entire document before scoring and classifies each H2 issue block from its own metadata:

| Type | Classification rule | Quality target |
|------|---------------------|----------------|
| Epic | `labels` includes the exact label `Epic` | Clear goal, bounded scope, and explicit rationale |
| User story | `labels` does not include `Epic` | Concrete description and testable acceptance criteria |

Epics and user stories are not graded with the same rubric. In particular, epics must not be penalized for having no acceptance criteria because epics are not supposed to contain them.

## Structural validation

Before scoring, the skill verifies the canonical format and hierarchy rules.

Every issue requires:

- An H2 title
- An optional fenced `yaml` metadata block immediately after the title
- A meaningful body

Epics require:

- The exact `Epic` label in per-issue metadata
- No `epic` parent property
- No `### Acceptance Criteria` section
- A high-level goal and enough scope to understand what child stories belong

User stories require:

- No `Epic` label
- An `### Acceptance Criteria` section with checkbox items (`- [ ] ...`)
- An optional `epic` parent reference when the story belongs to an epic

A malformed hierarchy, nested epic, epic containing acceptance criteria, or user story missing acceptance criteria is a structural failure. A missing `### Why is this needed?` section is handled by the epic quality score rather than as a structural hard fail.

## User story rubric

User stories are scored from 0-100%:

| Dimension | Weight | What it measures |
|-----------|--------|------------------|
| Specificity | 30% | Concrete values, states, actors, and boundaries rather than vague language |
| Testability | 35% | Whether each criterion has a clear pass/fail result |
| Completeness | 25% | Happy path, errors, edge cases, and scope coverage |
| Description quality | 10% | Context needed to understand intent and constraints |

## Epic rubric

Epics are scored from 0-100% using an epic-specific rubric:

| Dimension | Weight | What it measures |
|-----------|--------|------------------|
| Goal clarity | 30% | A concrete high-level capability or outcome with identifiable beneficiaries |
| Scope and decomposition | 30% | Boundaries, major workstreams, exclusions, and enough structure to assess child-story fit |
| Rationale | 30% | A substantive `### Why is this needed?` section explaining user, business, operational, or technical value |
| Description quality | 10% | Context, constraints, domain language, and dependencies needed to understand the epic |

If `### Why is this needed?` is missing or empty, the epic receives **0/30 for Rationale**. Its maximum possible score is therefore 70%, below the 80% pass threshold. The replacement markdown must add a proposed rationale for human review without presenting the proposal as authoritative product truth.

## Contradiction detection

Contradiction detection is a hard-fail rule, not a weighted scoring dimension. Any hard contradiction fails every affected issue even if its numeric score is 80% or higher.

The skill compares the full document, including:

- Title against body and sections within one issue
- Acceptance criterion against acceptance criterion
- Epic goal, scope, constraints, and rationale against child user stories
- User story against its referenced local epic
- Every epic and user story against other issues in the same document

### Hard contradictions

Requirements for the same entity, workflow, or feature area that cannot both be true.

Examples:

- An epic says authentication is SSO-only while a child story requires email and password login
- Epic scope excludes password recovery while a linked story implements password recovery
- One story requires redirecting to `/dashboard` while another requires remaining on the login page after the same successful action
- One issue says reset links expire after 24 hours while another says 15 minutes for the same reset flow
- One issue permits withdrawals at any time while another locks all withdrawals during vesting for the same token

### Tensions

Potentially conflicting assumptions that are not yet mutually exclusive. Tensions are warnings and do not fail an issue.

Examples:

- An account-closure story permanently deletes data while an audit epic requires long-term transaction retention, but the retained data categories are not defined
- A performance epic minimizes storage writes while an observability story emits an event for every state change

For every hard contradiction, the skill proposes one consistent normalization for the replacement markdown and states what it chose and discarded. A human reviewer decides the product truth.

## Pass and fail rules

An issue passes only when all of the following are true:

- Its type-specific score is 80% or higher
- It is structurally valid for its type
- It has no hard contradiction within itself
- It does not hard-contradict another issue in the document

Tensions are reported as warnings and do not cause failure.

## User story anti-patterns

The skill flags acceptance criteria containing subjective or unquantified language:

- Subjective UI language: "easy to use", "clean UI", "looks good", "modern design"
- Unquantified performance: "fast", "responsive", "smooth" without a threshold
- Weasel words: "properly handles", "appropriate", "reasonable", "robust"
- Ambiguous scope: "etc.", "as needed", "where applicable", "various"

Each flagged criterion receives an explanation and a concrete rewrite.

When visual criteria are unverifiable, the skill recommends creating a style guide with measurable color, spacing, typography, and component rules.

## Epic anti-patterns

The skill flags epics that:

- Describe a solution without identifying the outcome or beneficiary
- Use unbounded scope such as "support everything" or "handle all cases"
- Duplicate implementation-level acceptance criteria instead of defining a high-level boundary
- Lack major workstreams or provide no basis for deciding whether a child belongs
- State a rationale as circular restatement of the title
- Use a placeholder `Why is this needed?` section without substantive value

## Output format

The report contains:

1. **Summary table** - issue title, type, score, pass/fail, and primary reason
2. **Hierarchy review** - epic-to-story links, unresolved or invalid references, and orphan/standalone stories
3. **Contradictions and tensions** - severity, affected issues, conflicting statements, explanation, and hard-contradiction normalization choice
4. **Detailed breakdown with inline replacement markdown** - type-specific scores, failure reasons, flagged content, additions, and a complete proposed replacement immediately after each failed issue
5. **Style guide recommendation** - only when visual criteria require one
6. **Passing issues** - concise notes on strengths and minor improvements

## Replacement markdown

Replacement blocks are proposals for human review. They do not modify the source document automatically.

Every replacement must:

- Preserve valid metadata, including `linear_id`, `linear_url`, `labels`, and `epic`
- Use the canonical structure from [USER_STORY_FORMAT.md](./USER_STORY_FORMAT.md)
- Resolve all reported hard contradictions consistently across affected blocks
- Be complete enough to replace the original H2 issue block

Epic replacements must:

- Retain the exact `Epic` label
- Contain no acceptance criteria
- Include a clear goal, scope, and substantive `### Why is this needed?` section

User story replacements must:

- Retain a valid `epic` parent reference when present
- Contain a description and `### Acceptance Criteria` checkbox list
- Use criteria specific enough for implementation and pass/fail verification

## Installation

The project-local command lives at `.claude/commands/rate-userstories.md`. The agent skill can also be installed at `~/.agents/skills/rate-userstories/SKILL.md`.
