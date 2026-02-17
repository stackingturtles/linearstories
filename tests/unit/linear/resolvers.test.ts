import { describe, expect, mock, test } from "bun:test";
import type { LinearClient } from "@linear/sdk";
import { ResolverError } from "../../../src/errors.ts";
import { Resolver } from "../../../src/linear/resolvers.ts";

// ---------------------------------------------------------------------------
// Helper: create a mock LinearClient with sensible defaults
// ---------------------------------------------------------------------------

function createMockClient(overrides: Record<string, unknown> = {}): LinearClient {
	return {
		teams: async () => ({ nodes: [] }),
		projects: async () => ({ nodes: [] }),
		issueLabels: async () => ({ nodes: [] }),
		users: async () => ({ nodes: [] }),
		workflowStates: async () => ({ nodes: [] }),
		...overrides,
	} as unknown as LinearClient;
}

// Some reusable UUIDs
const TEAM_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const PROJECT_UUID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
const LABEL_UUID_1 = "c3d4e5f6-a7b8-9012-cdef-123456789012";
const LABEL_UUID_2 = "d4e5f6a7-b8c9-0123-def0-234567890123";
const USER_UUID = "e5f6a7b8-c9d0-1234-ef01-345678901234";
const STATE_UUID = "f6a7b8c9-d0e1-2345-f012-456789012345";

// ---------------------------------------------------------------------------
// resolveTeamId
// ---------------------------------------------------------------------------

