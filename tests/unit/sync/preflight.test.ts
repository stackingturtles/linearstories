import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LinearClient } from "@linear/sdk";
import { importStories } from "../../../src/sync/importer.ts";
import type { ResolvedConfig } from "../../../src/types.ts";

const TEAM_ID = "team-engineering";
const PROJECT_ID = "project-release";
const config: ResolvedConfig = {
	apiKey: "test-key",
	defaultTeam: "Engineering",
	defaultProject: "Release",
	defaultLabels: [],
};

interface TestLabel {
	id: string;
	name: string;
	teamId?: string;
	parentId?: string;
}

interface ClientState {
	labels?: TestLabel[];
	teamExists?: boolean;
	projectExists?: boolean;
	assigneeExists?: boolean;
	stateExists?: boolean;
	createLabelError?: Error;
}

function createClient(state: ClientState = {}) {
	const labels = state.labels ?? [];
	const events: string[] = [];
	let issueNumber = 0;
	const issueLabels = mock(async (variables: unknown) => {
		const input = variables as { filter: { name: { eqIgnoreCase: string } } };
		const requested = input.filter.name.eqIgnoreCase;
		return {
			nodes: labels.filter((label) => label.name.toLowerCase() === requested.toLowerCase()),
		};
	});
	const createIssueLabel = mock(async (input: { name: string; teamId: string }) => {
		events.push(`label:${input.name}`);
		if (state.createLabelError) throw state.createLabelError;
		const label = { id: `created-${input.name}`, name: input.name, teamId: input.teamId };
		labels.push(label);
		return { success: true, issueLabelId: label.id };
	});
	const createIssue = mock(async (input: Record<string, unknown>) => {
		issueNumber++;
		events.push(`issue:${String(input.title)}`);
		const identifier = `ENG-${issueNumber}`;
		return {
			success: true,
			issue: Promise.resolve({
				id: `issue-${issueNumber}`,
				identifier,
				url: `https://linear.app/acme/issue/${identifier}`,
			}),
		};
	});
	const updateIssue = mock(async () => ({
		success: true,
		issue: Promise.resolve({ id: "issue-existing", identifier: "ENG-42" }),
	}));

	const client = {
		teams: async () => ({ nodes: state.teamExists === false ? [] : [{ id: TEAM_ID }] }),
		projects: async () => ({
			nodes: state.projectExists === false ? [] : [{ id: PROJECT_ID }],
		}),
		issueLabels,
		issueLabel: async (id: string) => ({ id, name: "Environment" }),
		createIssueLabel,
		users: async () => ({
			nodes: state.assigneeExists === false ? [] : [{ id: "user-jane" }],
		}),
		workflowStates: async () => ({
			nodes: state.stateExists === false ? [] : [{ id: "state-backlog" }],
		}),
		createIssue,
		updateIssue,
		issues: async () => ({ nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }),
	} as unknown as LinearClient;

	return { client, labels, events, issueLabels, createIssueLabel, createIssue, updateIssue };
}

function story(title: string, labels: string[], extraMetadata = ""): string {
	return `## ${title}

\`\`\`yaml
labels: [${labels.join(", ")}]
${extraMetadata}\`\`\`

Description.

### Acceptance Criteria

- [ ] The behavior is verifiable
`;
}

const hierarchy = `## Account access

\`\`\`yaml
labels: [Epic, Auth]
\`\`\`

Secure account access.

### Why is this needed?

Users need secure access to protected features.

## Login

\`\`\`yaml
epic: Account access
labels: [Auth, Feature]
\`\`\`

Allow a user to log in.

### Acceptance Criteria

- [ ] Valid credentials create a session
`;

let tempDir: string;

function writeStories(content: string): string {
	const path = join(tempDir, "stories.md");
	writeFileSync(path, content);
	return path;
}

