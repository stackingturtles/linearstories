# Linear Issue Markdown Format

Reference for the markdown format consumed by the `linearstories` CLI.

## Two-level hierarchy

The format supports two issue types:

| Level | Type | Identification | Required content | Linear relationship |
|-------|------|----------------|------------------|---------------------|
| 1 | Epic | Per-issue `labels` contains the exact label `Epic` | High-level goal, scope, and `### Why is this needed?` | Top-level issue |
| 2 | User story | Per-issue `labels` does not contain `Epic` | Description and `### Acceptance Criteria` checkbox list | Optional sub-issue of an epic |

The `epic` metadata field is optional, so standalone user stories remain supported. When it is present, `linearstories` creates a native Linear issue-to-sub-issue link to the referenced epic.

The `Epic` label is a type discriminator. It must be set in an individual issue's metadata and must not be configured in `defaultLabels`.

## File structure

A file can contain any number of epics and user stories. Each H2 block represents one Linear issue.

````markdown
---
project: "Project Name"
team: "Team Name"
---

## Account access

```yaml
linear_id:
linear_url:
priority: 2
labels: [Epic, Auth]
status: Backlog
```

Provide secure account access across the product.

### Scope

- Login
- Password recovery

### Why is this needed?

Users need a consistent authentication boundary before they can use protected features.

## As a user, I want to log in so that I can access my account

```yaml
linear_id:
linear_url:
epic: Account access
priority: 2
labels: [Feature, Auth]
estimate: 3
assignee: jane@company.com
status: Backlog
```

Allow registered users to authenticate with email and password.

### Acceptance Criteria

- [ ] Valid credentials create an authenticated session
- [ ] Invalid credentials show an error without revealing which field was incorrect
````

## Frontmatter

Optional YAML frontmatter sets defaults for every issue in the file.

| Field | Type | Description |
|-------|------|-------------|
| `project` | string | Default Linear project name |
| `team` | string | Default Linear team name |

## Issue heading

Each issue starts with an H2 heading (`## `). The heading text becomes the Linear issue title.

Epic titles should name a high-level product capability or goal. User story titles should normally use `As a [role], I want [goal] so that [benefit]`.

## Metadata block

Place a fenced YAML block immediately after the H2 heading. All general metadata fields are optional.

| Field | Type | Values / notes |
|-------|------|----------------|
| `linear_id` | string | Linear identifier such as `ENG-42`. Auto-filled after creation. |
| `linear_url` | string | Linear issue URL. Auto-filled after creation. |
| `epic` | string | Optional parent reference for a user story. Use a Linear identifier or the exact title of an epic included in the same import command. Not allowed on epics. |
| `priority` | number | `0` None, `1` Urgent, `2` High, `3` Normal, `4` Low |
| `labels` | string[] | Linear label names. The exact `Epic` label identifies an epic. |
| `estimate` | number | Story points. |
| `assignee` | string | Email address or display name. |
| `status` | string | Workflow state such as `Backlog`, `Todo`, `In Progress`, or `Done`. |

Per-issue labels are merged with `defaultLabels`. Because `Epic` changes the issue type, it cannot be a default label.

## Epic format

An epic is an issue whose per-issue labels include `Epic` exactly.

````markdown
## Account access

```yaml
labels: [Epic, Auth]
priority: 2
```

Provide secure account access across the product.

### Scope

- Login
- Password recovery

### Why is this needed?

Users need a consistent authentication boundary before they can use protected features.
````

Epic rules:

- Include the exact `Epic` label in the issue metadata.
- Do not include an `epic` metadata property. Epics are the top level.
- Do not include an `### Acceptance Criteria` section.
- Include a substantive `### Why is this needed?` section that explains the user, business, operational, or technical outcome.
- Describe the high-level goal and scope clearly enough to evaluate whether child stories belong to the epic.

The importer rejects nested epics and epics with acceptance criteria. The `/rate-userstories` skill uses a separate epic rubric and scores a missing or empty `Why is this needed?` section as zero for epic rationale, which prevents the epic from reaching the 80% pass threshold.

## User story format

A user story is any issue whose per-issue labels do not include `Epic`.

````markdown
## As a user, I want to log in so that I can access my account

```yaml
epic: ENG-42
labels: [Feature, Auth]
estimate: 3
```

Allow registered users to authenticate with email and password.

### Acceptance Criteria

- [ ] Valid credentials create an authenticated session
- [ ] Invalid credentials show an error without revealing which field was incorrect
````

User story rules:

- Do not include the `Epic` label.
- Include an `### Acceptance Criteria` section with at least one checkbox item.
- Use `epic` to link the story to a parent, or omit it for a standalone story.
- Do not use `epic` to reference another user story.

## Parent references

The `epic` property supports two reference forms:

| Form | Example | Use when |
|------|---------|----------|
| Linear identifier | `epic: ENG-42` | The epic already exists in Linear. Preferred for stable round trips. |
| Exact local title | `epic: Account access` | The epic is included among the files passed to the same import command. |

Local title references are resolved across all files in one import invocation, not just within the child's file. Titles must match exactly and must be unambiguous.

For an existing Linear identifier, the importer verifies that the referenced issue:

- Exists
- Has the exact `Epic` label
- Does not itself have a parent

If any check fails, the child story fails and is not created or updated.

## Body

Everything after the metadata block until the next H2 heading or end of file becomes the Linear issue description. Standard markdown is supported.

Epics use the body for goals, scope, context, constraints, and rationale. User stories use it for implementation context and acceptance criteria.

## Import behavior

The importer parses all input files before making changes. It processes epics first, then user stories, so a new epic and its children can be created in one command regardless of source file order.

| Condition | Behavior |
|-----------|----------|
| Empty or missing `linear_id` | Creates a new Linear issue |
| Present `linear_id` | Updates the existing Linear issue |
| User story has `epic` | Sets Linear `parentId`, creating a native sub-issue link |
| User story omits `epic` | Creates or updates a standalone issue |
| Epic contains acceptance criteria | Fails that epic |
| User story lacks an acceptance-criteria checklist | Fails that user story |
| Epic references another epic | Fails that epic |
| Parent reference is missing, ambiguous, nested, or not Epic-labelled | Fails the child story |

After successful creation, `linear_id` and `linear_url` are written back to the source file. A dry run performs local structure and hierarchy checks without calling Linear, so remote parent existence and labels are verified only during a real import.

## Export behavior

Exported issues retain their `Epic` labels. If an issue has a Linear parent, the serializer writes the parent's stable Linear identifier as `epic` metadata:

```yaml
epic: ENG-42
```

This normalization makes exported hierarchy references stable and re-importable.

## Complete example

See [`templates/user-story.md`](../templates/user-story.md) for an import-ready file containing an epic and child user stories.
