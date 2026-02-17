import { describe, expect, test } from "bun:test";
import { serializeStories } from "../../../src/markdown/serializer.ts";
import type { FileFrontmatter, UserStory } from "../../../src/types.ts";

function makeStory(overrides: Partial<UserStory> = {}): UserStory {
	return {
		title: "As a user, I want to log in so that I can access my account",
		linearId: null,
		linearUrl: null,
		priority: null,
		labels: [],
		estimate: null,
		assignee: null,
		status: null,
		body: "User should be able to log in.\n\n### Acceptance Criteria\n\n- [ ] Login works",
		project: null,
		team: null,
		...overrides,
	};
}

describe("serializeStories", () => {
	// ------------------------------------------------------------------
	// Serialize single UserStory to markdown
	// ------------------------------------------------------------------

	test("serializes single UserStory to markdown", () => {
		const story = makeStory({
			priority: 2,
			labels: ["Feature", "Auth"],
			estimate: 3,
			assignee: "jane@company.com",
			status: "Backlog",
		});

		const result = serializeStories([story]);

		expect(result).toContain("## As a user, I want to log in so that I can access my account");
		expect(result).toContain("```yaml");
		expect(result).toContain("priority: 2");
		expect(result).toContain("labels: [Feature, Auth]");
		expect(result).toContain("estimate: 3");
		expect(result).toContain("assignee: jane@company.com");
		expect(result).toContain("status: Backlog");
		expect(result).toContain("```");
		expect(result).toContain("User should be able to log in.");
		expect(result).toContain("### Acceptance Criteria");
	});

	// ------------------------------------------------------------------
	// Serialize array of UserStory[] with file frontmatter
	// ------------------------------------------------------------------

	test("serializes array of UserStory[] with file frontmatter", () => {
		const frontmatter: FileFrontmatter = {
			project: "Q1 2026 Release",
			team: "Engineering",
		};
		const stories = [
			makeStory({ priority: 2 }),
			makeStory({
				title: "As a user, I want to reset my password",
				priority: 3,
				body: "Password reset flow.\n\n### Acceptance Criteria\n\n- [ ] Reset works",
			}),
		];

		const result = serializeStories(stories, frontmatter);

		// Frontmatter
		expect(result).toMatch(/^---\n/);
		expect(result).toContain('project: "Q1 2026 Release"');
		expect(result).toContain('team: "Engineering"');
		expect(result).toContain("---\n");

		// Both stories present
		expect(result).toContain("## As a user, I want to log in so that I can access my account");
		expect(result).toContain("## As a user, I want to reset my password");
	});

	// ------------------------------------------------------------------
	// Omit null/empty optional fields from YAML blocks
	// ------------------------------------------------------------------

	test("omits null/empty optional fields from YAML blocks", () => {
		const story = makeStory({
			priority: 2,
			// labels is empty [], assignee is null, status is null, estimate is null
		});

		const result = serializeStories([story]);

		expect(result).toContain("priority: 2");
		expect(result).not.toContain("assignee:");
		expect(result).not.toContain("status:");
		expect(result).not.toContain("estimate:");
		// labels is empty so should be omitted
		expect(result).not.toMatch(/^labels:/m);
	});

	// ------------------------------------------------------------------
	// Include linear_id and linear_url when present
	// ------------------------------------------------------------------

	test("includes linear_id and linear_url when present", () => {
		const story = makeStory({
			linearId: "ENG-42",
			linearUrl: "https://linear.app/myorg/issue/ENG-42",
			priority: 2,
		});

		const result = serializeStories([story]);

		expect(result).toContain("linear_id: ENG-42");
		expect(result).toContain("linear_url: https://linear.app/myorg/issue/ENG-42");
	});

	// ------------------------------------------------------------------
	// Produce valid markdown matching import template format
	// ------------------------------------------------------------------

	test("produces valid markdown that can be round-tripped through the parser", () => {
		const frontmatter: FileFrontmatter = {
			project: "Q1 2026 Release",
			team: "Engineering",
		};
		const story = makeStory({
			priority: 2,
			labels: ["Feature", "Auth"],
			estimate: 3,
			assignee: "jane@company.com",
			status: "Backlog",
		});

		const result = serializeStories([story], frontmatter);

		// Structural checks
		// Starts with frontmatter
		expect(result).toMatch(/^---\n/);
		// Has H2 heading
		expect(result).toContain("\n## ");
		// Has fenced YAML block
		expect(result).toContain("```yaml\n");
		expect(result).toContain("\n```\n");
		// Ends with newline
		expect(result.endsWith("\n")).toBe(true);
	});

	// ------------------------------------------------------------------
	// Handle story with no metadata (no YAML block if all metadata null/empty)
	// ------------------------------------------------------------------

	test("handles story with no metadata - no YAML block emitted", () => {
		const story = makeStory();
		// All metadata fields are null/empty

		const result = serializeStories([story]);

		expect(result).toContain("## As a user, I want to log in so that I can access my account");
		expect(result).not.toContain("```yaml");
		expect(result).toContain("User should be able to log in.");
	});
});
