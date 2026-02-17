import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeBackIds } from "../../../src/markdown/writer.ts";

const FIXTURES_DIR = join(import.meta.dir, "../../fixtures");

function readFixture(name: string): string {
	return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

describe("writeBackIds", () => {
	// ------------------------------------------------------------------
	// Updates linear_id and linear_url in correct story's YAML block
	// ------------------------------------------------------------------

	test("updates linear_id and linear_url in correct story's YAML block", () => {
		const content = readFixture("single-story.md");
		const updates = [
			{
				title: "As a user, I want to log in so that I can access my account",
				linearId: "ENG-42",
				linearUrl: "https://linear.app/myorg/issue/ENG-42",
			},
		];

		const result = writeBackIds("single-story.md", content, updates);

		expect(result).toContain("linear_id: ENG-42");
		expect(result).toContain("linear_url: https://linear.app/myorg/issue/ENG-42");
	});

	// ------------------------------------------------------------------
	// Preserves all other content exactly
	// ------------------------------------------------------------------

	test("preserves all other content exactly (frontmatter, body, acceptance criteria)", () => {
		const content = readFixture("single-story.md");
		const updates = [
			{
				title: "As a user, I want to log in so that I can access my account",
				linearId: "ENG-42",
				linearUrl: "https://linear.app/myorg/issue/ENG-42",
			},
		];

		const result = writeBackIds("single-story.md", content, updates);

		// Frontmatter preserved
		expect(result).toContain('project: "Q1 2026 Release"');
		expect(result).toContain('team: "Engineering"');

		// Metadata preserved
		expect(result).toContain("priority: 2");
		expect(result).toContain("labels: [Feature, Auth]");
		expect(result).toContain("estimate: 3");
		expect(result).toContain("assignee: jane@company.com");
		expect(result).toContain("status: Backlog");

		// Body preserved
		expect(result).toContain("User should be able to log in with their email and password.");
		expect(result).toContain("The system should support rate limiting after 5 failed attempts.");

		// Acceptance criteria preserved
		expect(result).toContain("### Acceptance Criteria");
		expect(result).toContain("- [ ] User can enter email and password on the login page");
		expect(result).toContain("- [ ] Account locks after 5 consecutive failed attempts");
	});

	// ------------------------------------------------------------------
	// Works for story that had no YAML block (inserts one after H2)
	// ------------------------------------------------------------------

	test("inserts YAML block after H2 for story that had no YAML block", () => {
		const content = readFixture("minimal-story.md");
		const updates = [
			{
				title: "As a user, I want to view my profile",
				linearId: "ENG-99",
				linearUrl: "https://linear.app/myorg/issue/ENG-99",
			},
		];

		const result = writeBackIds("minimal-story.md", content, updates);

		expect(result).toContain("linear_id: ENG-99");
		expect(result).toContain("linear_url: https://linear.app/myorg/issue/ENG-99");
		// Body content should still be present
		expect(result).toContain("View user profile details including name, email, and avatar.");
		expect(result).toContain("### Acceptance Criteria");

		// The YAML block should come after the H2 heading
		const h2Index = result.indexOf("## As a user, I want to view my profile");
		const yamlBlockIndex = result.indexOf("```yaml");
		const bodyIndex = result.indexOf("View user profile details");
		expect(yamlBlockIndex).toBeGreaterThan(h2Index);
		expect(bodyIndex).toBeGreaterThan(yamlBlockIndex);
	});

	// ------------------------------------------------------------------
	// Handles multi-story file (updates correct story, leaves others unchanged)
	// ------------------------------------------------------------------

	test("handles multi-story file - updates correct story, leaves others unchanged", () => {
		const content = readFixture("multi-story.md");
		const updates = [
			{
				title: "As a user, I want to reset my password so that I can regain access",
				linearId: "ENG-43",
				linearUrl: "https://linear.app/myorg/issue/ENG-43",
			},
		];

		const result = writeBackIds("multi-story.md", content, updates);

		// Second story should be updated
		expect(result).toContain("linear_id: ENG-43");
		expect(result).toContain("linear_url: https://linear.app/myorg/issue/ENG-43");

		// First story should remain unchanged (linear_id and linear_url still empty)
		// We need to check the first story's YAML block has empty linear_id
		// Split at second story to isolate first story
		const secondStoryStart = result.indexOf("## As a user, I want to reset my password");
		const firstStoryContent = result.slice(0, secondStoryStart);
		// First story should NOT have ENG-43
		expect(firstStoryContent).not.toContain("ENG-43");
		// First story linear_id should still be empty
		expect(firstStoryContent).toContain("linear_id:");
		// It should not have a non-empty linear_id value
		const firstYamlMatch = firstStoryContent.match(/linear_id:(.*)/);
		expect(firstYamlMatch).not.toBeNull();
		expect(firstYamlMatch?.[1]?.trim()).toBe("");

		// Both story bodies should be intact
		expect(result).toContain("User should be able to log in with their email and password.");
		expect(result).toContain("User should be able to reset their password via email link.");
	});

	// ------------------------------------------------------------------
	// Updates multiple stories in one call
	// ------------------------------------------------------------------

	test("updates multiple stories in one call", () => {
		const content = readFixture("multi-story.md");
		const updates = [
			{
				title: "As a user, I want to log in so that I can access my account",
				linearId: "ENG-42",
				linearUrl: "https://linear.app/myorg/issue/ENG-42",
			},
			{
				title: "As a user, I want to reset my password so that I can regain access",
				linearId: "ENG-43",
				linearUrl: "https://linear.app/myorg/issue/ENG-43",
			},
		];

		const result = writeBackIds("multi-story.md", content, updates);

		expect(result).toContain("linear_id: ENG-42");
		expect(result).toContain("linear_url: https://linear.app/myorg/issue/ENG-42");
		expect(result).toContain("linear_id: ENG-43");
		expect(result).toContain("linear_url: https://linear.app/myorg/issue/ENG-43");
	});
});
