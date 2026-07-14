import { describe, expect, mock, test } from "bun:test";
import type { LinearClient } from "@linear/sdk";
import { ResolverError } from "../../../src/errors.ts";
import { Resolver } from "../../../src/linear/resolvers.ts";

function createMockClient(overrides: Record<string, unknown> = {}): LinearClient {
	return {
		teams: async () => ({ nodes: [] }),
		projects: async () => ({ nodes: [] }),
		issueLabels: async () => ({ nodes: [] }),
		issueLabel: async () => ({ id: "parent-id", name: "Unknown" }),
		createIssueLabel: async () => ({ success: false, issueLabelId: undefined }),
		users: async () => ({ nodes: [] }),
		workflowStates: async () => ({ nodes: [] }),
		...overrides,
	} as unknown as LinearClient;
}

const TEAM_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const PROJECT_UUID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
const LABEL_UUID_1 = "c3d4e5f6-a7b8-9012-cdef-123456789012";
const LABEL_UUID_2 = "d4e5f6a7-b8c9-0123-def0-234567890123";
const LABEL_UUID_3 = "e5f6a7b8-c9d0-1234-ef01-345678901234";
const USER_UUID = "f6a7b8c9-d0e1-2345-f012-456789012345";
const STATE_UUID = "a7b8c9d0-e1f2-3456-0123-567890123456";
const GROUP_UUID = "b8c9d0e1-f2a3-4567-1234-678901234567";

