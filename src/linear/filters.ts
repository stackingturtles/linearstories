export interface IssueFilterInput {
	projectId?: string;
	teamId?: string;
	identifiers?: string[];
	statusName?: string;
	assigneeEmail?: string;
	creatorEmail?: string;
	labelName?: string;
	topLevelOnly?: boolean;
}

/**
 * Build a Linear API issue filter object from structured input.
 * Each provided field maps to its corresponding Linear filter syntax.
 * Multiple fields are combined at the top level (AND logic).
 */
export function buildIssueFilter(input: IssueFilterInput): Record<string, unknown> {
	const filter: Record<string, unknown> = {};

	if (input.projectId) {
		filter.project = { id: { eq: input.projectId } };
	}

	const teamFilter: Record<string, unknown> = {};
	if (input.teamId) {
		teamFilter.id = { eq: input.teamId };
	}

	if (input.identifiers && input.identifiers.length > 0) {
		// Linear API doesn't support filtering by identifier directly.
		// Parse "TEAM-123" into number + team key filters.
		const numbers: number[] = [];
		const teamKeys = new Set<string>();

		for (const id of input.identifiers) {
			const match = id.match(/^([A-Za-z]+)-(\d+)$/);
			if (match) {
				const [, rawTeamKey, rawNumber] = match;
				if (!rawTeamKey || !rawNumber) {
					continue;
				}
				teamKeys.add(rawTeamKey.toUpperCase());
				numbers.push(Number.parseInt(rawNumber, 10));
			}
		}

		if (numbers.length > 0) {
			filter.number = { in: numbers };
		}
		if (teamKeys.size === 1) {
			teamFilter.key = { eq: [...teamKeys][0] };
		}
	}

	if (Object.keys(teamFilter).length > 0) {
		filter.team = teamFilter;
	}

	if (input.statusName) {
		filter.state = { name: { eqIgnoreCase: input.statusName } };
	}

	if (input.assigneeEmail) {
		filter.assignee = { email: { eq: input.assigneeEmail } };
	}

	if (input.creatorEmail) {
		filter.creator = { email: { eq: input.creatorEmail } };
	}

	if (input.labelName) {
		filter.labels = { name: { eq: input.labelName } };
	}

	if (input.topLevelOnly) {
		filter.parent = { null: true };
	}

	return filter;
}
