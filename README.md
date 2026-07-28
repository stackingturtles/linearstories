# linearstories

A CLI tool that bridges markdown-based epics and user stories with Linear issues, preserving a two-level hierarchy and enforcing acceptance criteria discipline for AI agent-driven development.

## Why structured acceptance criteria matter for AI agents

AI coding agents -- Claude Code, Cursor, Copilot Workspace, and others -- perform dramatically better when given precise, testable acceptance criteria. Vague tickets like "improve the login flow" lead to ambiguous implementations and wasted iteration cycles. Structured user stories with explicit acceptance criteria give agents the deterministic guardrails they need:

- **Clear scope boundaries.** Each acceptance criterion is a discrete, verifiable condition. Agents can work through them one at a time and know when they are done.
- **Testable by default.** Criteria written as checkboxes (`- [ ] ...`) map directly to test cases. Agents can generate tests that match the specification.
- **Markdown as the source of truth.** Stories live in your repository alongside the code. Agents can read them directly without API access to your project management tool.
- **Two-way sync with Linear.** Engineering managers keep their board current; agents keep their specs current. Neither workflow is disrupted.

`linearstories` closes the gap between how AI agents consume work (structured markdown files in a repo) and how engineering teams manage work (Linear issues on a board).

## Quick start

### 1. Install for regular use

Install globally with Bun, then run the `linearstories` executable directly:

```bash
bun install -g linearstories
linearstories --version
```

