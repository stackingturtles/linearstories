# linearstories

A CLI tool that bridges markdown-based user stories and Linear issues, enforcing user story and acceptance criteria discipline for AI agent-driven development.

## Why structured acceptance criteria matter for AI agents

AI coding agents -- Claude Code, Cursor, Copilot Workspace, and others -- perform dramatically better when given precise, testable acceptance criteria. Vague tickets like "improve the login flow" lead to ambiguous implementations and wasted iteration cycles. Structured user stories with explicit acceptance criteria give agents the deterministic guardrails they need:

- **Clear scope boundaries.** Each acceptance criterion is a discrete, verifiable condition. Agents can work through them one at a time and know when they are done.
- **Testable by default.** Criteria written as checkboxes (`- [ ] ...`) map directly to test cases. Agents can generate tests that match the specification.
- **Markdown as the source of truth.** Stories live in your repository alongside the code. Agents can read them directly without API access to your project management tool.
- **Two-way sync with Linear.** Engineering managers keep their board current; agents keep their specs current. Neither workflow is disrupted.

`linearstories` closes the gap between how AI agents consume work (structured markdown files in a repo) and how engineering teams manage work (Linear issues on a board).

## Quick start

### 1. Install

Download the compiled binary for your platform from the releases page, or build from source:

```bash
bun install
bun build src/cli/index.ts --compile --outfile linearstories
```

Or run directly with Bun during development:

```bash
bun run src/cli/index.ts <command>
```

### 2. Create a config file

Create `.linearrc.json` in your project root:

```json
{
  "apiKey": "lin_api_xxxxxxxxxxxxxxxxxxxx",
  "defaultTeam": "Engineering",
  "defaultProject": "Q1 2026 Release",
  "defaultLabels": ["User Story"]
}
```

Alternatively, set the `LINEAR_API_KEY` environment variable and skip the `apiKey` field.

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

## User story markdown template

Each markdown file can contain one or more user stories. The file structure is:

```
[YAML frontmatter]        -- optional, sets file-level defaults
[Story 1]                  -- H2 heading + metadata block + body
[Story 2]                  -- another H2 heading + metadata block + body
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

Both fields are optional. They can be overridden per-story or via CLI flags.

### Story heading

Each story starts with an H2 heading (`##`). The heading text becomes the Linear issue title:

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
| `priority`   | number     | Priority level: `0` = None, `1` = Urgent, `2` = High, `3` = Normal, `4` = Low |
| `labels`     | string[]   | Label names to apply. Merged with `defaultLabels` from config.              |
| `estimate`   | number     | Story point estimate.                                                       |
| `assignee`   | string     | Assignee email address or display name.                                     |
| `status`     | string     | Workflow state name: `Backlog`, `Todo`, `In Progress`, `Done`, etc.         |

Leave `linear_id` and `linear_url` empty for new stories. The import command fills them in automatically.

### Story body

Everything after the metadata block and before the next H2 heading is the story body. It becomes the Linear issue description. Use standard markdown -- paragraphs, lists, code blocks, and so on.

### Acceptance criteria

Include acceptance criteria as a checklist under an H3 heading:

```markdown
### Acceptance Criteria

- [ ] User can request a password reset from the login page
- [ ] Reset email is sent within 60 seconds
- [ ] Reset link expires after 24 hours
```

This section is part of the story body and is included in the Linear issue description.

### Complete annotated example

A file with two stories:

````markdown
---
project: "Q1 2026 Release"
team: "Engineering"
---

## As a user, I want to log in so that I can access my account

```yaml
linear_id:               # left empty for new stories
linear_url:              # left empty for new stories
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
| `defaultTeam`    | string   | No       | Default team name for stories that do not specify one.   |
| `defaultProject` | string   | No       | Default project name for stories that do not specify one.|
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

Select a context with the `--context` flag:

```bash
# Use orgA context
linearstories import --context orgA stories/*.md

# Use orgB context
linearstories export --context orgB -o design-stories.md
```

Each context entry supports the same fields as the flat config (`apiKey`, `defaultTeam`, `defaultProject`, `defaultLabels`) plus a required `name`. Only `name` is required per entry; other fields are optional.

If a multi-context config is detected and no `--context` flag is provided, the CLI prints the available context names and exits with an error.

The `LINEAR_API_KEY` environment variable still takes precedence over the selected context's `apiKey`.

The flat config format continues to work unchanged -- no migration is needed unless you want multi-context support.

Alternatively, you can use separate config files and pass the appropriate one with `--config`:

```bash
linearstories import --config ~/.config/linearstories/org-a.json stories/*.md
```

## CLI reference

### `linearstories import`

Import user stories from markdown files into Linear. Creates new issues or updates existing ones based on whether `linear_id` is present in the metadata block.

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
| `-t, --team <name>`        | Override the default team                                            |
| `-p, --project <name>`     | Override the default project                                         |
| `--dry-run`                | Validate and parse without making any Linear API calls               |
| `--no-write-back`          | Skip writing `linear_id` and `linear_url` back to the markdown files |

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

# Import without modifying the source files
linearstories import --no-write-back stories/*.md

# Import with an explicit config file
linearstories import -c ./team-config.json stories/*.md
```

### `linearstories export`

Export Linear issues to a markdown file in the user story format. The exported file can be edited and re-imported.

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

**Examples:**

```bash
# Export all issues from the default team
linearstories export

# Export to a specific file
linearstories export -o backlog.md

# Export only issues in a specific project
linearstories export -t "Engineering" -p "Q1 2026 Release"

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
1. Parses the markdown file and extracts stories.
2. Resolves team, project, label, assignee, and status names to Linear UUIDs.
3. Creates a new Linear issue for each story (or updates if `linear_id` is already set).
4. Writes the `linear_id` and `linear_url` back into the markdown file.

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

### Team and project resolution order

For both team and project, the CLI resolves in this order:

1. Value specified in the story metadata block
2. Value passed via CLI flag (`--team`, `--project`)
3. Default from config file (`defaultTeam`, `defaultProject`)

## Export workflow

The export command pulls issues from Linear and writes them to a markdown file in the standard user story format.

### Basic export

```bash
linearstories export -t "Engineering" -o stories/exported.md
```

This fetches all issues from the Engineering team and writes them to `stories/exported.md`.

### Filtering examples

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
    exporter.ts           Export orchestration
  types.ts                Shared TypeScript interfaces
  errors.ts               Custom error classes
templates/
  user-story.md           Example user story template
tests/
  unit/                   Unit tests
  integration/            Integration tests
```

## License

See the repository for license information.
