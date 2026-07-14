import type { LinearClient } from "@linear/sdk";
import { ResolverError } from "../errors.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
	return UUID_RE.test(value);
}

function isEmail(value: string): boolean {
	return value.includes("@");
}

export interface ResolvedLabel {
	id: string;
	name: string;
	parentId: string | undefined;
	scope: "team" | "workspace";
}

export type LabelResolution =
	| { status: "existing"; label: ResolvedLabel }
	| {
			status: "missing" | "case-conflict" | "cross-team" | "conflicting";
			detail: string;
			provisionable: boolean;
	  };

export interface ResolvedEpicIssue {
	id: string;
	identifier: string;
}

export class Resolver {
	private client: LinearClient;
	private teamCache = new Map<string, string>();
	private projectCache = new Map<string, string>();
	private labelCache = new Map<string, LabelResolution>();
	private groupNameCache = new Map<string, string>();
	private epicIssueCache = new Map<string, ResolvedEpicIssue>();
	private userCache = new Map<string, string | undefined>();
	private stateCache = new Map<string, string | undefined>();

	constructor(client: LinearClient) {
		this.client = client;
	}

	/**
	 * Resolve a team name (or UUID pass-through) to a team UUID.
	 * Throws ResolverError if the team is not found.
	 */
	async resolveTeamId(nameOrId: string): Promise<string> {
		if (isUuid(nameOrId)) {
			return nameOrId;
		}

		const cached = this.teamCache.get(nameOrId);
		if (cached) {
			return cached;
		}

		const result = await this.client.teams({
			filter: { name: { eq: nameOrId } },
		});

		const team = result.nodes[0];
		if (!team) {
			throw new ResolverError(`Team not found: "${nameOrId}"`);
		}

		this.teamCache.set(nameOrId, team.id);
		return team.id;
	}

	/**
	 * Resolve a project name (or UUID pass-through) to a project UUID.
	 * Scoped to the given team. Throws ResolverError if not found.
	 */
	async resolveProjectId(nameOrId: string, teamId: string): Promise<string> {
		if (isUuid(nameOrId)) {
			return nameOrId;
		}

		const cacheKey = `${teamId}:${nameOrId}`;
		const cached = this.projectCache.get(cacheKey);
		if (cached) {
			return cached;
		}

		const result = await this.client.projects({
			filter: {
				name: { eq: nameOrId },
				accessibleTeams: { some: { id: { eq: teamId } } },
			},
		});

		const project = result.nodes[0];
		if (!project) {
			throw new ResolverError(`Project not found: "${nameOrId}"`);
		}

		this.projectCache.set(cacheKey, project.id);
		return project.id;
	}

	/** Resolve one label for a target team without selecting labels owned by other teams. */
	async resolveLabel(name: string, teamId: string): Promise<LabelResolution> {
		const cacheKey = `${teamId}:${name}`;
		const cached = this.labelCache.get(cacheKey);
		if (cached) {
			return cached;
		}

		const result = await this.client.issueLabels({
			filter: { name: { eqIgnoreCase: name } },
		});
		const labels = result.nodes.map((label) => {
			const value = label as unknown as {
				id: string;
				name?: string;
				teamId?: string;
				parentId?: string;
				isGroup?: boolean;
			};
			return {
				id: value.id,
				name: value.name ?? name,
				teamId: value.teamId,
				parentId: value.parentId,
				isGroup: value.isGroup === true,
			};
		});

		const exact = labels.filter((label) => label.name === name);
		const exactTeam = exact.filter((label) => label.teamId === teamId);
		const exactWorkspace = exact.filter((label) => label.teamId === undefined);
		const selected = exactTeam[0] ?? exactWorkspace[0];

		let resolution: LabelResolution;
		if (exactTeam.length > 1 || (exactTeam.length === 0 && exactWorkspace.length > 1)) {
			resolution = {
				status: "conflicting",
				detail: `Multiple applicable labels named "${name}" were found`,
				provisionable: false,
			};
		} else if (selected?.isGroup) {
			resolution = {
				status: "conflicting",
				detail: `"${name}" is a label group and cannot be applied to issues`,
				provisionable: false,
			};
		} else if (selected) {
			resolution = {
				status: "existing",
				label: {
					id: selected.id,
					name,
					parentId: selected.parentId,
					scope: selected.teamId === teamId ? "team" : "workspace",
				},
			};
		} else {
			const caseOnly = labels.filter(
				(label) => label.name !== name && label.name.toLowerCase() === name.toLowerCase(),
			);
			const applicableCaseOnly = caseOnly.filter(
				(label) => label.teamId === teamId || label.teamId === undefined,
			);
			if (caseOnly.length > 0) {
				resolution = {
					status: "case-conflict",
					detail: `Case-only label match found: ${formatLabelMatches(caseOnly)}`,
					provisionable: applicableCaseOnly.length === 0,
				};
			} else if (exact.length > 0) {
				resolution = {
					status: "cross-team",
					detail: `Exact label "${name}" exists only on another team`,
					provisionable: true,
				};
			} else {
				resolution = {
					status: "missing",
					detail: `Label "${name}" does not exist for the target team or workspace`,
					provisionable: true,
				};
			}
		}

		this.labelCache.set(cacheKey, resolution);
		return resolution;
	}

