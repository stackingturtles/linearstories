# `/rate-userstories` — Acceptance Criteria Quality Evaluator

A Claude Code skill that evaluates user stories in a markdown file, grading each story's acceptance criteria on verifiability and quality.

## Usage

In any Claude Code session within a project that has linearstories installed:

```
/rate-userstories <path-to-markdown-file>
```

### Examples

```bash
# Rate stories in a local file
/rate-userstories stories/q1-2026.md

# Rate stories using an absolute path
/rate-userstories /Users/team/project/userstories.md

# Rate the included template
/rate-userstories templates/user-story.md
```

## What it does

The skill reads a markdown file in the [linearstories format](./USER_STORY_FORMAT.md) and produces a structured quality report for every user story in the file.

### Evaluation dimensions

Each story is scored on a 0-100% scale across four weighted dimensions:

| Dimension | Weight | What it measures |
|-----------|--------|-----------------|
| **Specificity** | 30% | Are criteria concrete and measurable? Do they use precise values, counts, or named states? |
| **Testability** | 35% | Can each criterion be verified with a clear pass/fail? Could a QA engineer write a test case from it? |
| **Completeness** | 25% | Do criteria cover the story's scope? Are edge cases, error states, and boundaries addressed? |
| **Description Quality** | 10% | Does the description provide enough context for a developer? |

Stories scoring **80% or above** pass. Stories below 80% receive a detailed breakdown with rewritten criteria.

### Anti-patterns detected

The skill flags subjective or unquantified language in acceptance criteria:

- **Subjective UI language** — "easy to use", "intuitive", "nice looking", "user-friendly", "clean UI", "visually appealing", "looks good", "modern design"
- **Unquantified performance** — "fast", "responsive", "smooth", "quick" (without thresholds like "< 200ms")
- **Weasel words** — "should work well", "properly handles", "appropriate", "reasonable", "seamless", "robust"
- **Ambiguous scope** — "etc.", "and more", "as needed", "where applicable", "various"

Each flagged criterion gets an explanation of *why* it fails and a concrete rewrite.

### Style guide recommendation

When UI or visual acceptance criteria are unverifiable (e.g., "the button looks professional"), the skill recommends creating a **style guide** with concrete design rules (hex colors, spacing, typography, component specs) that acceptance criteria can reference instead.

**Before:** "Button looks good and matches the design"
**After:** "Button uses the primary action style defined in the style guide (background: `#2563EB`, text: white, padding: `8px 16px`, border-radius: `6px`)"

## Output format

The report is structured as:

1. **Summary table** — Every story with its score and pass/fail status
2. **Detailed breakdown** — Stories below 80% get per-dimension scores, flagged criteria with rewrites, and suggested additions
3. **Style guide recommendation** — Included only when UI/visual anti-patterns are detected
4. **Passing stories** — Brief listing of stories at or above 80% with one-line notes

## Installation

The skill is a project-local Claude Code command. It is included automatically when you clone the linearstories repository — no additional installation is needed.

The skill file lives at `.claude/commands/rate-userstories.md`.

### Using in other projects

To add this skill to any project, copy the skill file:

```bash
mkdir -p .claude/commands
cp path/to/linearstories/.claude/commands/rate-userstories.md .claude/commands/
```

The skill works with any markdown file that follows the linearstories format (H2 story headings, `### Acceptance Criteria` sections with checkbox lists).
