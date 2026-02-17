export interface IssueFilterInput {
	projectId?: string;
	identifiers?: string[];
	statusName?: string;
	assigneeEmail?: string;
	creatorEmail?: string;
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

	if (input.identifiers && input.identifiers.length > 0) {
		// Linear API doesn't support filtering by identifier directly.
		// Parse "TEAM-123" into number + team key filters.
		const numbers: number[] = [];
		const teamKeys = new Set<string>();

		for (const id of input.identifiers) {
			const match = id.match(/^([A-Za-z]+)-(\d+)$/);
			if (match) {
				teamKeys.add(match[1].toUpperCase());
				numbers.push(Number.parseInt(match[2], 10));
			}
		}

		if (numbers.length > 0) {
			filter.number = { in: numbers };
		}
		if (teamKeys.size === 1) {
			filter.team = { key: { eq: [...teamKeys][0] } };
		}
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

	return filter;
}