describe("Resolver", () => {
	describe("resolveTeamId", () => {
		test("resolves and caches a team name", async () => {
			const teamsFn = mock(async () => ({ nodes: [{ id: TEAM_UUID }] }));
			const resolver = new Resolver(createMockClient({ teams: teamsFn }));

			expect(await resolver.resolveTeamId("Engineering")).toBe(TEAM_UUID);
			expect(await resolver.resolveTeamId("Engineering")).toBe(TEAM_UUID);
			expect(teamsFn).toHaveBeenCalledTimes(1);
		});

		test("passes UUIDs through without an API call", async () => {
			const teamsFn = mock(async () => ({ nodes: [] }));
			const resolver = new Resolver(createMockClient({ teams: teamsFn }));

			expect(await resolver.resolveTeamId(TEAM_UUID)).toBe(TEAM_UUID);
			expect(teamsFn).not.toHaveBeenCalled();
		});

		test("throws when the team is missing", async () => {
			const resolver = new Resolver(createMockClient());
			expect(resolver.resolveTeamId("Missing")).rejects.toThrow(ResolverError);
		});
	});

	describe("resolveProjectId", () => {
		test("resolves and caches a project within its team", async () => {
			const projectsFn = mock(async () => ({ nodes: [{ id: PROJECT_UUID }] }));
			const resolver = new Resolver(createMockClient({ projects: projectsFn }));

			expect(await resolver.resolveProjectId("Q1 Release", TEAM_UUID)).toBe(PROJECT_UUID);
			expect(await resolver.resolveProjectId("Q1 Release", TEAM_UUID)).toBe(PROJECT_UUID);
			expect(projectsFn).toHaveBeenCalledTimes(1);
		});

		test("passes UUIDs through without an API call", async () => {
			const projectsFn = mock(async () => ({ nodes: [] }));
			const resolver = new Resolver(createMockClient({ projects: projectsFn }));

			expect(await resolver.resolveProjectId(PROJECT_UUID, TEAM_UUID)).toBe(PROJECT_UUID);
			expect(projectsFn).not.toHaveBeenCalled();
		});

		test("throws when the project is missing", async () => {
			const resolver = new Resolver(createMockClient());
			expect(resolver.resolveProjectId("Missing", TEAM_UUID)).rejects.toThrow(ResolverError);
		});
	});

	describe("resolveLabel", () => {
		test("prefers an exact team label over workspace and other-team labels", async () => {
			const resolver = new Resolver(
				createMockClient({
					issueLabels: async () => ({
						nodes: [
							{ id: LABEL_UUID_1, name: "Feature", teamId: "other-team" },
							{ id: LABEL_UUID_2, name: "Feature", teamId: undefined },
							{ id: LABEL_UUID_3, name: "Feature", teamId: TEAM_UUID },
						],
					}),
				}),
			);

			expect(await resolver.resolveLabel("Feature", TEAM_UUID)).toEqual({
				status: "existing",
				label: {
					id: LABEL_UUID_3,
					name: "Feature",
					parentId: undefined,
					scope: "team",
				},
			});
		});

		test("reuses an exact workspace label", async () => {
			const resolver = new Resolver(
				createMockClient({
					issueLabels: async () => ({
						nodes: [{ id: LABEL_UUID_1, name: "Feature", teamId: undefined }],
					}),
				}),
			);

			const result = await resolver.resolveLabel("Feature", TEAM_UUID);
			expect(result.status).toBe("existing");
			if (result.status === "existing") expect(result.label.scope).toBe("workspace");
		});

		test("never selects an exact label owned by another team", async () => {
			const resolver = new Resolver(
				createMockClient({
					issueLabels: async () => ({
						nodes: [{ id: LABEL_UUID_1, name: "Feature", teamId: "other-team" }],
					}),
				}),
			);

			expect(await resolver.resolveLabel("Feature", TEAM_UUID)).toMatchObject({
				status: "cross-team",
				provisionable: true,
			});
		});

		test("reports an applicable case-only collision as non-provisionable", async () => {
			const resolver = new Resolver(
				createMockClient({
					issueLabels: async () => ({
						nodes: [{ id: LABEL_UUID_1, name: "epic", teamId: TEAM_UUID }],
					}),
				}),
			);

			expect(await resolver.resolveLabel("Epic", TEAM_UUID)).toMatchObject({
				status: "case-conflict",
				provisionable: false,
			});
		});

		test("permits provisioning when case-only matches belong to another team", async () => {
			const resolver = new Resolver(
				createMockClient({
					issueLabels: async () => ({
						nodes: [{ id: LABEL_UUID_1, name: "epic", teamId: "other-team" }],
					}),
				}),
			);

			expect(await resolver.resolveLabel("Epic", TEAM_UUID)).toMatchObject({
				status: "case-conflict",
				provisionable: true,
			});
		});

		test("caches missing results once per target team", async () => {
			const labelsFn = mock(async () => ({ nodes: [] }));
			const resolver = new Resolver(createMockClient({ issueLabels: labelsFn }));

			await resolver.resolveLabel("Feature", TEAM_UUID);
			await resolver.resolveLabel("Feature", TEAM_UUID);
			expect(labelsFn).toHaveBeenCalledTimes(1);

			await resolver.resolveLabel("Feature", "other-team");
			expect(labelsFn).toHaveBeenCalledTimes(2);
		});

		test("creates a team-scoped label and updates the cache", async () => {
			const createFn = mock(async () => ({ success: true, issueLabelId: LABEL_UUID_1 }));
			const labelsFn = mock(async () => ({ nodes: [] }));
			const resolver = new Resolver(
				createMockClient({ createIssueLabel: createFn, issueLabels: labelsFn }),
			);

			await resolver.resolveLabel("Feature", TEAM_UUID);
			const created = await resolver.createTeamLabel("Feature", TEAM_UUID);
			const cached = await resolver.resolveLabel("Feature", TEAM_UUID);

			expect(createFn).toHaveBeenCalledWith({ name: "Feature", teamId: TEAM_UUID });
			expect(created.id).toBe(LABEL_UUID_1);
			expect(cached).toMatchObject({ status: "existing", label: { id: LABEL_UUID_1 } });
			expect(labelsFn).toHaveBeenCalledTimes(1);
		});

		test("surfaces label creation permission failures", async () => {
			const resolver = new Resolver(
				createMockClient({
					createIssueLabel: async () => {
						throw new Error("Forbidden");
					},
				}),
			);

			expect(resolver.createTeamLabel("Feature", TEAM_UUID)).rejects.toThrow("Forbidden");
		});
	});

	describe("resolveAssigneeId", () => {
		test("resolves email and display name filters", async () => {
			const usersFn = mock(async () => ({ nodes: [{ id: USER_UUID }] }));
			const resolver = new Resolver(createMockClient({ users: usersFn }));

			expect(await resolver.resolveAssigneeId("jane@example.com")).toBe(USER_UUID);
			expect(usersFn.mock.calls[0]?.[0]).toEqual({ filter: { email: { eq: "jane@example.com" } } });

			expect(await resolver.resolveAssigneeId("Jane Doe")).toBe(USER_UUID);
			expect(usersFn.mock.calls[1]?.[0]).toEqual({ filter: { displayName: { eq: "Jane Doe" } } });
		});

		test("returns and caches undefined when a user is missing", async () => {
			const usersFn = mock(async () => ({ nodes: [] }));
			const resolver = new Resolver(createMockClient({ users: usersFn }));

			expect(await resolver.resolveAssigneeId("ghost@example.com")).toBeUndefined();
			expect(await resolver.resolveAssigneeId("ghost@example.com")).toBeUndefined();
			expect(usersFn).toHaveBeenCalledTimes(1);
		});
	});

	describe("resolveWorkflowStateId", () => {
		test("resolves case-insensitively and caches per team", async () => {
			const statesFn = mock(async () => ({ nodes: [{ id: STATE_UUID }] }));
			const resolver = new Resolver(createMockClient({ workflowStates: statesFn }));

			expect(await resolver.resolveWorkflowStateId("In Progress", TEAM_UUID)).toBe(STATE_UUID);
			expect(await resolver.resolveWorkflowStateId("in progress", TEAM_UUID)).toBe(STATE_UUID);
			expect(statesFn).toHaveBeenCalledTimes(1);
		});

		test("returns undefined when a state is missing", async () => {
			const resolver = new Resolver(createMockClient());
			expect(await resolver.resolveWorkflowStateId("Missing", TEAM_UUID)).toBeUndefined();
		});
	});

	describe("resolveEpicIssue", () => {
		test("verifies and caches an Epic-labelled top-level issue", async () => {
			const issueFn = mock(async () => ({
				id: "epic-id",
				identifier: "ENG-42",
				parentId: undefined,
				labels: async () => ({ nodes: [{ name: "Epic" }] }),
			}));
			const resolver = new Resolver(createMockClient({ issue: issueFn }));

			expect(await resolver.resolveEpicIssue("ENG-42")).toEqual({
				id: "epic-id",
				identifier: "ENG-42",
			});
			expect(await resolver.resolveEpicIssue("ENG-42")).toEqual({
				id: "epic-id",
				identifier: "ENG-42",
			});
			expect(issueFn).toHaveBeenCalledTimes(1);
		});

		test("rejects issues without the exact Epic label", async () => {
			const resolver = new Resolver(
				createMockClient({
					issue: async () => ({
						id: "story-id",
						identifier: "ENG-42",
						parentId: undefined,
						labels: async () => ({ nodes: [{ name: "epic" }] }),
					}),
				}),
			);

			expect(resolver.resolveEpicIssue("ENG-42")).rejects.toThrow("does not have the Epic label");
		});

		test("rejects nested epic parents", async () => {
			const resolver = new Resolver(
				createMockClient({
					issue: async () => ({
						id: "epic-id",
						identifier: "ENG-42",
						parentId: "parent-id",
						labels: async () => ({ nodes: [{ name: "Epic" }] }),
					}),
				}),
			);

			expect(resolver.resolveEpicIssue("ENG-42")).rejects.toThrow("already has a parent");
		});
	});

	test("resolveGroupName caches successful lookups", async () => {
		const issueLabelFn = mock(async () => ({ id: GROUP_UUID, name: "Domain" }));
		const resolver = new Resolver(createMockClient({ issueLabel: issueLabelFn }));

		expect(await resolver.resolveGroupName(GROUP_UUID)).toBe("Domain");
		expect(await resolver.resolveGroupName(GROUP_UUID)).toBe("Domain");
		expect(issueLabelFn).toHaveBeenCalledTimes(1);
	});
});
