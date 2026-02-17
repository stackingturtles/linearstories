import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LinearClient } from "@linear/sdk";
import { exportStories } from "../../src/sync/exporter.ts";
import type { ResolvedConfig } from "../../src/types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const defaultConfig: ResolvedConfig = {
	apiKey: "test-api-key",
	defaultTeam: "Engineering",
	defaultProject: null,
	defaultLabels: [],
};

// ---------------------------------------------------------------------------
// Temp directory helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function setupTmpDir(): string {
	tmpDir = mkdtempSync(join(tmpdir(), "integration-export-"));
	return tmpDir;
}

// ---------------------------------------------------------------------------
// Mock client factory for export integration tests
// ---------------------------------------------------------------------------

function createExportMockClient(issues: any[]) {
	return {
		teams: async () => ({ nodes: [{ id: "team-uuid" }] }),
		projects: async () => ({ nodes: [{ id: "project-uuid" }] }),
		issueLabels: async () => ({ nodes: [] }),
		users: async () => ({ nodes: [] }),
		workflowStates: async () => ({ nodes: [] }),
		issues: async () => ({
			nodes: issues,
			pageInfo: { hasNextPage: false, endCursor: null },
		}),
	} as unknown as LinearClient;
}

// ---------------------------------------------------------------------------
// Mock issue factory
// ---------------------------------------------------------------------------

