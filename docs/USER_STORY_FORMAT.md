# User Story Markdown Format

Reference for the markdown format consumed by the `linearstories` CLI.

## File structure

```
---                          ← optional YAML frontmatter
project: "Project Name"
team: "Team Name"
---

## Story title               ← H2 = one story (multiple per file OK)

```yaml                      ← optional metadata block
linear_id:
linear_url:
priority: 2
labels: [Feature, Auth]
estimate: 3
assignee: jane@company.com
status: Backlog
```

Description text.            ← body (markdown), becomes Linear issue description

### Acceptance Criteria      ← H3 heading, part of body

- [ ] First criterion
- [ ] Second criterion
```

## Frontmatter

Optional. Sets defaults for all stories in the file.

| Field     | Type   | Description          |
|-----------|--------|----------------------|
| `project` | string | Default project name |
| `team`    | string | Default team name    |

## Story heading

Each story starts with `## `. The heading text becomes the Linear issue title.

Recommended format: `As a [role], I want [goal] so that [benefit]`

## Metadata block

Fenced YAML block (` ```yaml ` ... ` ``` `) immediately after the H2 heading. All fields optional.

| Field        | Type     | Values / Notes                                         |
|--------------|----------|--------------------------------------------------------|
| `linear_id`  | string   | Linear identifier (e.g. `ENG-42`). Auto-filled on import. Leave empty for new stories. |
| `linear_url` | string   | Linear URL. Auto-filled on import. Leave empty for new stories. |
| `priority`   | number   | `0` None, `1` Urgent, `2` High, `3` Normal, `4` Low   |
| `labels`     | string[] | Label names. Merged with `defaultLabels` from config.  |
| `estimate`   | number   | Story points.                                          |
| `assignee`   | string   | Email or display name.                                 |
| `status`     | string   | Workflow state: `Backlog`, `Todo`, `In Progress`, `Done`, etc. |

## Body

Everything after the metadata block until the next `## ` or end-of-file. Standard markdown. Becomes the Linear issue description.

## Acceptance criteria

Convention: use an `### Acceptance Criteria` heading with a checkbox list. This section is part of the body and is included in the issue description.

```markdown
### Acceptance Criteria

- [ ] Criterion one
- [ ] Criterion two
```

## Minimal example

```markdown
## Add logout button

Description of the feature.

### Acceptance Criteria

- [ ] Logout button visible on all authenticated pages
- [ ] Clicking logout clears the session and redirects to login
```

## Full example

````markdown
---
project: "Q1 2026 Release"
team: "Engineering"
---

## As a user, I want to log in so that I can access my account

```yaml
linear_id:
linear_url:
priority: 2
labels: [Feature, Auth]
estimate: 3
assignee: jane@company.com
status: Backlog
```

User should be able to log in with their email and password.

### Acceptance Criteria

- [ ] User can enter email and password on the login page
- [ ] Invalid credentials show a clear error message
- [ ] User is redirected to the dashboard on successful login

## As a user, I want to reset my password so that I can regain access

```yaml
linear_id:
linear_url:
priority: 3
labels: [Feature, Auth]
estimate: 2
```

User should be able to reset their password via email link.

### Acceptance Criteria

- [ ] User can request a password reset from the login page
- [ ] Reset email is sent within 60 seconds
- [ ] Reset link expires after 24 hours
````

## Import behavior

| `linear_id` state | Action                   |
|--------------------|--------------------------|
| Empty or missing   | Creates a new issue      |
| Present            | Updates the existing issue |

After import, `linear_id` and `linear_url` are written back into the file.
