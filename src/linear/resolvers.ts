import type { LinearClient } from "@linear/sdk";
import { ResolverError } from "../errors.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
	return UUID_RE.test(value);
}

function isEmail(value: string): boolean {
	return value.includes("@");
}

interface ResolvedLabel {
	id: string;
	parentId: string | undefined;
}

export interface ResolvedEpicIssue {
	id: string;
	identifier: string;
}

export class Resolver {
	private client: LinearClient;
	private teamCache = new Map<string, string>();
	private projectCache = new Map<string, string>();
	private labelCache = new Map<string, ResolvedLabel>();
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

	/**
	 * Resolve an array of label names to their UUIDs.
	 * Warns for any labels that cannot be found and skips them.
	 * Returns an empty array for empty input.
	 */
	async resolveLabelIds(names: string[]): Promise<string[]> {
		if (names.length === 0) {
			return [];
		}

		const resolved: Array<{ name: string; label: ResolvedLabel }> = [];

		for (const name of names) {
			const cached = this.labelCache.get(name);
			if (cached) {
				resolved.push({ name, label: cached });
				continue;
			}

			const result = await this.client.issueLabels({
				filter: { name: { eq: name } },
			});

			const label = result.nodes[0];
			if (!label) {
				console.warn(`Label not found, skipping: "${name}"`);
				continue;
			}

			const parentId = (label as unknown as { parentId?: string }).parentId;
			const entry: ResolvedLabel = { id: label.id, parentId };
			this.labelCache.set(name, entry);
			resolved.push({ name, label: entry });
		}

		return this.filterGroupConflicts(resolved);
	}

	private async filterGroupConflicts(
		resolved: Array<{ name: string; label: ResolvedLabel }>,
	): Promise<string[]> {
		const seenGroups = new Map<string, string>(); // groupId → first label name
		const ids: string[] = [];

		for (const { name, label } of resolved) {
			if (label.parentId === undefined) {
				ids.push(label.id);
				continue;
			}

			const existing = seenGroups.get(label.parentId);
			if (existing) {
				const groupName = await this.resolveGroupName(label.parentId);
				console.warn(
					`Label "${name}" conflicts with "${existing}" (both in group "${groupName}"), skipping`,
				);
				continue;
			}

			seenGroups.set(label.parentId, name);
			ids.push(label.id);
		}

		return ids;
	}

	private async resolveGroupName(parentId: string): Promise<string> {
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
