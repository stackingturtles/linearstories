import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LinearClient } from "@linear/sdk";
import { exportStories } from "../../../src/sync/exporter.ts";
import type { ResolvedConfig } from "../../../src/types.ts";

// ---------------------------------------------------------------------------
// Reusable UUIDs
// ---------------------------------------------------------------------------

const TEAM_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const PROJECT_UUID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

// ---------------------------------------------------------------------------
// Default resolved config
// ---------------------------------------------------------------------------

const defaultConfig: ResolvedConfig = {
	apiKey: "test-api-key",
	defaultTeam: "Engineering",
	defaultProject: null,
	defaultLabels: [],
};

// ---------------------------------------------------------------------------
// Helper: create mock issue data that simulates Linear SDK issue objects
// ---------------------------------------------------------------------------

function createMockIssueNode(overrides: Record<string, unknown> = {}) {
	return {
		id: "issue-uuid-1",
		identifier: "ENG-42",
		url: "https://linear.app/myorg/issue/ENG-42",
		title: "As a user, I want to log in",
		description: "Login description.\n\n### Acceptance Criteria\n\n- [ ] User can log in",
		priority: 2,
		estimate: 3,
		state: Promise.resolve({ name: "Backlog" }),
		assignee: Promise.resolve({ email: "jane@co.com", displayName: "Jane" }),
		labels: () => Promise.resolve({ nodes: [{ name: "Feature" }] }),
		project: Promise.resolve({ name: "Q1 Release" }),
		team: Promise.resolve({ name: "Engineering", key: "ENG" }),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Helper: create a mock LinearClient
// ---------------------------------------------------------------------------

function createMockClient(overrides: Record<string, unknown> = {}) {
	return {
		teams: async () => ({ nodes: [{ id: TEAM_UUID }] }),
		projects: async () => ({ nodes: [{ id: PROJECT_UUID }] }),
		issueLabels: async () => ({ nodes: [] }),
		users: async () => ({ nodes: [] }),
		workflowStates: async () => ({ nodes: [] }),
		issues: async () => ({
			nodes: [],
			pageInfo: { hasNextPage: false, endCursor: null },
		}),
		...overrides,
	} as unknown as LinearClient;
}

// ---------------------------------------------------------------------------
// Helper: temp directory for output files
// ---------------------------------------------------------------------------

let tmpDir: string;

function setupTmpDir(): string {
	tmpDir = mkdtempSync(join(tmpdir(), "exporter-test-"));
	return tmpDir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("exportStories", () => {
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
	// Basic fetching
	// =========================================================================

	test("fetches issues from Linear using provided filters", async () => {
		const issuesFn = mock(async (opts: Record<string, unknown>) => {
			expect(opts.filter).toBeDefined();
			return {
				nodes: [createMockIssueNode()],
				pageInfo: { hasNextPage: false, endCursor: null },
			};
		});
		const client = createMockClient({ issues: issuesFn });
		const outputPath = join(tmpDir, "output.md");

		const result = await exportStories(client, {
			config: defaultConfig,
			filters: { project: "Q1 Release" },
			outputPath,
		});

		expect(issuesFn).toHaveBeenCalled();
		expect(result.count).toBe(1);
	});

	// =========================================================================
	// Serialization
	// =========================================================================

	test("serializes fetched issues into markdown with multi-story format", async () => {
		const issue1 = createMockIssueNode({
			id: "uuid-1",
			identifier: "ENG-42",
			url: "https://linear.app/myorg/issue/ENG-42",
			title: "As a user, I want to log in",
			description: "Login description.",
			priority: 2,
			estimate: 3,
		});
		const issue2 = createMockIssueNode({
			id: "uuid-2",
			identifier: "ENG-43",
			url: "https://linear.app/myorg/issue/ENG-43",
			title: "As a user, I want to sign up",
			description: "Signup description.",
			priority: 3,
			estimate: 2,
			assignee: Promise.resolve(null),
			state: Promise.resolve(null),
		});

		const client = createMockClient({
			issues: async () => ({
				nodes: [issue1, issue2],
				pageInfo: { hasNextPage: false, endCursor: null },
			}),
		});
		const outputPath = join(tmpDir, "multi.md");

		await exportStories(client, {
			config: defaultConfig,
			filters: {},
			outputPath,
		});

		const content = readFileSync(outputPath, "utf-8");

		// Both stories should be in the output
		expect(content).toContain("## As a user, I want to log in");
		expect(content).toContain("## As a user, I want to sign up");

		// Should have two H2 headings
		const h2Count = (content.match(/^## /gm) || []).length;
		expect(h2Count).toBe(2);
	});

	// =========================================================================
	// Output includes YAML blocks with linear_id and linear_url
	// =========================================================================

	test("output includes per-story YAML blocks with linear_id and linear_url", async () => {
		const client = createMockClient({
			issues: async () => ({
				nodes: [createMockIssueNode()],
				pageInfo: { hasNextPage: false, endCursor: null },
			}),
		});
		const outputPath = join(tmpDir, "yaml.md");

		await exportStories(client, {
			config: defaultConfig,
			filters: {},
			outputPath,
		});

		const content = readFileSync(outputPath, "utf-8");

		expect(content).toContain("linear_id: ENG-42");
		expect(content).toContain("linear_url: https://linear.app/myorg/issue/ENG-42");
		expect(content).toContain("```yaml");
		expect(content).toContain("```");
	});

	// =========================================================================
	// Empty result set
	// =========================================================================

	test("handles empty result set (no issues found)", async () => {
		const client = createMockClient({
			issues: async () => ({
				nodes: [],
				pageInfo: { hasNextPage: false, endCursor: null },
			}),
		});
		const outputPath = join(tmpDir, "empty.md");

		const result = await exportStories(client, {
			config: defaultConfig,
			filters: { project: "Nonexistent" },
			outputPath,
		});

		expect(result.count).toBe(0);
		// File should still be created (possibly empty or minimal)
		expect(existsSync(outputPath)).toBe(true);
	});

	// =========================================================================
	// Writes to specified output path
	// =========================================================================

	test("writes to specified output path", async () => {
		const client = createMockClient({
			issues: async () => ({
				nodes: [createMockIssueNode()],
				pageInfo: { hasNextPage: false, endCursor: null },
			}),
		});
		const outputPath = join(tmpDir, "specific-output.md");

		const result = await exportStories(client, {
			config: defaultConfig,
			filters: {},
			outputPath,
		});

		expect(result.outputPath).toBe(outputPath);
		expect(existsSync(outputPath)).toBe(true);

		const content = readFileSync(outputPath, "utf-8");
		expect(content.length).toBeGreaterThan(0);
	});

	// =========================================================================
	// Output includes frontmatter when team is provided
	// =========================================================================

	test("output includes frontmatter when team filter is used", async () => {
		const client = createMockClient({
			issues: async () => ({
				nodes: [createMockIssueNode()],
				pageInfo: { hasNextPage: false, endCursor: null },
			}),
		});
		const outputPath = join(tmpDir, "frontmatter.md");

		await exportStories(client, {
			config: defaultConfig,
			filters: { project: "Q1 Release" },
			team: "Engineering",
			outputPath,
		});

		const content = readFileSync(outputPath, "utf-8");
		// The serializer should include team frontmatter
		expect(content).toContain("---");
		expect(content).toContain("team:");
	});

	// =========================================================================
	// Returned result has correct shape
	// =========================================================================

	test("returns count and outputPath", async () => {
		const client = createMockClient({
			issues: async () => ({
				nodes: [createMockIssueNode(), createMockIssueNode({ id: "uuid-2", identifier: "ENG-43" })],
				pageInfo: { hasNextPage: false, endCursor: null },
			}),
		});
		const outputPath = join(tmpDir, "result.md");

		const result = await exportStories(client, {
			config: defaultConfig,
			filters: {},
			outputPath,
		});

		expect(result.count).toBe(2);
		expect(result.outputPath).toBe(outputPath);
	});
});