describe("import remote preflight", () => {
	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "linearstories-preflight-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("fails all issue mutations when an ordinary label is missing and checks it once", async () => {
		const file = writeStories(
			`${story("First story", ["Feature"])}\n${story("Second story", ["Missing"])}\n${story("Third story", ["Missing"])}`,
		);
		const context = createClient({
			labels: [{ id: "feature", name: "Feature", teamId: TEAM_ID }],
		});

		const summary = await importStories(context.client, {
			files: [file],
			config,
			noWriteBack: true,
		});

		expect(summary.failed).toBe(2);
		expect(summary.skipped).toBe(1);
		expect(summary.preflight?.labels).toContainEqual(
			expect.objectContaining({ name: "Missing", status: "missing" }),
		);
		expect(context.issueLabels).toHaveBeenCalledTimes(2);
		expect(context.createIssue).not.toHaveBeenCalled();
		expect(context.createIssueLabel).not.toHaveBeenCalled();
	});

	test("remote preflight is read-only even when labels are missing", async () => {
		const file = writeStories(story("Story", ["Missing"]));
		const context = createClient();

		const summary = await importStories(context.client, {
			files: [file],
			config,
			preflight: true,
		});

		expect(summary.preflight?.passed).toBe(false);
		expect(context.createIssueLabel).not.toHaveBeenCalled();
		expect(context.createIssue).not.toHaveBeenCalled();
	});

	test("successful remote preflight performs no label or issue mutations", async () => {
		const file = writeStories(story("Story", ["Feature"]));
		const context = createClient({
			labels: [{ id: "feature", name: "Feature", teamId: TEAM_ID }],
		});

		const summary = await importStories(context.client, {
			files: [file],
			config,
			preflight: true,
		});

		expect(summary.preflight?.passed).toBe(true);
		expect(summary.skipped).toBe(1);
		expect(context.createIssueLabel).not.toHaveBeenCalled();
		expect(context.createIssue).not.toHaveBeenCalled();
	});

	test("provisions missing Epic and ordinary labels before creating the hierarchy", async () => {
		const file = writeStories(hierarchy);
		const context = createClient({
			labels: [
				{ id: "auth-workspace", name: "Auth", teamId: undefined },
				{ id: "lower-epic-other-team", name: "epic", teamId: "other-team" },
			],
		});

		const summary = await importStories(context.client, {
			files: [file],
			config,
			createMissingLabels: true,
			noWriteBack: true,
		});

		expect(summary.created).toBe(2);
		expect(summary.preflight?.labels).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "Epic", status: "created" }),
				expect.objectContaining({ name: "Feature", status: "created" }),
				expect.objectContaining({ name: "Auth", status: "existing", scope: "workspace" }),
			]),
		);
		expect(context.events.slice(0, 2).every((event) => event.startsWith("label:"))).toBe(true);
		expect(context.events[2]).toBe("issue:Account access");
		expect(context.events[3]).toBe("issue:Login");
		expect(context.createIssue.mock.calls[1]?.[0]).toMatchObject({ parentId: "ENG-1" });
	});

	test("label creation is idempotent across reruns", async () => {
		const file = writeStories(story("Story", ["Feature"]));
		const context = createClient();

		await importStories(context.client, {
			files: [file],
			config,
			createMissingLabels: true,
			noWriteBack: true,
		});
		await importStories(context.client, {
			files: [file],
			config,
			createMissingLabels: true,
			noWriteBack: true,
		});

		expect(context.createIssueLabel).toHaveBeenCalledTimes(1);
		expect(context.labels.filter((label) => label.name === "Feature")).toHaveLength(1);
	});

	test("a label creation permission failure prevents every issue mutation", async () => {
		const file = writeStories(`${story("First", ["Feature"])}\n${story("Second", ["Feature"])}`);
		const context = createClient({ createLabelError: new Error("Forbidden") });

		const summary = await importStories(context.client, {
			files: [file],
			config,
			createMissingLabels: true,
			noWriteBack: true,
		});

		expect(summary.preflight?.passed).toBe(false);
		expect(summary.preflight?.errors.join(" ")).toContain("Forbidden");
		expect(context.createIssue).not.toHaveBeenCalled();
	});

	test("a missing team is reported once and prevents all later API work", async () => {
		const file = writeStories(`${story("First", ["Feature"])}\n${story("Second", ["Feature"])}`);
		const context = createClient({ teamExists: false });

		const summary = await importStories(context.client, {
			files: [file],
			config,
			noWriteBack: true,
		});

		expect(summary.preflight?.errors).toHaveLength(1);
		expect(summary.preflight?.errors[0]).toContain('Team "Engineering"');
		expect(context.issueLabels).not.toHaveBeenCalled();
		expect(context.createIssue).not.toHaveBeenCalled();
	});

	test("a label lookup permission failure is consolidated before mutation", async () => {
		const file = writeStories(`${story("First", ["Feature"])}\n${story("Second", ["Feature"])}`);
		const context = createClient();
		const lookup = mock(async () => {
			throw new Error("Forbidden");
		});
		(context.client as unknown as { issueLabels: typeof lookup }).issueLabels = lookup;

		const summary = await importStories(context.client, {
			files: [file],
			config,
			noWriteBack: true,
		});

		expect(summary.preflight?.errors).toHaveLength(1);
		expect(summary.preflight?.errors[0]).toContain("Forbidden");
		expect(lookup).toHaveBeenCalledTimes(1);
		expect(context.createIssue).not.toHaveBeenCalled();
	});

	test("does not provision labels when another remote prerequisite fails", async () => {
		const file = writeStories(story("Story", ["Feature"]));
		const context = createClient({ projectExists: false });

		await importStories(context.client, {
			files: [file],
			config,
			createMissingLabels: true,
			noWriteBack: true,
		});

		expect(context.createIssueLabel).not.toHaveBeenCalled();
		expect(context.createIssue).not.toHaveBeenCalled();
	});

	test("reports case-only collisions on the target team and does not create a duplicate", async () => {
		const file = writeStories(hierarchy);
		const context = createClient({
			labels: [
				{ id: "lower-epic", name: "epic", teamId: TEAM_ID },
				{ id: "auth", name: "Auth", teamId: TEAM_ID },
				{ id: "feature", name: "Feature", teamId: TEAM_ID },
			],
		});

		const summary = await importStories(context.client, {
			files: [file],
			config,
			createMissingLabels: true,
			noWriteBack: true,
		});

		expect(summary.preflight?.passed).toBe(false);
		expect(summary.preflight?.labels).toContainEqual(
			expect.objectContaining({
				name: "Epic",
				status: "conflicting",
				detail: expect.stringContaining("epic"),
			}),
		);
		expect(context.createIssueLabel).not.toHaveBeenCalled();
		expect(context.createIssue).not.toHaveBeenCalled();
	});

	test("provisions a target-team label instead of selecting another team's label", async () => {
		const file = writeStories(story("Story", ["Security"]));
		const context = createClient({
			labels: [{ id: "other-security", name: "Security", teamId: "other-team" }],
		});

		const summary = await importStories(context.client, {
			files: [file],
			config,
			createMissingLabels: true,
			noWriteBack: true,
		});

		expect(summary.created).toBe(1);
		expect(context.createIssueLabel).toHaveBeenCalledWith({
			name: "Security",
			teamId: TEAM_ID,
		});
		const input = context.createIssue.mock.calls[0]?.[0] as { labelIds: string[] };
		expect(input.labelIds).toEqual(["created-Security"]);
		expect(input.labelIds).not.toContain("other-security");
	});

	test("allow-missing imports new issues but reports skipped labels", async () => {
		const file = writeStories(story("Story", ["Missing"]));
		const context = createClient();

		const summary = await importStories(context.client, {
			files: [file],
			config,
			allowMissingLabels: true,
			noWriteBack: true,
		});

		expect(summary.created).toBe(1);
		expect(summary.preflight?.labels).toContainEqual(
			expect.objectContaining({ name: "Missing", status: "skipped" }),
		);
		expect(context.createIssue.mock.calls[0]?.[0]).not.toHaveProperty("labelIds");
	});

	test("allow-missing cannot skip the reserved Epic label", async () => {
		const file = writeStories(hierarchy);
		const context = createClient({
			labels: [
				{ id: "auth", name: "Auth", teamId: TEAM_ID },
				{ id: "feature", name: "Feature", teamId: TEAM_ID },
			],
		});

		const summary = await importStories(context.client, {
			files: [file],
			config,
			allowMissingLabels: true,
			noWriteBack: true,
		});

		expect(summary.preflight?.passed).toBe(false);
		expect(summary.preflight?.labels).toContainEqual(
			expect.objectContaining({ name: "Epic", status: "missing" }),
		);
		expect(context.createIssue).not.toHaveBeenCalled();
	});

	test("allow-missing never clears labels on an existing issue", async () => {
		const file = writeStories(story("Existing", ["Missing"], "linear_id: ENG-42\n"));
		const context = createClient();

		const summary = await importStories(context.client, {
			files: [file],
			config,
			allowMissingLabels: true,
			noWriteBack: true,
		});

		expect(summary.updated).toBe(1);
		expect(context.updateIssue.mock.calls[0]?.[1]).not.toHaveProperty("labelIds");
	});

	test("consolidates project, label, assignee, and state failures before mutation", async () => {
		const file = writeStories(
			story("Story", ["Missing"], "assignee: ghost@example.com\nstatus: Unknown\n"),
		);
		const context = createClient({
			projectExists: false,
			assigneeExists: false,
			stateExists: false,
		});

		const summary = await importStories(context.client, {
			files: [file],
			config,
			noWriteBack: true,
		});
		const errors = summary.preflight?.errors.join("\n") ?? "";

		expect(errors).toContain("Project");
		expect(errors).toContain('label "Missing"');
		expect(errors).toContain("Assignee not found");
		expect(errors).toContain("Workflow state");
		expect(context.createIssue).not.toHaveBeenCalled();
	});

	test("fails grouped label conflicts instead of silently skipping one", async () => {
		const file = writeStories(story("Story", ["Dev", "Prod"]));
		const context = createClient({
			labels: [
				{ id: "dev", name: "Dev", teamId: TEAM_ID, parentId: "environment" },
				{ id: "prod", name: "Prod", teamId: TEAM_ID, parentId: "environment" },
			],
		});

		const summary = await importStories(context.client, {
			files: [file],
			config,
			noWriteBack: true,
		});

		expect(summary.preflight?.errors.join(" ")).toContain(
			'Labels "Dev" and "Prod" are both in group "Environment"',
		);
		expect(context.createIssue).not.toHaveBeenCalled();
	});
});