Alternatively, download a compiled binary for your platform from the [releases page](https://github.com/stackingturtles/linearstories/releases) and place it on your `PATH`, or build from source:

```bash
bun install
bun build src/cli/index.ts --compile --outfile linearstories
```

Place the resulting executable on your `PATH` before invoking `linearstories` from other directories.

For a one-off trial without installing, use `bunx`:

```bash
bunx linearstories import stories/*.md
```

For regular use, prefer the installed `linearstories` command. It starts directly and keeps the version you installed explicit rather than resolving a package through `bunx` on each environment.

### 2. Create a context

Run the interactive setup. It masks the API token while you type and stores the resulting config in the correct location:

```bash
linearstories initctx
```

The wizard captures a context name, API token, default team, default project, and default labels. With no existing config, it creates `~/.config/linearstories/config.json`. You can leave the token blank when `LINEAR_API_KEY` is set.

Update that context later without locating or editing the config file:

```bash
linearstories updatectx work
```

Delete an obsolete context with a confirmation prompt:

```bash
linearstories deletectx work
```

### 3. Write your first story

Create a file called `stories/login.md`:

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
The system should support rate limiting after 5 failed attempts.

### Acceptance Criteria

- [ ] User can enter email and password on the login page
- [ ] Invalid credentials show a clear error message
- [ ] User is redirected to the dashboard on successful login
- [ ] Account locks after 5 consecutive failed attempts
````

### 4. Import to Linear

```bash
linearstories import stories/login.md
```

The CLI creates issues in Linear and writes the `linear_id` and `linear_url` back into your markdown file so that subsequent imports update the existing issues rather than creating duplicates.

### 5. Visualize the hierarchy

Launch the built-in Project Atlas for a single LinearStories markdown file:

```bash
linearstories visualize stories/login.md
```

The command parses the file locally, starts a server at `http://127.0.0.1:4173`, and opens Project Atlas in your default browser. It displays project-to-epic-to-story links, standalone stories, status, and acceptance-criteria completion without loading configuration or calling the Linear API. Expand the hierarchy, inspect issue details, and filter visible user stories with buttons generated from their category labels. Existing Linear epic identifiers not defined in the file appear as read-only placeholder epics.

## Linear issue markdown template

Each markdown file can contain one or more epics and user stories. The file structure is:

```
[YAML frontmatter]        -- optional, sets file-level defaults
[Issue 1]                  -- H2 heading + metadata block + body
[Issue 2]                  -- another H2 heading + metadata block + body
...
```

### Frontmatter

Optional YAML frontmatter at the top of the file sets defaults for all stories in that file:

```yaml
---
project: "Q1 2026 Release"
team: "Engineering"
---
```

Both fields are optional. CLI `--team` and `--project` flags override file frontmatter.

### Epics and user stories

`linearstories` supports a two-level hierarchy using Linear's native parent and sub-issue relationship:

| Type | Identification | Content | Parent relationship |
|------|----------------|---------|---------------------|
| Epic | Per-issue `labels` includes the exact label `Epic` | High-level goal, scope, and `### Why is this needed?`; no acceptance criteria | Top level |
| User story | Per-issue `labels` does not include `Epic` | Description plus an `### Acceptance Criteria` checklist | Optional `epic` metadata links it to an epic |

Standalone user stories remain valid. The `epic` property is only required when a user story belongs to an epic. Because `Epic` identifies the issue type, do not add it to `defaultLabels`.

### Story heading

Each epic or user story starts with an H2 heading (`##`). The heading text becomes the Linear issue title:

```markdown
## As a user, I want to reset my password so that I can regain access
```

You are free to use any title format, but the "As a [role], I want [goal] so that [benefit]" pattern is recommended for clarity.

### Metadata block

Immediately after the heading, include a fenced YAML code block with story metadata:

````markdown
```yaml
linear_id:
linear_url:
priority: 2
labels: [Feature, Auth]
estimate: 3
assignee: jane@company.com
status: Backlog
```
````

All fields are optional. Here is what each field does:

| Field        | Type       | Description                                                                 |
|------------- |----------- |---------------------------------------------------------------------------- |
| `linear_id`  | string     | Linear issue identifier (e.g., `ENG-42`). Populated automatically on import. |
| `linear_url` | string     | Linear issue URL. Populated automatically on import.                        |
| `epic`       | string     | Optional parent epic identifier or exact title of an epic in the same import. User stories only. |
| `priority`   | number     | Priority level: `0` = None, `1` = Urgent, `2` = High, `3` = Normal, `4` = Low |
| `labels`     | string[]   | Label names to apply. Merged with `defaultLabels` from config.              |
| `estimate`   | number     | Story point estimate.                                                       |
| `assignee`   | string     | Assignee email address or display name.                                     |
| `status`     | string     | Workflow state name: `Backlog`, `Todo`, `In Progress`, `Done`, etc.         |

Leave `linear_id` and `linear_url` empty for new stories. The import command fills them in automatically.

### Issue body

Everything after the metadata block and before the next H2 heading is the issue body. It becomes the Linear issue description. Use standard markdown -- paragraphs, lists, code blocks, and so on.

Epics should explain the high-level goal and scope, and must include a substantive `### Why is this needed?` section to pass the quality skill. Epics must not contain acceptance criteria.

### Acceptance criteria

Every user story must include acceptance criteria as a checklist under an H3 heading:

```markdown
### Acceptance Criteria

- [ ] User can request a password reset from the login page
- [ ] Reset email is sent within 60 seconds
- [ ] Reset link expires after 24 hours
```

This section is part of the story body and is included in the Linear issue description. It is required for user stories and forbidden on epics.

### Complete annotated example

A file with one epic and two child stories:

````markdown
---
project: "Q1 2026 Release"
team: "Engineering"
---

## Account access

```yaml
linear_id:
linear_url:
priority: 2
labels: [Epic, Auth]
status: Backlog
```

Provide secure account access and recovery flows across the product.

### Scope

- Email and password login
- Password recovery

### Why is this needed?

Users need a secure way to access and recover their accounts without support intervention.

## As a user, I want to log in so that I can access my account

```yaml
linear_id:               # left empty for new stories
linear_url:              # left empty for new stories
epic: Account access     # exact title of the epic in this import
priority: 2              # High priority
labels: [Feature, Auth]  # merged with defaultLabels from config
estimate: 3              # 3 story points
assignee: jane@company.com
status: Backlog
```

User should be able to log in with their email and password.
The system should support rate limiting after 5 failed attempts.

### Acceptance Criteria

- [ ] User can enter email and password on the login page
- [ ] Invalid credentials show a clear error message
- [ ] User is redirected to the dashboard on successful login
- [ ] Account locks after 5 consecutive failed attempts

## As a user, I want to reset my password so that I can regain access

```yaml
linear_id:
linear_url:
epic: Account access
priority: 3              # Normal priority
labels: [Feature, Auth]
estimate: 2
```

User should be able to reset their password via email link.

### Acceptance Criteria

- [ ] User can request a password reset from the login page
- [ ] Reset email is sent within 60 seconds
- [ ] Reset link expires after 24 hours
````

## Configuration

### Interactive context setup

Use the guided TUI instead of creating or locating config files manually:

```bash
linearstories initctx
```

The wizard uses the first config found by the normal discovery order, or creates `~/.config/linearstories/config.json` when none exists. It masks API-token input, creates parent directories, and writes the config with user-only `0600` permissions. Pass `--config <path>` to target a specific file.

Running `initctx` again adds another named context. Choosing an existing name asks before updating it. For a direct edit, run `linearstories updatectx <name>`; it preloads that context's current defaults and fails without writing if the name does not exist. Leaving the masked token blank preserves the stored token. Use `linearstories deletectx <name>` to delete with confirmation; deleting the final context removes the now-empty config file. If a context command encounters a legacy flat config, it addresses that configuration as a context named `default`.

List the effective contexts in a readable, token-safe format:

```bash
linearstories contexts
linearstories ctx       # abbreviated form
```

The listing shows whether a token is configured but never prints the token value. It also supports `--config <path>`.

### Config file format

The config file is a JSON object with the following fields:

```json
{
  "apiKey": "lin_api_xxxxxxxxxxxxxxxxxxxx",
  "defaultTeam": "Engineering",
  "defaultProject": "Q1 2026 Release",
  "defaultLabels": ["User Story"]
}
```

| Field            | Type     | Required | Description                                              |
|----------------- |--------- |--------- |--------------------------------------------------------- |
| `apiKey`         | string   | Yes*     | Linear API key. Can also be set via `LINEAR_API_KEY` env var. |
| `defaultTeam`    | string   | No       | Default team name for files that do not specify one.      |
| `defaultProject` | string   | No       | Default project name for files that do not specify one.   |
| `defaultLabels`  | string[] | No       | Labels applied to every imported story. Merged with per-story labels. |

*Required either in the config file or as the `LINEAR_API_KEY` environment variable.

### Config discovery order

The CLI looks for configuration in this order, using the first one found:

1. **Explicit path** -- the `--config` flag: `linearstories import --config ./my-config.json stories/*.md`
2. **Project-level** -- `.linearrc.json` in the current working directory
3. **User-level** -- `~/.config/linearstories/config.json`

If no config file is found, the CLI still works as long as `LINEAR_API_KEY` is set in the environment.

### Environment variable

The `LINEAR_API_KEY` environment variable always takes precedence over the `apiKey` field in any config file. This is useful for CI pipelines and shared environments where you do not want API keys in committed files:

```bash
export LINEAR_API_KEY=lin_api_xxxxxxxxxxxxxxxxxxxx
linearstories import stories/*.md
```

### Multi-context config

If you work across multiple Linear organizations or environments, you can define named contexts in a single config file:

```json
{
  "contexts": [
    {
      "name": "orgA",
      "apiKey": "lin_api_orgA_xxxxxxxxxxxx",
      "defaultTeam": "Engineering",
      "defaultProject": "Q1 2026 Release",
      "defaultLabels": ["User Story"]
    },
    {
      "name": "orgB",
      "apiKey": "lin_api_orgB_xxxxxxxxxxxx",
      "defaultTeam": "Design",
      "defaultProject": "Brand Refresh",
      "defaultLabels": ["Design Task"]
    }
  ]
}
```

When a config contains one named context, linearstories selects it automatically. Select a context with `--context` when two or more are configured:

```bash
# Use orgA context
linearstories import --context orgA stories/*.md

# Use orgB context
linearstories export --context orgB -o design-stories.md
```

Each context entry supports the same fields as the flat config (`apiKey`, `defaultTeam`, `defaultProject`, `defaultLabels`) plus a required `name`. Only `name` is required per entry; other fields are optional.

If multiple contexts are detected and no `--context` flag is provided, the CLI prints the available context names and exits with an error.

The `LINEAR_API_KEY` environment variable still takes precedence over the selected context's `apiKey`.

The flat config format continues to work unchanged -- no migration is needed unless you want multi-context support.

Alternatively, you can use separate config files and pass the appropriate one with `--config`:

```bash
linearstories import --config ~/.config/linearstories/org-a.json stories/*.md
```

## CLI reference

### `linearstories initctx`

Interactively create or update a named context. The wizard stores the config at the effective discovered path, falling back to `~/.config/linearstories/config.json`.

```text
linearstories initctx [options]

-c, --config <path>  Config file to create or update
```

### `linearstories contexts` / `linearstories ctx`

List context names and defaults without exposing API-token values.

```text
linearstories contexts [options]
linearstories ctx [options]

-c, --config <path>  Config file to inspect
```

### `linearstories updatectx`

Interactively update an existing named context. Current team, project, and labels are preloaded; leaving the masked token blank keeps its stored value. The command never creates a missing context.

```text
linearstories updatectx <name> [options]

-c, --config <path>  Config file containing the context
```

### `linearstories deletectx`

Delete an existing named context after confirmation. Other contexts are preserved; deleting the final context removes the config file. Cancellation and unknown names never modify the file.

```text
linearstories deletectx <name> [options]

-c, --config <path>  Config file containing the context
```

### `linearstories import`

Import epics and user stories from markdown files into Linear. Creates new issues or updates existing ones based on whether `linear_id` is present, and links stories to epics through Linear sub-issues.

```
linearstories import <files...> [options]
```

**Arguments:**

| Argument      | Description                                      |
|-------------- |------------------------------------------------- |
| `<files...>`  | One or more markdown file paths or glob patterns |

**Options:**

| Flag                       | Description                                                           |
|--------------------------- |---------------------------------------------------------------------- |
| `-c, --config <path>`      | Path to a config file                                                |
| `--context <name>`         | Select a named context from a multi-context config                   |
| `-t, --team <name>`        | Override the file and configured default team                        |
| `-p, --project <name>`     | Override the file and configured default project                     |
| `--dry-run`                | Validate and parse without making any Linear API calls               |
| `--preflight`              | Read-only validation of remote teams, projects, labels, states, assignees, and epic references |
| `--create-missing-labels`  | Create unresolved labels for the target team after preflight, then import |
| `--allow-missing-labels`   | Explicitly skip unavailable labels and continue the import           |
| `--no-write-back`          | Skip writing `linear_id` and `linear_url` back to the markdown files |

`--dry-run` cannot be combined with remote validation or label options. `--preflight` cannot be combined with `--create-missing-labels`, and the two label handling modes are mutually exclusive.

**Examples:**

```bash
# Import a single file
linearstories import stories/login.md

# Import all markdown files in a directory
linearstories import stories/*.md

# Import with team override
linearstories import -t "Platform" stories/infra/*.md

# Dry run to validate without creating issues
linearstories import --dry-run stories/*.md

# Check Linear resources without creating labels or issues
linearstories import --preflight stories/*.md

# Provision missing team labels after a successful preflight, then import
linearstories import --create-missing-labels stories/*.md

# Explicitly import without labels that are unavailable to the target team
linearstories import --allow-missing-labels stories/*.md

# Import without modifying the source files
linearstories import --no-write-back stories/*.md

# Import with an explicit config file
linearstories import -c ./team-config.json stories/*.md
```

### `linearstories visualize`

Render one LinearStories markdown file in Project Atlas, an interactive local delivery graph. Epics can be expanded to show their user stories; standalone stories appear directly under the project. Acceptance criteria orbit each story as individual completion marks.

```
linearstories visualize <file> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<file>` | One markdown file containing epics and user stories |

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `-p, --port <port>` | Local HTTP server port | `4173` |
| `--no-open` | Start the server without opening a browser | |

Project Atlas provides:

- Expandable project, epic, and user-story nodes, plus `Collapse`, `Expand all`, and `Fit view` controls.
- Category-label buttons that show or hide matching user stories. Only the exact, case-sensitive `Epic` discriminator is omitted; labels such as lowercase `epic` remain available as user-story filters.
- Completed, in-progress, and not-started status styling for issues and acceptance criteria.
- A details panel with issue title, progress, acceptance criteria, labels, and the Linear link when `linear_url` is present.
- Unfiltered project totals in the header while category filters change only the visible graph.

The server binds to `127.0.0.1`, exposes only embedded visualization assets and the parsed graph, and stops when you press `Ctrl+C`. The command does not read `.linearrc.json`, require `LINEAR_API_KEY`, write to the markdown file, or contact Linear. The browser loads D3 and web fonts from their public CDNs.

```bash
# Open the atlas in the default browser
linearstories visualize stories/current.md

# Choose a port and open the URL manually
linearstories visualize stories/current.md --port 8080 --no-open
```

### `linearstories export`

Export Linear issues to the epic and user-story markdown format. The exported file can be edited and re-imported.

```
linearstories export [options]
```

**Options:**

| Flag                       | Description                                              | Default                 |
|--------------------------- |--------------------------------------------------------- |------------------------ |
| `-c, --config <path>`      | Path to a config file                                   |                         |
| `--context <name>`         | Select a named context from a multi-context config      |                         |
| `-t, --team <name>`        | Override the default team                               |                         |
| `-o, --output <file>`      | Output file path                                        | `./exported-stories.md` |
| `-p, --project <name>`     | Filter by project name                                  |                         |
| `-i, --issues <ids>`       | Comma-separated issue identifiers (e.g., `ENG-1,ENG-2`) |                         |
| `-s, --status <state>`     | Filter by workflow status                               |                         |
| `-a, --assignee <email>`   | Filter by assignee email                                |                         |
| `--creator <email>`        | Filter by creator email                                 |                         |
| `-l, --label <name>`       | Filter by exact issue label                             |                         |
| `--epics-only`             | Export only issues with the exact `Epic` label          |                         |

**Examples:**

```bash
# Export all issues from the default team
linearstories export

# Export to a specific file
linearstories export -o backlog.md

# Export only issues in a specific project
linearstories export -t "Engineering" -p "Q1 2026 Release"

# Export only epics in a specific project
linearstories export -t "Engineering" -p "Q1 2026 Release" --epics-only

# Export issues carrying another label
linearstories export -t "Engineering" --label "Feature"

# Export specific issues by ID
linearstories export -i ENG-1,ENG-2,ENG-3

# Export issues with a specific status
linearstories export -s "In Progress"

# Export issues assigned to a specific person
linearstories export -a jane@company.com

# Export issues created by a specific person
linearstories export --creator alex@company.com

# Combine filters
linearstories export -t "Engineering" -p "Q1 2026 Release" -s "Todo" -o sprint-todo.md
```

`--epics-only` and `--label` are mutually exclusive. Team and project names are resolved before
issues are queried. A project filter requires a team from `--team` or `defaultTeam`; if either
scope cannot be resolved, the command exits nonzero without querying unscoped issues or creating
or overwriting the output file.

## Import workflow

The import command is the primary workflow. Here is what happens step by step.

### Step 1: Write stories in markdown

Create a markdown file with one or more stories. Leave `linear_id` and `linear_url` empty:

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
````

### Step 2: Run the import

```bash
linearstories import stories/login.md
```

The CLI:
1. Parses every input file and extracts epics and user stories.
2. Validates the issue types and local hierarchy.
3. Runs a complete remote preflight for teams, projects, labels, assignees, workflow states, and existing epic references.
4. Aborts before issue mutation if any required remote resource is unresolved.
5. Creates or updates epics before user stories, regardless of source file order.
6. Creates or updates each issue and sets `parentId` for child stories.
7. Writes the `linear_id` and `linear_url` back into each markdown file.

### Step 3: Inspect the write-back

After import, the markdown file is updated in place. The **before** and **after** difference is in the metadata block:

**Before:**

```yaml
linear_id:
linear_url:
```

**After:**

```yaml
linear_id: ENG-42
linear_url: https://linear.app/myorg/issue/ENG-42
```

The full file now looks like this:

````markdown
---
project: "Q1 2026 Release"
team: "Engineering"
---

## As a user, I want to log in so that I can access my account

```yaml
linear_id: ENG-42
linear_url: https://linear.app/myorg/issue/ENG-42
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
````

Subsequent imports of this file will **update** the existing issue `ENG-42` instead of creating a duplicate.

### Step 4: Edit and re-import

Make changes to the story -- update acceptance criteria, change the priority, reassign -- and re-run the import. The existing Linear issue is updated in place:

```bash
# Edit the file, then re-import
linearstories import stories/login.md
```

### Create vs. update logic

| `linear_id` field          | Behavior                     |
|--------------------------- |----------------------------- |
| Empty or missing           | Creates a new Linear issue   |
| Present (e.g., `ENG-42`)  | Updates the existing issue   |

### Label merging

Per-story labels and `defaultLabels` from the config are merged and deduplicated. If your config has `"defaultLabels": ["User Story"]` and a story specifies `labels: [Feature, Auth]`, the resulting issue gets all three labels: `Feature`, `Auth`, and `User Story`.

The exact label `Epic` is reserved as the issue-type discriminator and cannot be configured in `defaultLabels`.

Labels are resolved once per effective team. An exact team-scoped label is preferred over an exact workspace label. A label owned only by another team is never applied, and case-only or grouped-label conflicts fail preflight with an explicit diagnostic.

Missing labels fail by default. `--create-missing-labels` explicitly creates team-scoped labels only after every other remote prerequisite has passed. `--allow-missing-labels` explicitly skips unavailable ordinary labels; the reserved `Epic` label can never be skipped. When updating an existing issue in this mode, label synchronization is omitted so existing Linear labels are not accidentally cleared.

### Validation and preflight modes

`--dry-run` performs local parsing, issue-type, and hierarchy validation without calling Linear. Use it when remote validation is unnecessary or network access is unavailable. The CLI still requires a syntactically valid API key in its resolved configuration.

`--preflight` performs read-only remote validation and never creates labels or issues. A normal import runs the same remote preflight automatically before issue mutation. If preflight or authorized label provisioning fails, no issues are created or updated. Once mutation begins, an issue API failure can still leave earlier successful issue mutations in place; rerun the import after correcting the API failure.

### Epic hierarchy resolution

A user story can set `epic` to either an existing Linear identifier such as `ENG-42` or the exact title of an epic included anywhere in the same import command. Local epics are processed first. Existing Linear parents are verified to have the `Epic` label and to be top-level issues before the child is linked.

The importer rejects nested epics, epics with acceptance criteria, user stories without an acceptance-criteria checklist, and invalid or ambiguous parent references. See [docs/USER_STORY_FORMAT.md](docs/USER_STORY_FORMAT.md) for the complete rules.

### Team and project resolution order

For both team and project, the CLI resolves in this order:

1. Value passed via CLI flag (`--team`, `--project`)
2. Value specified in file frontmatter
3. Default from config file (`defaultTeam`, `defaultProject`)

## Export workflow

The export command pulls issues from Linear and writes them to the standard markdown format. Epic labels are preserved, and child issues receive `epic: <parent-identifier>` metadata so the hierarchy can be re-imported reliably.

### Basic export

```bash
linearstories export -t "Engineering" -o stories/exported.md
```

This fetches all issues from the Engineering team and writes them to `stories/exported.md`.

### Filtering examples

Export only epics for a project:

```bash
linearstories export -t "Engineering" -p "Q1 2026 Release" --epics-only -o epics.md
```

Export only backlog items for a specific project:

```bash
linearstories export -t "Engineering" -p "Q1 2026 Release" -s "Backlog" -o backlog.md
```

Export a handful of specific issues:

```bash
linearstories export -i ENG-1,ENG-5,ENG-12 -o selected.md
```

Export everything assigned to one person:

```bash
linearstories export -a jane@company.com -o janes-stories.md
```

Export filters are applied by Linear. Team and project resolution fails closed before the issue
query begins, so a misspelled or inaccessible scope cannot degrade into a workspace-wide export.
Each issue page selects state, assignee, labels, parent, project, and team in one GraphQL request
instead of resolving those relationships separately for every issue.

### Round-trip workflow

Export, edit, and re-import to update issues from markdown:

```bash
# Pull current state from Linear
linearstories export -t "Engineering" -p "Q1 2026 Release" -o stories/current.md

# Edit the file: update acceptance criteria, reprioritize, etc.

# Push changes back to Linear
linearstories import stories/current.md
```

Because exported stories include `linear_id`, the re-import updates existing issues rather than creating new ones.

## Claude Code skill: `/rate-userstories`

linearstories ships with a built-in Claude Code skill that evaluates the quality of your acceptance criteria. Run it in any Claude Code session:

```
/rate-userstories stories/q1-2026.md
```

The skill reads your markdown file and produces a structured report:

- **Scores each story 0-100%** across specificity, testability, completeness, and description quality
- **Classifies epics separately** and scores goal clarity, scope, rationale, and description quality without requiring acceptance criteria
- **Downgrades epics missing `Why is this needed?`** so they cannot reach the 80% pass threshold
- **Detects hard contradictions** within and across epics and user stories
- **Flags anti-patterns** like subjective language ("intuitive", "fast", "looks good") and ambiguous scope ("etc.", "as needed")
- **Rewrites failing criteria** with concrete, testable alternatives
- **Recommends a style guide** when UI/visual criteria are unverifiable

Stories scoring below 80% get a detailed breakdown with suggested improvements. See [docs/RATE_USERSTORIES.md](docs/RATE_USERSTORIES.md) for full documentation.

## Building from source

### Prerequisites

- [Bun](https://bun.sh) v1.0 or later

### Install dependencies

```bash
bun install
```

### Run in development

```bash
bun run src/cli/index.ts import stories/*.md
```

### Run tests

```bash
bun test
```

### Lint and format

```bash
bun run lint
bun run format
```

### Build the binary

```bash
bun build src/cli/index.ts --compile --outfile linearstories
```

This produces a self-contained `linearstories` executable that does not require Bun at runtime.

### Publish a release

Maintainers can validate, publish, and tag the version in `package.json` with one command:

```bash
bun run release:npm --dry-run
bun run release:npm
```

The release command requires a clean `main` branch synchronized with `origin/main`. It installs
from the lockfile, runs the tests and linter, checks npm authentication and package contents,
asks for confirmation, publishes to npm, verifies the published version, and pushes the matching
`vX.Y.Z` tag. The tag triggers the GitHub binary release workflow.

Use `bun run release:npm --yes` only when the final confirmation needs to be skipped. The command
is safe to rerun after a partial release: if npm publishing succeeded but tag pushing failed, it
will skip the existing npm version and complete the tag.

## Contributing

### Running the test suite

The project has both unit and integration tests:

```bash
# Run all tests
bun test

# Run only unit tests
bun test tests/unit

# Run only integration tests
bun test tests/integration

# Run a specific test file
bun test tests/unit/markdown/parser.test.ts
```

### TDD expectations

All changes should follow test-driven development:

1. Write a failing test that describes the expected behavior.
2. Implement the minimal code to make the test pass.
3. Refactor while keeping tests green.

New features and bug fixes must include tests. The test suite covers parsing, serialization, config loading, Linear API interactions, resolver logic, and end-to-end import/export flows.

### Project structure

```
src/
  cli/
    index.ts              CLI entry point
    commands/
      import.ts           Import command registration
      export.ts           Export command registration
      visualize.ts        Local visualization command registration
  config/
    loader.ts             Config discovery and loading
    schema.ts             Config validation
  linear/
    client.ts             Linear SDK client factory
    issues.ts             Issue create/update/fetch operations
    filters.ts            Issue filter construction
    resolvers.ts          Name-to-UUID resolution (teams, projects, labels, etc.)
  markdown/
    parser.ts             Markdown-to-UserStory parsing
    serializer.ts         UserStory-to-markdown serialization
    writer.ts             Write-back of linear_id/linear_url into existing files
  sync/
    importer.ts           Import orchestration
    preflight.ts          Atomic remote validation and import planning
    exporter.ts           Export orchestration
  visualization/
    graph.ts              Parsed issue hierarchy and progress model
    server.ts             Local embedded-asset HTTP server
    assets/               Interactive project atlas UI
  types.ts                Shared TypeScript interfaces
  errors.ts               Custom error classes
scripts/
  release-npm.ts          Guarded npm publish and GitHub tag workflow
templates/
  user-story.md           Example user story template
docs/
  USER_STORY_FORMAT.md    Markdown format reference
  RATE_USERSTORIES.md     /rate-userstories skill documentation
.claude/
  commands/
    rate-userstories.md   Claude Code skill for AC quality evaluation
tests/
  unit/                   Unit tests
  integration/            Integration tests
website/
  llms.txt                Agent-oriented CLI reference
```

## License

MIT License. See [LICENSE](LICENSE) for details.
