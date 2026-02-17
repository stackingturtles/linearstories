import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LinearClient } from "@linear/sdk";
import { importStories } from "../../src/sync/importer.ts";
import type { ResolvedConfig } from "../../src/types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIXTURES_DIR = join(import.meta.dir, "..", "fixtures");

const defaultConfig: ResolvedConfig = {
	apiKey: "test-api-key",
	defaultTeam: "Engineering",
	defaultProject: "Q1 2026 Release",
	defaultLabels: [],
};

// ---------------------------------------------------------------------------
// Temp directory helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function setupTmpDir(): string {
	tmpDir = mkdtempSync(join(tmpdir(), "integration-import-"));
	return tmpDir;
}

function copyFixtureToTmp(fixtureName: string, destName?: string): string {
	const src = join(FIXTURES_DIR, fixtureName);
	const dest = join(tmpDir, destName ?? fixtureName);
	copyFileSync(src, dest);
	return dest;
}

function writeTmpFile(name: string, content: string): string {
	const filePath = join(tmpDir, name);
	writeFileSync(filePath, content);
	return filePath;
}

function readTmpFile(filePath: string): string {
	return readFileSync(filePath, "utf-8");
}

// ---------------------------------------------------------------------------
// Mock client factory for integration tests
// ---------------------------------------------------------------------------