describe("Resolver", () => {
	describe("resolveTeamId", () => {
		test("resolves team name to UUID", async () => {
			const client = createMockClient({
				teams: async () => ({ nodes: [{ id: TEAM_UUID }] }),
			});
			const resolver = new Resolver(client);

			const result = await resolver.resolveTeamId("Engineering");
			expect(result).toBe(TEAM_UUID);
		});

		test("passes through existing UUID (detects UUID format)", async () => {
			const teamsFn = mock(async () => ({ nodes: [] }));
			const client = createMockClient({ teams: teamsFn });
			const resolver = new Resolver(client);

			const result = await resolver.resolveTeamId(TEAM_UUID);
			expect(result).toBe(TEAM_UUID);
			// Should NOT have called the API
			expect(teamsFn).not.toHaveBeenCalled();
		});

		test("throws ResolverError when team not found", async () => {
			const client = createMockClient({
				teams: async () => ({ nodes: [] }),
			});
			const resolver = new Resolver(client);

			expect(resolver.resolveTeamId("Nonexistent")).rejects.toThrow(ResolverError);
		});
	});

	// -------------------------------------------------------------------------
	// resolveProjectId
	// -------------------------------------------------------------------------

	describe("resolveProjectId", () => {
		test("resolves project name to UUID within a team", async () => {
			const client = createMockClient({
				projects: async () => ({ nodes: [{ id: PROJECT_UUID }] }),
			});
			const resolver = new Resolver(client);

			const result = await resolver.resolveProjectId("Q1 Release", TEAM_UUID);
			expect(result).toBe(PROJECT_UUID);
		});

		test("passes through existing UUID", async () => {
			const projectsFn = mock(async () => ({ nodes: [] }));
			const client = createMockClient({ projects: projectsFn });
			const resolver = new Resolver(client);

			const result = await resolver.resolveProjectId(PROJECT_UUID, TEAM_UUID);
			expect(result).toBe(PROJECT_UUID);
			expect(projectsFn).not.toHaveBeenCalled();
		});

		test("throws ResolverError when project not found", async () => {
			const client = createMockClient({
				projects: async () => ({ nodes: [] }),
			});
			const resolver = new Resolver(client);

			expect(resolver.resolveProjectId("Nonexistent", TEAM_UUID)).rejects.toThrow(ResolverError);
		});
	});

	// -------------------------------------------------------------------------
	// resolveLabelIds
	// -------------------------------------------------------------------------

	describe("resolveLabelIds", () => {
		test("resolves array of label names to UUIDs", async () => {
			const client = createMockClient({
				issueLabels: async (filter: unknown) => {
					const f = filter as {
						filter: { name: { eq: string } };
					};
					const name = f.filter.name.eq;
					if (name === "Feature") return { nodes: [{ id: LABEL_UUID_1 }] };
					if (name === "Bug") return { nodes: [{ id: LABEL_UUID_2 }] };
					return { nodes: [] };
				},
			});
			const resolver = new Resolver(client);

			const result = await resolver.resolveLabelIds(["Feature", "Bug"]);
			expect(result).toEqual([LABEL_UUID_1, LABEL_UUID_2]);
		});

		test("warns on missing labels (returns found ones, skips missing)", async () => {
			const warnMessages: string[] = [];
			const originalWarn = console.warn;
			console.warn = (...args: unknown[]) => {
				warnMessages.push(String(args[0]));
			};

			try {
				const client = createMockClient({
					issueLabels: async (filter: unknown) => {
						const f = filter as {
							filter: { name: { eq: string } };
						};
						const name = f.filter.name.eq;
						if (name === "Feature") return { nodes: [{ id: LABEL_UUID_1 }] };
						return { nodes: [] };
					},
				});
				const resolver = new Resolver(client);

				const result = await resolver.resolveLabelIds(["Feature", "Nonexistent"]);
				expect(result).toEqual([LABEL_UUID_1]);
				expect(warnMessages.some((m) => m.includes("Nonexistent"))).toBe(true);
			} finally {
				console.warn = originalWarn;
			}
		});

		test("returns empty array for empty input", async () => {
			const client = createMockClient();
			const resolver = new Resolver(client);

			const result = await resolver.resolveLabelIds([]);
			expect(result).toEqual([]);
		});
	});

	// -------------------------------------------------------------------------
	// resolveAssigneeId
	// -------------------------------------------------------------------------

	describe("resolveAssigneeId", () => {
		test("resolves email to user UUID", async () => {
			const client = createMockClient({
				users: async (filter: unknown) => {
					const f = filter as {
						filter: { email?: { eq: string }; displayName?: { eq: string } };
					};
					if (f.filter.email?.eq === "jane@example.com") {
						return { nodes: [{ id: USER_UUID }] };
					}
					return { nodes: [] };
				},
			});
			const resolver = new Resolver(client);

			const result = await resolver.resolveAssigneeId("jane@example.com");
			expect(result).toBe(USER_UUID);
		});

		test("resolves display name to user UUID", async () => {
			const client = createMockClient({
				users: async (filter: unknown) => {
					const f = filter as {
						filter: { email?: { eq: string }; displayName?: { eq: string } };
					};
					if (f.filter.displayName?.eq === "Jane Doe") {
						return { nodes: [{ id: USER_UUID }] };
					}
					return { nodes: [] };
				},
			});
			const resolver = new Resolver(client);

			// "Jane Doe" doesn't contain @, so it should try displayName
			const result = await resolver.resolveAssigneeId("Jane Doe");
			expect(result).toBe(USER_UUID);
		});

		test("returns undefined when user not found", async () => {
			const client = createMockClient({
				users: async () => ({ nodes: [] }),
			});
			const resolver = new Resolver(client);

			const result = await resolver.resolveAssigneeId("ghost@example.com");
			expect(result).toBeUndefined();
		});
	});

	// -------------------------------------------------------------------------
	// resolveWorkflowStateId
	// -------------------------------------------------------------------------

	describe("resolveWorkflowStateId", () => {
		test("resolves state name (case-insensitive) to UUID", async () => {
			const client = createMockClient({
				workflowStates: async () => ({
					nodes: [{ id: STATE_UUID }],
				}),
			});
			const resolver = new Resolver(client);

			const result = await resolver.resolveWorkflowStateId("backlog", TEAM_UUID);
			expect(result).toBe(STATE_UUID);
		});

		test("returns undefined when state not found", async () => {
			const client = createMockClient({
				workflowStates: async () => ({ nodes: [] }),
			});
			const resolver = new Resolver(client);

			const result = await resolver.resolveWorkflowStateId("Nonexistent", TEAM_UUID);
			expect(result).toBeUndefined();
		});
	});

	// -------------------------------------------------------------------------
	// Caching
	// -------------------------------------------------------------------------

	describe("caching", () => {
		test("second call with same team name does not make additional API call", async () => {
			const teamsFn = mock(async () => ({
				nodes: [{ id: TEAM_UUID }],
			}));
			const client = createMockClient({ teams: teamsFn });
			const resolver = new Resolver(client);

			const first = await resolver.resolveTeamId("Engineering");
			const second = await resolver.resolveTeamId("Engineering");

			expect(first).toBe(TEAM_UUID);
			expect(second).toBe(TEAM_UUID);
			expect(teamsFn).toHaveBeenCalledTimes(1);
		});

		test("second call with same project name does not make additional API call", async () => {
			const projectsFn = mock(async () => ({
				nodes: [{ id: PROJECT_UUID }],
			}));
			const client = createMockClient({ projects: projectsFn });
			const resolver = new Resolver(client);

			await resolver.resolveProjectId("Q1 Release", TEAM_UUID);
			await resolver.resolveProjectId("Q1 Release", TEAM_UUID);

			expect(projectsFn).toHaveBeenCalledTimes(1);
		});

		test("second call with same label name does not make additional API call", async () => {
			const labelsFn = mock(async () => ({
				nodes: [{ id: LABEL_UUID_1 }],
			}));
			const client = createMockClient({ issueLabels: labelsFn });
			const resolver = new Resolver(client);

			await resolver.resolveLabelIds(["Feature"]);
			await resolver.resolveLabelIds(["Feature"]);

			expect(labelsFn).toHaveBeenCalledTimes(1);
		});

		test("second call with same assignee does not make additional API call", async () => {
			const usersFn = mock(async (filter: unknown) => {
				const f = filter as {
					filter: { email?: { eq: string } };
				};
				if (f.filter.email?.eq === "jane@example.com") {
					return { nodes: [{ id: USER_UUID }] };
				}
				return { nodes: [] };
			});
			const client = createMockClient({ users: usersFn });
			const resolver = new Resolver(client);

			await resolver.resolveAssigneeId("jane@example.com");
			await resolver.resolveAssigneeId("jane@example.com");

			expect(usersFn).toHaveBeenCalledTimes(1);
		});

		test("second call with same workflow state does not make additional API call", async () => {
			const statesFn = mock(async () => ({
				nodes: [{ id: STATE_UUID }],
			}));
			const client = createMockClient({ workflowStates: statesFn });
			const resolver = new Resolver(client);

			await resolver.resolveWorkflowStateId("Backlog", TEAM_UUID);
			await resolver.resolveWorkflowStateId("Backlog", TEAM_UUID);

			expect(statesFn).toHaveBeenCalledTimes(1);
		});
	});
});
