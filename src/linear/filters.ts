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
		filter.identifier = { in: input.identifiers };
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