function createIntegrationMockClient(overrides: Record<string, unknown> = {}) {
	let createCallCount = 0;
	return {
		teams: async () => ({ nodes: [{ id: "team-uuid" }] }),
		projects: async () => ({ nodes: [{ id: "project-uuid" }] }),
		issueLabels: async () => ({ nodes: [{ id: "label-uuid" }] }),
		users: async () => ({ nodes: [{ id: "user-uuid" }] }),
		workflowStates: async () => ({ nodes: [{ id: "state-uuid" }] }),
		createIssue: async (input: any) => {
			createCallCount++;
			const mockIssue = {
				id: `issue-uuid-${createCallCount}`,
				identifier: `ENG-${41 + createCallCount}`,
				url: `https://linear.app/myorg/issue/ENG-${41 + createCallCount}`,
				title: input.title,
				description: input.description,
			};
			return { success: true, issue: Promise.resolve(mockIssue) };
		},
		updateIssue: async (_id: string, _input: any) => ({
			success: true,
			issue: Promise.resolve({
				id: "issue-uuid-1",
				identifier: "ENG-42",
				url: "https://linear.app/myorg/issue/ENG-42",
			}),
		}),
		issues: async () => ({
			nodes: [],
			pageInfo: { hasNextPage: false, endCursor: null },
		}),
		...overrides,
	} as unknown as LinearClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Integration: Import Flow", () => {
	beforeEach(() => {
		setupTmpDir();
	});

	afterEach(() => {
		try {
			rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	});

	// =========================================================================
	// Full import: new stories
	// =========================================================================

	test("full import: new stories - writes back linear_id and linear_url, summary shows correct counts", async () => {
		// Copy the single-story fixture (has no linear_id) to a temp directory
		const filePath = copyFixtureToTmp("single-story.md");
		const client = createIntegrationMockClient();

		const summary = await importStories(client, {
			files: [filePath],
			config: defaultConfig,
		});

		// Verify summary counts
		expect(summary.total).toBe(1);
		expect(summary.created).toBe(1);
		expect(summary.updated).toBe(0);
		expect(summary.failed).toBe(0);
		expect(summary.skipped).toBe(0);

		// Verify the result details
		expect(summary.results[0]?.action).toBe("created");
		expect(summary.results[0]?.linearId).toBe("ENG-42");
		expect(summary.results[0]?.linearUrl).toBe("https://linear.app/myorg/issue/ENG-42");

		// Verify write-back: the file should now contain linear_id and linear_url
		const updatedContent = readTmpFile(filePath);
		expect(updatedContent).toContain("linear_id: ENG-42");
		expect(updatedContent).toContain("linear_url: https://linear.app/myorg/issue/ENG-42");

		// The original fixture content should still be present
		expect(updatedContent).toContain(
			"## As a user, I want to log in so that I can access my account",
		);
		expect(updatedContent).toContain("### Acceptance Criteria");
		expect(updatedContent).toContain("priority: 2");
	});

	test("full import: new multi-story file - all stories get IDs written back", async () => {
		// Copy the multi-story fixture (two stories, both without linear_id)
		const filePath = copyFixtureToTmp("multi-story.md");
		const client = createIntegrationMockClient();

		const summary = await importStories(client, {
			files: [filePath],
			config: defaultConfig,
		});

		// Verify summary counts
		expect(summary.total).toBe(2);
		expect(summary.created).toBe(2);
		expect(summary.updated).toBe(0);
		expect(summary.failed).toBe(0);

		// Verify both results have linear IDs
		expect(summary.results[0]?.linearId).toBe("ENG-42");
		expect(summary.results[1]?.linearId).toBe("ENG-43");

		// Verify write-back for both stories
		const updatedContent = readTmpFile(filePath);
		expect(updatedContent).toContain("linear_id: ENG-42");
		expect(updatedContent).toContain("linear_url: https://linear.app/myorg/issue/ENG-42");
		expect(updatedContent).toContain("linear_id: ENG-43");
		expect(updatedContent).toContain("linear_url: https://linear.app/myorg/issue/ENG-43");
	});

	// =========================================================================
	// Full import: existing stories (update)
	// =========================================================================

	test("full import: existing stories - calls updateIssue, not createIssue, preserves file content", async () => {
		// Copy the story-with-ids fixture (stories already have linear_id)
		const filePath = copyFixtureToTmp("story-with-ids.md");
		const originalContent = readTmpFile(filePath);

		let createCalled = false;
		let updateCallCount = 0;

		const client = createIntegrationMockClient({
			createIssue: async () => {
				createCalled = true;
				return {
					success: true,
					issue: Promise.resolve({
						id: "should-not-be-called",
						identifier: "ENG-999",
						url: "https://linear.app/myorg/issue/ENG-999",
					}),
				};
			},
			updateIssue: async (_id: string, _input: any) => {
				updateCallCount++;
				return {
					success: true,
					issue: Promise.resolve({
						id: "issue-uuid-existing",
						identifier: "ENG-42",
						url: "https://linear.app/myorg/issue/ENG-42",
					}),
				};
			},
		});

		const summary = await importStories(client, {
			files: [filePath],
			config: defaultConfig,
		});

		// Verify: updateIssue was called (not createIssue)
		expect(createCalled).toBe(false);
		expect(updateCallCount).toBe(2); // Two stories in fixture

		// Verify summary
		expect(summary.total).toBe(2);
		expect(summary.updated).toBe(2);
		expect(summary.created).toBe(0);

		// Verify file content is preserved (updates don't trigger write-back since
		// the write-back only runs for "created" stories)
		const afterContent = readTmpFile(filePath);
		expect(afterContent).toBe(originalContent);
	});

	// =========================================================================
	// Full import: multiple files
	// =========================================================================

	test("full import: multiple files - all stories processed, both files updated", async () => {
		// Create two temporary markdown files with new stories (no linear_id)
		const file1Content = `---
project: "Q1 2026 Release"
team: "Engineering"
---

## As a user, I want to view my dashboard

\`\`\`yaml
linear_id:
linear_url:
priority: 2
labels: [Feature]
estimate: 3
\`\`\`

Dashboard view with key metrics.

### Acceptance Criteria

- [ ] Dashboard shows overview widgets
`;

		const file2Content = `---
project: "Q1 2026 Release"
team: "Engineering"
---

## As an admin, I want to manage users

\`\`\`yaml
linear_id:
linear_url:
priority: 1
labels: [Admin]
estimate: 5
\`\`\`

Admin user management panel.

### Acceptance Criteria

- [ ] Admin can view all users
- [ ] Admin can deactivate a user
`;

		const file1Path = writeTmpFile("file1.md", file1Content);
		const file2Path = writeTmpFile("file2.md", file2Content);

		const client = createIntegrationMockClient();

		const summary = await importStories(client, {
			files: [file1Path, file2Path],
			config: defaultConfig,
		});

		// Verify all stories processed
		expect(summary.total).toBe(2);
		expect(summary.created).toBe(2);
		expect(summary.failed).toBe(0);

		// Verify file1 was updated with write-back
		const file1Updated = readTmpFile(file1Path);
		expect(file1Updated).toContain("linear_id: ENG-42");
		expect(file1Updated).toContain("linear_url: https://linear.app/myorg/issue/ENG-42");

		// Verify file2 was updated with write-back
		const file2Updated = readTmpFile(file2Path);
		expect(file2Updated).toContain("linear_id: ENG-43");
		expect(file2Updated).toContain("linear_url: https://linear.app/myorg/issue/ENG-43");

		// Verify original content is preserved in both files
		expect(file1Updated).toContain("## As a user, I want to view my dashboard");
		expect(file2Updated).toContain("## As an admin, I want to manage users");
	});

	// =========================================================================
	// Full import: --dry-run
	// =========================================================================

	test("full import: --dry-run - no API calls made, file not modified", async () => {
		const filePath = copyFixtureToTmp("single-story.md");
		const originalContent = readTmpFile(filePath);

		let createCalled = false;
		let updateCalled = false;

		const client = createIntegrationMockClient({
			createIssue: async () => {
				createCalled = true;
				return {
					success: true,
					issue: Promise.resolve({
						id: "should-not-be-called",
						identifier: "ENG-999",
						url: "https://linear.app/myorg/issue/ENG-999",
					}),
				};
			},
			updateIssue: async () => {
				updateCalled = true;
				return {
					success: true,
					issue: Promise.resolve({
						id: "should-not-be-called",
						identifier: "ENG-999",
						url: "https://linear.app/myorg/issue/ENG-999",
					}),
				};
			},
		});

		const summary = await importStories(client, {
			files: [filePath],
			config: defaultConfig,
			dryRun: true,
		});

		// Verify: no API calls made
		expect(createCalled).toBe(false);
		expect(updateCalled).toBe(false);

		// Verify: summary reports skipped
		expect(summary.total).toBe(1);
		expect(summary.skipped).toBe(1);
		expect(summary.created).toBe(0);
		expect(summary.updated).toBe(0);
		expect(summary.failed).toBe(0);

		// Verify: file is NOT modified
		const afterContent = readTmpFile(filePath);
		expect(afterContent).toBe(originalContent);
	});

	// =========================================================================
	// Full import: partial failure
	// =========================================================================

	test("full import: partial failure - both processed, summary shows 1 created and 1 failed", async () => {
		// Use multi-story fixture with two new stories
		const filePath = copyFixtureToTmp("multi-story.md");

		let createCallCount = 0;

		const client = createIntegrationMockClient({
			createIssue: async (_input: any) => {
				createCallCount++;
				if (createCallCount === 1) {
					// First story fails
					throw new Error("Linear API rate limit exceeded");
				}
				// Second story succeeds
				return {
					success: true,
					issue: Promise.resolve({
						id: "issue-uuid-2",
						identifier: "ENG-50",
						url: "https://linear.app/myorg/issue/ENG-50",
					}),
				};
			},
		});

		const summary = await importStories(client, {
			files: [filePath],
			config: defaultConfig,
		});

		// Both stories were processed
		expect(summary.total).toBe(2);

		// First story failed
		expect(summary.results[0]?.action).toBe("failed");
		expect(summary.results[0]?.error).toBeDefined();
		expect(summary.results[0]?.error).toContain("rate limit");

		// Second story succeeded
		expect(summary.results[1]?.action).toBe("created");
		expect(summary.results[1]?.linearId).toBe("ENG-50");

		// Summary counts
		expect(summary.failed).toBe(1);
		expect(summary.created).toBe(1);

		// The successful story should have its ID written back
		const updatedContent = readTmpFile(filePath);
		expect(updatedContent).toContain("linear_id: ENG-50");
		expect(updatedContent).toContain("linear_url: https://linear.app/myorg/issue/ENG-50");
	});
});
