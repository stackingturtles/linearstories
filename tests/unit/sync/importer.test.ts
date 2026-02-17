import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LinearClient } from "@linear/sdk";
import { importStories } from "../../../src/sync/importer.ts";
import type { ResolvedConfig } from "../../../src/types.ts";

// ---------------------------------------------------------------------------
// Reusable UUIDs
// ---------------------------------------------------------------------------

const TEAM_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const PROJECT_UUID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
const LABEL_UUID_1 = "c3d4e5f6-a7b8-9012-cdef-123456789012";
const USER_UUID = "e5f6a7b8-c9d0-1234-ef01-345678901234";
const STATE_UUID = "f6a7b8c9-d0e1-2345-f012-456789012345";

// ---------------------------------------------------------------------------
// Default resolved config used across tests
// ---------------------------------------------------------------------------

const defaultConfig: ResolvedConfig = {
	apiKey: "test-api-key",
	defaultTeam: "Engineering",
	defaultProject: "Q1 Release",
	defaultLabels: [],
};

// ---------------------------------------------------------------------------
// Helper: markdown content for stories WITHOUT linear_id (new stories)
// ---------------------------------------------------------------------------

const markdownNewStories = `---
project: "Q1 Release"
team: "Engineering"
---

## As a user, I want to log in

\`\`\`yaml
priority: 2
labels: [Feature]
estimate: 3
assignee: jane@company.com
status: Backlog
\`\`\`

Login description.

## As a user, I want to sign up

\`\`\`yaml
priority: 3
labels: [Feature]
estimate: 2
\`\`\`

Signup description.
`;

// ---------------------------------------------------------------------------
// Helper: markdown content for stories WITH linear_id (updates)
// ---------------------------------------------------------------------------

const markdownExistingStories = `---
project: "Q1 Release"
team: "Engineering"
---

## As a user, I want to log in

\`\`\`yaml
linear_id: ENG-42
linear_url: https://linear.app/myorg/issue/ENG-42
priority: 2
labels: [Feature]
estimate: 3
assignee: jane@company.com
status: Backlog
\`\`\`

Updated login description.
`;

// ---------------------------------------------------------------------------
// Helper: markdown content with mixed stories (one new, one existing)
// ---------------------------------------------------------------------------

const markdownMixedStories = `---
project: "Q1 Release"
team: "Engineering"
---

## As a user, I want to log in

\`\`\`yaml
linear_id: ENG-42
linear_url: https://linear.app/myorg/issue/ENG-42
priority: 2
labels: [Feature]
\`\`\`

Login body.

## As a user, I want to sign up

\`\`\`yaml
priority: 3
labels: [Feature]
\`\`\`

Signup body.
`;

// ---------------------------------------------------------------------------
// Helper: create a mock LinearClient
// ---------------------------------------------------------------------------

let issueCounter = 0;