function createMockExportIssue(overrides: Record<string, unknown> = {}) {
	return {
		id: "issue-uuid-1",
		identifier: "ENG-42",
		url: "https://linear.app/myorg/issue/ENG-42",
		title: "As a user, I want to log in",
		description: "Login feature\n\n### Acceptance Criteria\n\n- [ ] User can log in",
		priority: 2,
		estimate: 3,
		state: Promise.resolve({ name: "Backlog" }),
		assignee: Promise.resolve({
			email: "jane@co.com",
			displayName: "Jane",
		}),
		labels: () => Promise.resolve({ nodes: [{ name: "Feature" }] }),
		project: Promise.resolve({ name: "Q1 Release" }),
		team: Promise.resolve({ name: "Engineering", key: "ENG" }),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Integration: Export Flow", () => {
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
	// Full export: fetch and write
	// =========================================================================

	test("full export: fetch issues and write to file - file exists with correct content", async () => {
		const issue1 = createMockExportIssue();
		const issue2 = createMockExportIssue({
			id: "issue-uuid-2",
			identifier: "ENG-43",
			url: "https://linear.app/myorg/issue/ENG-43",
			title: "As a user, I want to reset my password",
			description:
				"Password reset via email.\n\n### Acceptance Criteria\n\n- [ ] User receives reset email",
			priority: 3,
			estimate: 2,
			state: Promise.resolve({ name: "Todo" }),
			assignee: Promise.resolve(null),
			labels: () => Promise.resolve({ nodes: [{ name: "Auth" }] }),
		});

		const client = createExportMockClient([issue1, issue2]);
		const outputPath = join(tmpDir, "exported-stories.md");

		const result = await exportStories(client, {
			config: defaultConfig,
			filters: { project: "Q1 Release" },
			team: "Engineering",
			outputPath,
		});

		// Verify return value
		expect(result.count).toBe(2);
		expect(result.outputPath).toBe(outputPath);

		// Verify file exists
		expect(existsSync(outputPath)).toBe(true);

		// Verify file content
		const content = readFileSync(outputPath, "utf-8");

		// Should contain frontmatter with team and project
		expect(content).toContain("---");
		expect(content).toContain('team: "Engineering"');
		expect(content).toContain('project: "Q1 Release"');

		// Should contain both story H2 headings
		expect(content).toContain("## As a user, I want to log in");
		expect(content).toContain("## As a user, I want to reset my password");

		// Should contain story body content
		expect(content).toContain("Login feature");
		expect(content).toContain("Password reset via email.");

		// Should contain acceptance criteria
		expect(content).toContain("### Acceptance Criteria");
		expect(content).toContain("- [ ] User can log in");
		expect(content).toContain("- [ ] User receives reset email");
	});

	// =========================================================================
	// Full export: correct YAML blocks
	// =========================================================================

	test("full export: correct YAML blocks - per-story YAML with linear_id and linear_url", async () => {
		const issue1 = createMockExportIssue();
		const issue2 = createMockExportIssue({
			id: "issue-uuid-2",
			identifier: "ENG-43",
			url: "https://linear.app/myorg/issue/ENG-43",
			title: "As a user, I want to sign up",
			description: "Registration flow.",
			priority: 3,
			estimate: 2,
			state: Promise.resolve({ name: "In Progress" }),
			assignee: Promise.resolve({
				email: "bob@co.com",
				displayName: "Bob",
			}),
			labels: () =>
				Promise.resolve({
					nodes: [{ name: "Feature" }, { name: "Auth" }],
				}),
		});

		const client = createExportMockClient([issue1, issue2]);
		const outputPath = join(tmpDir, "yaml-blocks.md");

		await exportStories(client, {
			config: defaultConfig,
			filters: {},
			team: "Engineering",
			outputPath,
		});

		const content = readFileSync(outputPath, "utf-8");

		// Should have YAML fenced code blocks
		const yamlBlockCount = (content.match(/```yaml/g) || []).length;
		expect(yamlBlockCount).toBe(2); // One per story

		// Issue 1 YAML fields
		expect(content).toContain("linear_id: ENG-42");
		expect(content).toContain("linear_url: https://linear.app/myorg/issue/ENG-42");

		// Issue 2 YAML fields
		expect(content).toContain("linear_id: ENG-43");
		expect(content).toContain("linear_url: https://linear.app/myorg/issue/ENG-43");

		// Priority values
		expect(content).toContain("priority: 2");
		expect(content).toContain("priority: 3");

		// Estimate values
		expect(content).toContain("estimate: 3");
		expect(content).toContain("estimate: 2");

		// Assignee values
		expect(content).toContain("assignee: jane@co.com");
		expect(content).toContain("assignee: bob@co.com");

		// Status values
		expect(content).toContain("status: Backlog");
		expect(content).toContain("status: In Progress");

		// Labels
		expect(content).toContain("labels:");
	});

	// =========================================================================
	// Full export: empty results
	// =========================================================================

	test("full export: empty results - file created but minimal content", async () => {
		const client = createExportMockClient([]);
		const outputPath = join(tmpDir, "empty-export.md");

		const result = await exportStories(client, {
			config: defaultConfig,
			filters: { project: "Nonexistent Project" },
			team: "Engineering",
			outputPath,
		});

		// Verify count is 0
		expect(result.count).toBe(0);
		expect(result.outputPath).toBe(outputPath);

		// File should still be created
		expect(existsSync(outputPath)).toBe(true);

		const content = readFileSync(outputPath, "utf-8");

		// Should not contain any story headings
		const h2Count = (content.match(/^## /gm) || []).length;
		expect(h2Count).toBe(0);

		// Should not contain YAML blocks for stories
		const yamlBlockCount = (content.match(/```yaml/g) || []).length;
		expect(yamlBlockCount).toBe(0);
	});

	// =========================================================================
	// Full export: exported file can be re-parsed (round-trip sanity check)
	// =========================================================================

	test("full export: exported markdown is valid and can be re-imported", async () => {
		const issue = createMockExportIssue();
		const client = createExportMockClient([issue]);
		const outputPath = join(tmpDir, "roundtrip.md");

		await exportStories(client, {
			config: defaultConfig,
			filters: { project: "Q1 Release" },
			team: "Engineering",
			outputPath,
		});

		// Read the exported file and verify it has the essential structure:
		// frontmatter, H2 heading, YAML block, body content
		const content = readFileSync(outputPath, "utf-8");

		// Structural checks - the file should be parseable
		expect(content).toContain("---");
		expect(content).toContain("## ");
		expect(content).toContain("```yaml");
		expect(content).toContain("linear_id:");
		expect(content).toContain("linear_url:");

		// The exported file should be importable back. We verify this by
		// using the parseMarkdownFile function directly.
		const { parseMarkdownFile } = await import("../../src/markdown/parser.ts");
		const parsed = parseMarkdownFile(content, outputPath);

		expect(parsed.stories).toHaveLength(1);
		expect(parsed.stories[0]?.title).toBe("As a user, I want to log in");
		expect(parsed.stories[0]?.linearId).toBe("ENG-42");
		expect(parsed.stories[0]?.linearUrl).toBe("https://linear.app/myorg/issue/ENG-42");
		expect(parsed.stories[0]?.priority).toBe(2);
		expect(parsed.stories[0]?.estimate).toBe(3);
		expect(parsed.frontmatter.team).toBe("Engineering");
		expect(parsed.frontmatter.project).toBe("Q1 Release");
	});
});
