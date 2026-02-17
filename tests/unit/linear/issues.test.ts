import { describe, expect, mock, test } from "bun:test";
import type { LinearClient } from "@linear/sdk";
import { LinearApiError } from "../../../src/errors.ts";
import {
	type CreateIssueInput,
	createIssue,
	fetchIssues,
	updateIssue,
} from "../../../src/linear/issues.ts";

// ---------------------------------------------------------------------------
// Reusable mock data
// ---------------------------------------------------------------------------

const TEAM_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const PROJECT_ID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
const LABEL_ID_1 = "c3d4e5f6-a7b8-9012-cdef-123456789012";
const LABEL_ID_2 = "d4e5f6a7-b8c9-0123-def0-234567890123";
const ASSIGNEE_ID = "e5f6a7b8-c9d0-1234-ef01-345678901234";
const STATE_ID = "f6a7b8c9-d0e1-2345-f012-456789012345";

function createMockIssue(overrides: Record<string, unknown> = {}) {
	return {
		id: "issue-uuid-1",
		identifier: "ENG-42",
		url: "https://linear.app/myorg/issue/ENG-42",
		title: "Test Issue",
		description: "Test description",
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

function createMockClient(overrides: Record<string, unknown> = {}) {
	const mockIssue = createMockIssue();
	return {
		createIssue: async () => ({
			success: true,
			issue: Promise.resolve(mockIssue),
		}),
		updateIssue: async () => ({
			success: true,
			issue: Promise.resolve(mockIssue),
		}),
		issues: async () => ({
			nodes: [],
			pageInfo: { hasNextPage: false, endCursor: null },
		}),
		...overrides,
	} as unknown as LinearClient;
}

// ---------------------------------------------------------------------------
// createIssue
// ---------------------------------------------------------------------------

describe("createIssue", () => {
	test("maps all UserStory fields to IssueCreateInput correctly", async () => {
		const createIssueFn = mock(async (input: Record<string, unknown>) => {
			// Verify all fields are mapped
			expect(input.title).toBe("My Story");
			expect(input.description).toBe("Story body text");
			expect(input.teamId).toBe(TEAM_ID);
			expect(input.projectId).toBe(PROJECT_ID);
			expect(input.labelIds).toEqual([LABEL_ID_1, LABEL_ID_2]);
			expect(input.assigneeId).toBe(ASSIGNEE_ID);
			expect(input.priority).toBe(2);
			expect(input.estimate).toBe(5);
			expect(input.stateId).toBe(STATE_ID);
			return {
				success: true,
				issue: Promise.resolve(createMockIssue()),
			};
		});

		const client = createMockClient({ createIssue: createIssueFn });

		const input: CreateIssueInput = {
			title: "My Story",
			description: "Story body text",
			teamId: TEAM_ID,
			projectId: PROJECT_ID,
			labelIds: [LABEL_ID_1, LABEL_ID_2],
			assigneeId: ASSIGNEE_ID,
			priority: 2,
			estimate: 5,
			stateId: STATE_ID,
		};

		await createIssue(client, input);
		expect(createIssueFn).toHaveBeenCalledTimes(1);
	});

	test("returns { id, identifier, url } on success", async () => {
		const client = createMockClient();

		const input: CreateIssueInput = {
			title: "Test Issue",
			teamId: TEAM_ID,
		};

		const result = await createIssue(client, input);
		expect(result).toEqual({
			id: "issue-uuid-1",
			identifier: "ENG-42",
			url: "https://linear.app/myorg/issue/ENG-42",
		});
	});

	test("handles optional fields gracefully (no assignee, no project, etc.)", async () => {
		const createIssueFn = mock(async (input: Record<string, unknown>) => {
			// Only required fields should be present; optional fields omitted
			expect(input.title).toBe("Minimal Story");
			expect(input.teamId).toBe(TEAM_ID);
			expect(input.projectId).toBeUndefined();
			expect(input.labelIds).toBeUndefined();
			expect(input.assigneeId).toBeUndefined();
			expect(input.priority).toBeUndefined();
			expect(input.estimate).toBeUndefined();
			expect(input.stateId).toBeUndefined();
			return {
				success: true,
				issue: Promise.resolve(createMockIssue()),
			};
		});

		const client = createMockClient({ createIssue: createIssueFn });

		const input: CreateIssueInput = {
			title: "Minimal Story",
			teamId: TEAM_ID,
		};

		const result = await createIssue(client, input);
		expect(result.id).toBe("issue-uuid-1");
		expect(createIssueFn).toHaveBeenCalledTimes(1);
	});

	test("throws LinearApiError when API call fails (success: false)", async () => {
		const client = createMockClient({
			createIssue: async () => ({
				success: false,
				issue: undefined,
			}),
		});

		const input: CreateIssueInput = {
			title: "Failing Story",
			teamId: TEAM_ID,
		};

		expect(createIssue(client, input)).rejects.toThrow(LinearApiError);
	});

	test("throws LinearApiError when API throws an error", async () => {
		const client = createMockClient({
			createIssue: async () => {
				throw new Error("Network error");
			},
		});

		const input: CreateIssueInput = {
			title: "Network Error Story",
			teamId: TEAM_ID,
		};

		expect(createIssue(client, input)).rejects.toThrow(LinearApiError);
	});
});

// ---------------------------------------------------------------------------
// updateIssue
// ---------------------------------------------------------------------------

describe("updateIssue", () => {
	test("sends changed fields to linearClient.updateIssue", async () => {
		const updateIssueFn = mock(async (issueId: string, input: Record<string, unknown>) => {
			expect(issueId).toBe("issue-uuid-1");
			expect(input.title).toBe("Updated Title");
			expect(input.priority).toBe(1);
			expect(input.description).toBe("Updated description");
			return {
				success: true,
				issue: Promise.resolve(
					createMockIssue({
						title: "Updated Title",
						identifier: "ENG-42",
					}),
				),
			};
		});

		const client = createMockClient({ updateIssue: updateIssueFn });

		await updateIssue(client, "issue-uuid-1", {
			title: "Updated Title",
			priority: 1,
			description: "Updated description",
		});

		expect(updateIssueFn).toHaveBeenCalledTimes(1);
	});

	test("returns success with identifier", async () => {
		const client = createMockClient();

		const result = await updateIssue(client, "issue-uuid-1", {
			title: "Updated Title",
		});

		expect(result).toEqual({ identifier: "ENG-42" });
	});

	test("throws LinearApiError when update fails", async () => {
		const client = createMockClient({
			updateIssue: async () => ({
				success: false,
				issue: undefined,
			}),
		});

		expect(updateIssue(client, "issue-uuid-1", { title: "Fail" })).rejects.toThrow(LinearApiError);
	});

	test("throws LinearApiError when API throws an error", async () => {
		const client = createMockClient({
			updateIssue: async () => {
				throw new Error("Network error");
			},
		});

		expect(updateIssue(client, "issue-uuid-1", { title: "Fail" })).rejects.toThrow(LinearApiError);
	});
});

// ---------------------------------------------------------------------------
// fetchIssues
// ---------------------------------------------------------------------------

describe("fetchIssues", () => {
	test("returns array of LinearIssueData objects", async () => {
		const mockIssue = createMockIssue();
		const client = createMockClient({
			issues: async () => ({
				nodes: [mockIssue],
				pageInfo: { hasNextPage: false, endCursor: null },
			}),
		});

		const results = await fetchIssues(client, {});

		expect(results).toHaveLength(1);
		expect(results[0].id).toBe("issue-uuid-1");
		expect(results[0].identifier).toBe("ENG-42");
		expect(results[0].url).toBe("https://linear.app/myorg/issue/ENG-42");
		expect(results[0].title).toBe("Test Issue");
		expect(results[0].description).toBe("Test description");
		expect(results[0].priority).toBe(2);
		expect(results[0].estimate).toBe(3);
		expect(results[0].state).toEqual({ name: "Backlog" });
		expect(results[0].assignee).toEqual({
			email: "jane@co.com",
			displayName: "Jane",
		});
		expect(results[0].labels).toEqual({ nodes: [{ name: "Feature" }] });
		expect(results[0].project).toEqual({ name: "Q1 Release" });
		expect(results[0].team).toEqual({ name: "Engineering", key: "ENG" });
	});

	test("paginates through multiple pages (cursor-based)", async () => {
		const issue1 = createMockIssue({
			id: "issue-uuid-1",
			identifier: "ENG-42",
		});
		const issue2 = createMockIssue({
			id: "issue-uuid-2",
			identifier: "ENG-43",
		});
		const issue3 = createMockIssue({
			id: "issue-uuid-3",
			identifier: "ENG-44",
		});

		let callCount = 0;
		const issuesFn = mock(async (opts: Record<string, unknown>) => {
			callCount++;
			if (callCount === 1) {
				expect(opts.after).toBeUndefined();
				return {
					nodes: [issue1, issue2],
					pageInfo: { hasNextPage: true, endCursor: "cursor-page-1" },
				};
			}
			// Second call should use the cursor from page 1
			expect(opts.after).toBe("cursor-page-1");
			return {
				nodes: [issue3],
				pageInfo: { hasNextPage: false, endCursor: null },
			};
		});

		const client = createMockClient({ issues: issuesFn });

		const results = await fetchIssues(client, {});

		expect(results).toHaveLength(3);
		expect(results[0].id).toBe("issue-uuid-1");
		expect(results[1].id).toBe("issue-uuid-2");
		expect(results[2].id).toBe("issue-uuid-3");
		expect(issuesFn).toHaveBeenCalledTimes(2);
	});

	test("returns empty array when no results", async () => {
		const client = createMockClient({
			issues: async () => ({
				nodes: [],
				pageInfo: { hasNextPage: false, endCursor: null },
			}),
		});

		const results = await fetchIssues(client, {});

		expect(results).toEqual([]);
	});

	test("resolves async fields (state, assignee, labels, project, team)", async () => {
		const mockIssue = createMockIssue({
			state: Promise.resolve({ name: "In Progress" }),
			assignee: Promise.resolve({
				email: "bob@co.com",
				displayName: "Bob",
			}),
			labels: () => Promise.resolve({ nodes: [{ name: "Bug" }, { name: "Urgent" }] }),
			project: Promise.resolve({ name: "Hotfix" }),
			team: Promise.resolve({ name: "Platform", key: "PLT" }),
		});

		const client = createMockClient({
			issues: async () => ({
				nodes: [mockIssue],
				pageInfo: { hasNextPage: false, endCursor: null },
			}),
		});

		const results = await fetchIssues(client, {});

		expect(results[0].state).toEqual({ name: "In Progress" });
		expect(results[0].assignee).toEqual({
			email: "bob@co.com",
			displayName: "Bob",
		});
		expect(results[0].labels).toEqual({
			nodes: [{ name: "Bug" }, { name: "Urgent" }],
		});
		expect(results[0].project).toEqual({ name: "Hotfix" });
		expect(results[0].team).toEqual({ name: "Platform", key: "PLT" });
	});

	test("handles issues with undefined optional async fields", async () => {
		const mockIssue = createMockIssue({
			description: undefined,
			estimate: undefined,
			state: Promise.resolve(undefined),
			assignee: Promise.resolve(undefined),
			project: Promise.resolve(undefined),
		});

		const client = createMockClient({
			issues: async () => ({
				nodes: [mockIssue],
				pageInfo: { hasNextPage: false, endCursor: null },
			}),
		});

		const results = await fetchIssues(client, {});

		expect(results[0].description).toBeUndefined();
		expect(results[0].estimate).toBeUndefined();
		expect(results[0].state).toBeUndefined();
		expect(results[0].assignee).toBeUndefined();
		expect(results[0].project).toBeUndefined();
	});

	test("passes filter to client.issues", async () => {
		const issuesFn = mock(async (opts: Record<string, unknown>) => {
			expect(opts.filter).toEqual({
				project: { id: { eq: PROJECT_ID } },
			});
			return {
				nodes: [],
				pageInfo: { hasNextPage: false, endCursor: null },
			};
		});

		const client = createMockClient({ issues: issuesFn });

		await fetchIssues(client, { project: { id: { eq: PROJECT_ID } } });

		expect(issuesFn).toHaveBeenCalledTimes(1);
	});
});