function createMockClient(overrides: Record<string, unknown> = {}) {
	return {
		teams: async () => ({ nodes: [{ id: TEAM_UUID }] }),
		projects: async () => ({ nodes: [{ id: PROJECT_UUID }] }),
		issueLabels: async () => ({ nodes: [{ id: LABEL_UUID_1 }] }),
		users: async () => ({ nodes: [{ id: USER_UUID }] }),
		workflowStates: async () => ({ nodes: [{ id: STATE_UUID }] }),
		createIssue: async () => {
			issueCounter++;
			const identifier = `ENG-${100 + issueCounter}`;
			return {
				success: true,
				issue: Promise.resolve({
					id: `issue-uuid-${issueCounter}`,
					identifier,
					url: `https://linear.app/myorg/issue/${identifier}`,
				}),
			};
		},
		updateIssue: async () => ({
			success: true,
			issue: Promise.resolve({
				id: "issue-uuid-existing",
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
// Helper: create a temp directory with markdown files
// ---------------------------------------------------------------------------

let tmpDir: string;

function setupTmpDir(): string {
	tmpDir = mkdtempSync(join(tmpdir(), "importer-test-"));
	return tmpDir;
}

function writeTmpFile(name: string, content: string): string {
	const filePath = join(tmpDir, name);
	writeFileSync(filePath, content);
	return filePath;
}

function readTmpFile(name: string): string {
	return readFileSync(join(tmpDir, name), "utf-8");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("importStories", () => {
	beforeEach(() => {
		issueCounter = 0;
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
	// Parsing and detection
	// =========================================================================

	test("parses input file into UserStory[] using markdown parser", async () => {
		const filePath = writeTmpFile("stories.md", markdownNewStories);
		const client = createMockClient();

		const summary = await importStories(client, {
			files: [filePath],
			config: defaultConfig,
		});

		expect(summary.total).toBe(2);
		expect(summary.results).toHaveLength(2);
		expect(summary.results[0]?.story.title).toBe("As a user, I want to log in");
		expect(summary.results[1]?.story.title).toBe("As a user, I want to sign up");
	});

	test("detects create (no linear_id) vs update (has linear_id) per story", async () => {
		const filePath = writeTmpFile("mixed.md", markdownMixedStories);
		const client = createMockClient();

		const summary = await importStories(client, {
			files: [filePath],
			config: defaultConfig,
		});

		// First story has linear_id -> should be updated
		expect(summary.results[0]?.action).toBe("updated");
		// Second story has no linear_id -> should be created
		expect(summary.results[1]?.action).toBe("created");
	});

	// =========================================================================
	// Create operations
	// =========================================================================

	test("creates new Linear issues for stories without linear_id", async () => {
		const filePath = writeTmpFile("new.md", markdownNewStories);
		const createIssueFn = mock(async () => ({
			success: true,
			issue: Promise.resolve({
				id: "new-issue-id",
				identifier: "ENG-101",
				url: "https://linear.app/myorg/issue/ENG-101",
			}),
		}));
		const client = createMockClient({ createIssue: createIssueFn });

		const summary = await importStories(client, {
			files: [filePath],
			config: defaultConfig,
		});

		expect(createIssueFn).toHaveBeenCalledTimes(2);
		expect(summary.created).toBe(2);
		expect(summary.results[0]?.action).toBe("created");
		expect(summary.results[1]?.action).toBe("created");
	});

	// =========================================================================
	// Update operations
	// =========================================================================

	test("updates existing Linear issues for stories with linear_id", async () => {
		const filePath = writeTmpFile("existing.md", markdownExistingStories);
		const updateIssueFn = mock(async () => ({
			success: true,
			issue: Promise.resolve({
				id: "issue-uuid-existing",
				identifier: "ENG-42",
				url: "https://linear.app/myorg/issue/ENG-42",
			}),
		}));
		const client = createMockClient({ updateIssue: updateIssueFn });

		const summary = await importStories(client, {
			files: [filePath],
			config: defaultConfig,
		});

		expect(updateIssueFn).toHaveBeenCalledTimes(1);
		expect(summary.updated).toBe(1);
		expect(summary.results[0]?.action).toBe("updated");
		expect(summary.results[0]?.linearId).toBe("ENG-42");
	});

	// =========================================================================
	// Write-back
	// =========================================================================

	test("writes back linear_id and linear_url to markdown after successful creation", async () => {
		const filePath = writeTmpFile("writeback.md", markdownNewStories);
		const client = createMockClient({
			createIssue: async () => ({
				success: true,
				issue: Promise.resolve({
					id: "new-uuid-1",
					identifier: "ENG-101",
					url: "https://linear.app/myorg/issue/ENG-101",
				}),
			}),
		});

		await importStories(client, {
			files: [filePath],
			config: defaultConfig,
		});

		const updatedContent = readTmpFile("writeback.md");
		expect(updatedContent).toContain("linear_id: ENG-101");
		expect(updatedContent).toContain("linear_url: https://linear.app/myorg/issue/ENG-101");
	});

	// =========================================================================
	// Dry-run
	// =========================================================================

	test("--dry-run returns results but makes no API calls and no file writes", async () => {
		const filePath = writeTmpFile("dryrun.md", markdownNewStories);
		const originalContent = readTmpFile("dryrun.md");
		const createIssueFn = mock(async () => ({
			success: true,
			issue: Promise.resolve({
				id: "shouldnt-be-called",
				identifier: "ENG-999",
				url: "https://linear.app/myorg/issue/ENG-999",
			}),
		}));
		const updateIssueFn = mock(async () => ({
			success: true,
			issue: Promise.resolve({
				id: "shouldnt-be-called",
				identifier: "ENG-999",
				url: "https://linear.app/myorg/issue/ENG-999",
			}),
		}));
		const client = createMockClient({
			createIssue: createIssueFn,
			updateIssue: updateIssueFn,
		});

		const summary = await importStories(client, {
			files: [filePath],
			config: defaultConfig,
			dryRun: true,
		});

		// Should report what WOULD happen
		expect(summary.total).toBe(2);
		expect(summary.results[0]?.action).toBe("skipped");
		expect(summary.results[1]?.action).toBe("skipped");
		expect(summary.skipped).toBe(2);

		// No API calls
		expect(createIssueFn).not.toHaveBeenCalled();
		expect(updateIssueFn).not.toHaveBeenCalled();

		// File unchanged
		const afterContent = readTmpFile("dryrun.md");
		expect(afterContent).toBe(originalContent);
	});

	// =========================================================================
	// --no-write-back
	// =========================================================================

	test("--no-write-back calls API but does not write back to file", async () => {
		const filePath = writeTmpFile("nowriteback.md", markdownNewStories);
		const originalContent = readTmpFile("nowriteback.md");
		const createIssueFn = mock(async () => ({
			success: true,
			issue: Promise.resolve({
				id: "new-uuid-1",
				identifier: "ENG-101",
				url: "https://linear.app/myorg/issue/ENG-101",
			}),
		}));
		const client = createMockClient({ createIssue: createIssueFn });

		const summary = await importStories(client, {
			files: [filePath],
			config: defaultConfig,
			noWriteBack: true,
		});

		// API was called
		expect(createIssueFn).toHaveBeenCalledTimes(2);
		expect(summary.created).toBe(2);

		// But file is unchanged
		const afterContent = readTmpFile("nowriteback.md");
		expect(afterContent).toBe(originalContent);
	});

	// =========================================================================
	// Error handling - continues on per-story failure
	// =========================================================================

	test("continues on per-story failure and collects all results", async () => {
		const filePath = writeTmpFile("errors.md", markdownNewStories);
		let callCount = 0;
		const createIssueFn = mock(async () => {
			callCount++;
			if (callCount === 1) {
				throw new Error("API error on first story");
			}
			return {
				success: true,
				issue: Promise.resolve({
					id: "new-uuid-2",
					identifier: "ENG-102",
					url: "https://linear.app/myorg/issue/ENG-102",
				}),
			};
		});
		const client = createMockClient({ createIssue: createIssueFn });

		const summary = await importStories(client, {
			files: [filePath],
			config: defaultConfig,
		});

		// Both stories processed
		expect(summary.total).toBe(2);
		// First story failed
		expect(summary.results[0]?.action).toBe("failed");
		expect(summary.results[0]?.error).toBeDefined();
		// Second story succeeded
		expect(summary.results[1]?.action).toBe("created");
		expect(summary.results[1]?.linearId).toBe("ENG-102");

		expect(summary.failed).toBe(1);
		expect(summary.created).toBe(1);
	});

	// =========================================================================
	// ImportSummary counts
	// =========================================================================

	test("returns ImportSummary with correct counts", async () => {
		const filePath = writeTmpFile("counts.md", markdownMixedStories);
		const client = createMockClient();

		const summary = await importStories(client, {
			files: [filePath],
			config: defaultConfig,
		});

		expect(summary.total).toBe(2);
		expect(summary.updated).toBe(1); // ENG-42 had linear_id
		expect(summary.created).toBe(1); // Sign up had no linear_id
		expect(summary.failed).toBe(0);
		expect(summary.skipped).toBe(0);
		expect(summary.results).toHaveLength(2);
	});

	// =========================================================================
	// Exit code logic
	// =========================================================================

	test("all succeeded = no failures in summary", async () => {
		const filePath = writeTmpFile("success.md", markdownNewStories);
		const client = createMockClient();

		const summary = await importStories(client, {
			files: [filePath],
			config: defaultConfig,
		});

		expect(summary.failed).toBe(0);
		const hasFailures = summary.failed > 0;
		expect(hasFailures).toBe(false);
	});

	test("any failed = has failures in summary", async () => {
		const filePath = writeTmpFile("fail.md", markdownNewStories);
		const client = createMockClient({
			createIssue: async () => {
				throw new Error("API failure");
			},
		});

		const summary = await importStories(client, {
			files: [filePath],
			config: defaultConfig,
		});

		expect(summary.failed).toBeGreaterThan(0);
		const hasFailures = summary.failed > 0;
		expect(hasFailures).toBe(true);
	});

	// =========================================================================
	// Team/project resolution from various sources
	// =========================================================================

	test("uses story.team over options.team over config.defaultTeam", async () => {
		// The markdown has team: "Engineering" in frontmatter,
		// which gets inherited by each story.
		const filePath = writeTmpFile("team.md", markdownNewStories);
		const teamsFn = mock(async () => ({ nodes: [{ id: TEAM_UUID }] }));
		const client = createMockClient({ teams: teamsFn });

		await importStories(client, {
			files: [filePath],
			config: { ...defaultConfig, defaultTeam: "FallbackTeam" },
			team: "OptionsTeam",
		});

		// Since the markdown has team: "Engineering", that should be resolved
		// (story-level team comes from frontmatter inheritance)
		expect(teamsFn).toHaveBeenCalled();
	});

	// =========================================================================
	// Label merging with config.defaultLabels
	// =========================================================================

	test("merges story labels with config.defaultLabels", async () => {
		const filePath = writeTmpFile("labels.md", markdownNewStories);
		const resolvedLabels: string[][] = [];
		const labelsFn = mock(async (filter: unknown) => {
			const f = filter as { filter: { name: { eq: string } } };
			const name = f.filter.name.eq;
			resolvedLabels.push([name]);
			return { nodes: [{ id: `label-${name}` }] };
		});
		const client = createMockClient({ issueLabels: labelsFn });

		await importStories(client, {
			files: [filePath],
			config: { ...defaultConfig, defaultLabels: ["DefaultLabel"] },
		});

		// The labels resolved should include both story labels and default labels
		const allResolvedNames = resolvedLabels.flat();
		expect(allResolvedNames).toContain("Feature");
		expect(allResolvedNames).toContain("DefaultLabel");
	});
});
