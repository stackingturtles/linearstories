import type { LinearClient } from "@linear/sdk";
import { ResolverError } from "../errors.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
	return UUID_RE.test(value);
}

function isEmail(value: string): boolean {
	return value.includes("@");
}

export class Resolver {
	private client: LinearClient;
	private teamCache = new Map<string, string>();
	private projectCache = new Map<string, string>();
	private labelCache = new Map<string, string>();
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

		const ids: string[] = [];

		for (const name of names) {
			const cached = this.labelCache.get(name);
			if (cached) {
				ids.push(cached);
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

			this.labelCache.set(name, label.id);
			ids.push(label.id);
		}

		return ids;
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
