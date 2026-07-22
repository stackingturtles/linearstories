import { describe, expect, test } from "bun:test";
import { ParseError } from "../../../src/errors.ts";
import { parseMarkdownFile } from "../../../src/markdown/parser.ts";
import { buildProjectGraph } from "../../../src/visualization/graph.ts";

const generatedAt = new Date("2026-07-22T09:00:00.000Z");

function build(markdown: string) {
	return buildProjectGraph(parseMarkdownFile(markdown, "/work/checkout-flow.md"), {
		generatedAt,
	});
}

describe("buildProjectGraph", () => {
	test("groups stories under epics and keeps standalone stories at project level", () => {
		const graph = build(`---
project: Checkout
team: Web
---
## Faster checkout

\`\`\`yaml
linear_id: WEB-10
labels: [Epic, Checkout]
status: In Progress
\`\`\`

### Why is this needed?

Customers abandon long checkout flows.

## As a shopper, I want saved addresses so that checkout is quicker

\`\`\`yaml
epic: WEB-10
labels: [Checkout]
status: In Progress
\`\`\`

### Acceptance Criteria

- [x] A saved address can be selected
- [ ] A new address can be stored

## As an operator, I want a health check so that I can monitor checkout

\`\`\`yaml
status: Backlog
\`\`\`

### Acceptance Criteria

- [ ] The endpoint reports service health
`);

		expect(graph.generatedAt).toBe(generatedAt.toISOString());
		expect(graph.source).toBe("checkout-flow.md");
		expect(graph.project.title).toBe("Checkout");
		expect(graph.project.team).toBe("Web");
		expect(graph.project.children).toHaveLength(2);
		expect(graph.project.progress).toEqual({
			completedEpics: 0,
			totalEpics: 1,
			completedStories: 0,
			totalStories: 2,
			completedCriteria: 1,
			totalCriteria: 3,
		});

		const epic = graph.project.children[0]!;
		expect(epic.type).toBe("epic");
		if (epic.type !== "epic") throw new Error("Expected epic");
		expect(epic.id).toBe("WEB-10");
		expect(epic.children[0]?.id).toBe("local-story-1");
		expect(epic.children[0]?.shortTitle).toBe("saved addresses");
		expect(epic.children[0]?.criteria.map((criterion) => criterion.completed)).toEqual([
			true,
			false,
		]);

		const standalone = graph.project.children[1]!;
		expect(standalone.type).toBe("story");
		expect(standalone.id).toBe("local-story-2");
	});

	test("resolves a parent epic by title", () => {
		const graph = build(`## Account controls

\`\`\`yaml
labels: [Epic]
\`\`\`

### Why is this needed?

Users need control.

## As a user, I want to close my account

\`\`\`yaml
epic: Account controls
\`\`\`

### Acceptance Criteria

- [ ] The account can be closed
`);

		const epic = graph.project.children[0]!;
		expect(epic.type).toBe("epic");
		if (epic.type !== "epic") throw new Error("Expected epic");
		expect(epic.children).toHaveLength(1);
	});

	test("groups stories under referenced Linear epics that are not in the file", () => {
		const graph = build(`## As a user, I want account recovery

\`\`\`yaml
epic: ENG-42
\`\`\`

### Acceptance Criteria

- [ ] A reset email is sent
`);

		const epic = graph.project.children[0]!;
		expect(epic.type).toBe("epic");
		if (epic.type !== "epic") throw new Error("Expected epic");
		expect(epic.id).toBe("ENG-42");
		expect(epic.title).toBe("Referenced epic ENG-42");
		expect(epic.children).toHaveLength(1);
	});

	test("rejects unknown cross-story epic references", () => {
		expect(() =>
			build(`## As a user, I want reports

\`\`\`yaml
epic: Missing epic
\`\`\`

### Acceptance Criteria

- [ ] A report is visible
`),
		).toThrow(
			new ParseError(
				'User story "As a user, I want reports" references unknown epic "Missing epic"',
			),
		);
	});

	test("rejects duplicate Linear identifiers", () => {
		expect(() =>
			build(`## First

\`\`\`yaml
linear_id: WEB-1
\`\`\`

### Acceptance Criteria
- [ ] First criterion

## Second

\`\`\`yaml
linear_id: WEB-1
\`\`\`

### Acceptance Criteria
- [ ] Second criterion
`),
		).toThrow('Duplicate linear_id "WEB-1" cannot be visualized');
	});

	test("uses the filename when project frontmatter is absent", () => {
		const graph = build(`## A story

### Acceptance Criteria

- [ ] It works
`);

		expect(graph.project.title).toBe("Checkout Flow");
		expect(graph.project.id).toBe("project-checkout-flow");
	});
});