	/** Create a team-scoped label after preflight has established that it is safe to do so. */
	async createTeamLabel(name: string, teamId: string): Promise<ResolvedLabel> {
		const payload = await this.client.createIssueLabel({ name, teamId });
		if (!payload.success || !payload.issueLabelId) {
			throw new ResolverError(`Linear did not create label "${name}"`);
		}

		const label: ResolvedLabel = {
			id: payload.issueLabelId,
			name,
			parentId: undefined,
			scope: "team",
		};
		this.labelCache.set(`${teamId}:${name}`, { status: "existing", label });
		return label;
	}

	async resolveGroupName(parentId: string): Promise<string> {
		const cached = this.groupNameCache.get(parentId);
		if (cached) {
			return cached;
		}

		try {
			const parent = await this.client.issueLabel(parentId);
			const name = parent.name;
			this.groupNameCache.set(parentId, name);
			return name;
		} catch {
			const fallback = "Unknown group";
			this.groupNameCache.set(parentId, fallback);
			return fallback;
		}
	}

	/** Resolve an existing Linear issue and verify that it is a top-level epic. */
	async resolveEpicIssue(reference: string): Promise<ResolvedEpicIssue> {
		const cached = this.epicIssueCache.get(reference);
		if (cached) {
			return cached;
		}

		try {
			const issue = await this.client.issue(reference);
			const labels = await issue.labels();

			if (!labels.nodes.some((label) => label.name === "Epic")) {
				throw new ResolverError(`Referenced issue "${reference}" does not have the Epic label`);
			}
			if (issue.parentId) {
				throw new ResolverError(
					`Referenced epic "${reference}" already has a parent; only two hierarchy levels are supported`,
				);
			}

			const resolved = { id: issue.id, identifier: issue.identifier };
			this.epicIssueCache.set(reference, resolved);
			this.epicIssueCache.set(issue.identifier, resolved);
			return resolved;
		} catch (error) {
			if (error instanceof ResolverError) {
				throw error;
			}
			throw new ResolverError(
				`Epic issue not found: "${reference}" - ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Resolve an email or display name to a user UUID.
	 * If the input contains "@", searches by email first.
	 * Otherwise searches by display name.
	 * Returns undefined if the user is not found.
	 */
	async resolveAssigneeId(emailOrName: string): Promise<string | undefined> {
		const cached = this.userCache.get(emailOrName);
		if (cached !== undefined) {
			return cached;
		}

		// Check if we've previously cached this key as "not found"
		if (this.userCache.has(emailOrName)) {
			return undefined;
		}

		const filter = isEmail(emailOrName)
			? { email: { eq: emailOrName } }
			: { displayName: { eq: emailOrName } };
		const result = await this.client.users({ filter });

		const user = result.nodes[0];
		if (!user) {
			this.userCache.set(emailOrName, undefined);
			return undefined;
		}

		this.userCache.set(emailOrName, user.id);
		return user.id;
	}

	/**
	 * Resolve a workflow state name to its UUID within a team.
	 * The lookup is case-insensitive.
	 * Returns undefined if the state is not found.
	 */
	async resolveWorkflowStateId(name: string, teamId: string): Promise<string | undefined> {
		const cacheKey = `${teamId}:${name.toLowerCase()}`;
		if (this.stateCache.has(cacheKey)) {
			return this.stateCache.get(cacheKey);
		}

		const result = await this.client.workflowStates({
			filter: {
				team: { id: { eq: teamId } },
				name: { eqIgnoreCase: name },
			},
		});

		const state = result.nodes[0];
		if (!state) {
			this.stateCache.set(cacheKey, undefined);
			return undefined;
		}

		this.stateCache.set(cacheKey, state.id);
		return state.id;
	}
}

function formatLabelMatches(labels: Array<{ name: string; teamId?: string }>): string {
	return labels
		.map((label) => `"${label.name}" (${label.teamId ? `team ${label.teamId}` : "workspace"})`)
		.join(", ");
}
