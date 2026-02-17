import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ParseError } from "../../../src/errors.ts";
import { parseMarkdownFile } from "../../../src/markdown/parser.ts";

const FIXTURES_DIR = join(import.meta.dir, "../../fixtures");

function readFixture(name: string): string {
	return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

describe("parseMarkdownFile", () => {
	// ------------------------------------------------------------------
	// Parse single-story file with frontmatter and YAML block
	// ------------------------------------------------------------------

	test("parses single-story file with frontmatter and YAML block", () => {
		const content = readFixture("single-story.md");
		const result = parseMarkdownFile(content, "single-story.md");

		expect(result.frontmatter).toEqual({
			project: "Q1 2026 Release",
			team: "Engineering",
		});
		expect(result.stories).toHaveLength(1);
		expect(result.filePath).toBe("single-story.md");

		const story = result.stories[0]!;
		expect(story.title).toBe("As a user, I want to log in so that I can access my account");
		expect(story.priority).toBe(2);
		expect(story.labels).toEqual(["Feature", "Auth"]);
		expect(story.estimate).toBe(3);
		expect(story.assignee).toBe("jane@company.com");
		expect(story.status).toBe("Backlog");
		expect(story.linearId).toBeNull();
		expect(story.linearUrl).toBeNull();
		expect(story.project).toBe("Q1 2026 Release");
		expect(story.team).toBe("Engineering");
	});

	// ------------------------------------------------------------------
	// Parse multi-story file (2 stories with different metadata)
	// ------------------------------------------------------------------

	test("parses multi-story file with 2 stories and different metadata", () => {
		const content = readFixture("multi-story.md");
		const result = parseMarkdownFile(content, "multi-story.md");

		expect(result.stories).toHaveLength(2);

		const story1 = result.stories[0]!;
		expect(story1.title).toBe("As a user, I want to log in so that I can access my account");
		expect(story1.priority).toBe(2);
		expect(story1.labels).toEqual(["Feature", "Auth"]);
		expect(story1.estimate).toBe(3);
		expect(story1.assignee).toBe("jane@company.com");
		expect(story1.status).toBe("Backlog");

		const story2 = result.stories[1]!;
		expect(story2.title).toBe("As a user, I want to reset my password so that I can regain access");
		expect(story2.priority).toBe(3);
		expect(story2.labels).toEqual(["Feature", "Auth"]);
		expect(story2.estimate).toBe(2);
		expect(story2.assignee).toBeNull();
		expect(story2.status).toBeNull();
	});

	// ------------------------------------------------------------------
	// Extract title from H2 heading
	// ------------------------------------------------------------------

	test("extracts title from H2 heading", () => {
		const content = readFixture("single-story.md");
		const result = parseMarkdownFile(content, "test.md");

		expect(result.stories[0]?.title).toBe(
			"As a user, I want to log in so that I can access my account",
		);
	});

	// ------------------------------------------------------------------
	// Parse fenced YAML metadata
	// ------------------------------------------------------------------

	test("parses fenced YAML metadata (priority, labels, estimate, assignee, status)", () => {
		const content = readFixture("single-story.md");
		const result = parseMarkdownFile(content, "test.md");
		const story = result.stories[0]!;

		expect(story.priority).toBe(2);
		expect(story.labels).toEqual(["Feature", "Auth"]);
		expect(story.estimate).toBe(3);
		expect(story.assignee).toBe("jane@company.com");
		expect(story.status).toBe("Backlog");
	});

	// ------------------------------------------------------------------
	// Return null for empty/missing linear_id
	// ------------------------------------------------------------------

	test("returns null for empty/missing linear_id", () => {
		const content = readFixture("single-story.md");
		const result = parseMarkdownFile(content, "test.md");
		const story = result.stories[0]!;

		expect(story.linearId).toBeNull();
		expect(story.linearUrl).toBeNull();
	});

	// ------------------------------------------------------------------
	// Handle minimal story (just H2 + body, no YAML block, no frontmatter)
	// ------------------------------------------------------------------

	test("handles minimal story with no YAML block and no frontmatter", () => {
		const content = readFixture("minimal-story.md");
		const result = parseMarkdownFile(content, "minimal-story.md");

		expect(result.frontmatter).toEqual({});
		expect(result.stories).toHaveLength(1);

		const story = result.stories[0]!;
		expect(story.title).toBe("As a user, I want to view my profile");
		expect(story.linearId).toBeNull();
		expect(story.linearUrl).toBeNull();
		expect(story.priority).toBeNull();
		expect(story.labels).toEqual([]);
		expect(story.estimate).toBeNull();
		expect(story.assignee).toBeNull();
		expect(story.status).toBeNull();
		expect(story.project).toBeNull();
		expect(story.team).toBeNull();
		expect(story.body).toContain("View user profile details");
		expect(story.body).toContain("Profile page shows user name and email");
	});

	// ------------------------------------------------------------------
	// Inherit project/team from file frontmatter
	// ------------------------------------------------------------------

	test("inherits project and team from file frontmatter", () => {
		const content = readFixture("multi-story.md");
		const result = parseMarkdownFile(content, "test.md");

		for (const story of result.stories) {
			expect(story.project).toBe("Q1 2026 Release");
			expect(story.team).toBe("Engineering");
		}
	});

	// ------------------------------------------------------------------
	// Extract full body including acceptance criteria
	// ------------------------------------------------------------------

	test("extracts full body including acceptance criteria", () => {
		const content = readFixture("single-story.md");
		const result = parseMarkdownFile(content, "test.md");
		const story = result.stories[0]!;

		expect(story.body).toContain("User should be able to log in with their email and password.");
		expect(story.body).toContain(
			"The system should support rate limiting after 5 failed attempts.",
		);
		expect(story.body).toContain("### Acceptance Criteria");
		expect(story.body).toContain("- [ ] User can enter email and password on the login page");
		expect(story.body).toContain("- [ ] Account locks after 5 consecutive failed attempts");
	});

	// ------------------------------------------------------------------
	// Throw ParseError for file with no H2 headings
	// ------------------------------------------------------------------

	test("throws ParseError for file with no H2 headings", () => {
		const content = "# Just a top-level heading\n\nSome text without any H2.";
		expect(() => parseMarkdownFile(content, "no-stories.md")).toThrow(ParseError);
	});

	// ------------------------------------------------------------------
	// Parse story-with-ids.md correctly
	// ------------------------------------------------------------------

	test("parses story-with-ids.md with linear_id and linear_url populated", () => {
		const content = readFixture("story-with-ids.md");
		const result = parseMarkdownFile(content, "story-with-ids.md");

		expect(result.stories).toHaveLength(2);

		const story1 = result.stories[0]!;
		expect(story1.linearId).toBe("ENG-42");
		expect(story1.linearUrl).toBe("https://linear.app/myorg/issue/ENG-42");

		const story2 = result.stories[1]!;
		expect(story2.linearId).toBe("ENG-43");
		expect(story2.linearUrl).toBe("https://linear.app/myorg/issue/ENG-43");
	});
});
