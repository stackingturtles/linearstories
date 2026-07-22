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

The target team and project must already exist in Linear. CLI `--team` and `--project` values override file frontmatter; file frontmatter overrides `defaultTeam` and `defaultProject` from config.

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

Per-issue labels are merged with `defaultLabels`. Because `Epic` changes the issue type, it cannot be a default label. Label names are case-sensitive for exact matching.

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
| Team, project, assignee, status, or existing parent is unresolved | Fails remote preflight before issue mutation |
| Label is missing, belongs only to another team, or has a case/group conflict | Fails remote preflight by default |

Before creating or updating any issue, a normal import resolves all remote prerequisites for the complete input set. If preflight or authorized label creation fails, no issue mutations begin. Epics are mutated before user stories only after the full plan passes.

After successful creation, `linear_id` and `linear_url` are written back to the source file.

### Validation modes

```bash
# Local parsing and hierarchy validation; makes no Linear API calls
linearstories import --dry-run stories/*.md

# Read-only remote validation; creates no labels or issues
linearstories import --preflight stories/*.md
```

`--dry-run` cannot detect missing teams, projects, labels, workflow states, assignees, permissions, or remote epic problems. Use `--preflight` for those checks. A normal import performs the same remote preflight automatically.

### Label resolution and provisioning

Labels are collected and resolved once per effective team. Resolution uses this order:

1. Exact label scoped to the target team
2. Exact workspace label available to all teams

Labels owned exclusively by another team are never applied. Case-only matches and multiple labels from the same label group are reported explicitly rather than silently skipped.

Missing labels are fatal by default and are never created implicitly. Choose one explicit mode when needed:

```bash
# Create unresolved labels for their target teams, then import
linearstories import --create-missing-labels stories/*.md

# Continue without unavailable labels
linearstories import --allow-missing-labels stories/*.md
```

`--create-missing-labels` provisions the exact `Epic` label through the same mechanism as ordinary labels and is idempotent on reruns. Label creation starts only after other preflight checks pass; a creation failure prevents all issue mutations.

`--allow-missing-labels` records unavailable ordinary labels as skipped. The reserved `Epic` label cannot be skipped because it defines the issue type. For updates containing skipped labels, the importer omits label synchronization so it cannot clear labels already present in Linear. Applicable case-only and label-group conflicts remain hard failures because silently choosing a label would be ambiguous.

`--dry-run` cannot be combined with remote validation or label options. `--preflight` cannot be combined with `--create-missing-labels`, and `--create-missing-labels` cannot be combined with `--allow-missing-labels`.

## Project Atlas visualization behavior

Visualize one formatted markdown file without configuration or Linear API access:

```bash
linearstories visualize stories/project.md
```

Project Atlas uses the same parser and exact, case-sensitive issue-type rules as import:

| Markdown content | Visualization |
|------------------|---------------|
| Epic with the exact `Epic` label | Expandable child of the project |
| User story with a valid local `epic` title or identifier | Child of that epic |
| User story with an existing Linear epic identifier not present in the file | Child of a read-only placeholder epic |
| User story without `epic` | Direct child of the project |
| User-story category label other than exact `Epic` | Clickable filter that shows or hides matching stories |
| Checked acceptance criterion | Completed radial mark around its story |
| Missing `linear_id` | Deterministic local display identifier |
| Unknown or ambiguous local epic reference | Command fails before starting the server |

Only the exact `Epic` label is excluded from user-story filters. A differently cased label such as `epic` does not classify an issue as an epic and remains available as a category filter.

Use `Collapse`, `Expand all`, and `Fit view` to navigate the graph. Selecting a node opens its details panel; user stories include acceptance criteria and labels, and imported issues include an `Open in Linear` link when `linear_url` is present. Header totals always describe the complete file, while label filters change only the visible stories.

Issue styling uses three display states: `Done` and `Completed` are completed, `In Progress` and `In-Progress` are in progress, and a story with checked criteria is in progress when its workflow state does not already map to one of those values. Other states display as not started. Project and epic states also derive from the completion state of their parsed descendants.

By default, the command binds to `127.0.0.1:4173` and opens the default browser. Use `--port <port>` to change the port or `--no-open` to suppress browser launch. It does not modify the source markdown. The browser loads D3 and web fonts from public CDNs; issue data remains served by the local process.

## Export behavior

Exported issues retain their `Epic` labels. If an issue has a Linear parent, the serializer writes the parent's stable Linear identifier as `epic` metadata:

```yaml
epic: ENG-42
```

This normalization makes exported hierarchy references stable and re-importable.

## Complete example

See [`templates/user-story.md`](../templates/user-story.md) for an import-ready file containing an epic and child user stories.
