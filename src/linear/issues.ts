import type { LinearClient } from "@linear/sdk";
import { LinearApiError } from "../errors.ts";
import type { LinearIssueData } from "../types.ts";

export interface CreateIssueInput {
	title: string;
	description?: string;
	teamId: string;
	projectId?: string;
	labelIds?: string[];
	assigneeId?: string;
	priority?: number;
	estimate?: number;
	stateId?: string;
}

export interface CreateIssueResult {
	id: string;
	identifier: string;
	url: string;
}

export interface UpdateIssueResult {
	identifier: string;
}

// The Linear SDK's LinearClient has methods like createIssue, updateIssue, issues
// but the TypeScript types don't always expose them directly. We use this interface
// to bridge the gap without resorting to `any`.
interface LinearClientWithMethods {
	createIssue(input: Record<string, unknown>): Promise<{
		success: boolean;
		issue: Promise<{ id: string; identifier: string; url: string }>;
	}>;
	updateIssue(
		issueId: string,
		input: Record<string, unknown>,
	): Promise<{
		success: boolean;
		issue: Promise<{ identifier: string }>;
	}>;
	issues(opts: Record<string, unknown>): Promise<{
		nodes: Array<Record<string, unknown>>;
		pageInfo?: { hasNextPage: boolean; endCursor: string };
	}>;
}

/**
 * Create a new Linear issue from the given input.
 * Maps CreateIssueInput fields to the Linear SDK's IssueCreateInput.
 */
export async function createIssue(
	client: LinearClient,
	input: CreateIssueInput,
): Promise<CreateIssueResult> {
	try {
		const createInput: Record<string, unknown> = {
			title: input.title,
			teamId: input.teamId,
		};

		if (input.description !== undefined) {
			createInput.description = input.description;
		}
		if (input.projectId !== undefined) {
			createInput.projectId = input.projectId;
		}
		if (input.labelIds !== undefined) {
			createInput.labelIds = input.labelIds;
		}
		if (input.assigneeId !== undefined) {
			createInput.assigneeId = input.assigneeId;
		}
		if (input.priority !== undefined) {
			createInput.priority = input.priority;
		}
		if (input.estimate !== undefined) {
			createInput.estimate = input.estimate;
		}
		if (input.stateId !== undefined) {
			createInput.stateId = input.stateId;
		}

		const typedClient = client as unknown as LinearClientWithMethods;
		const response = await typedClient.createIssue(createInput);

		if (!response.success) {
			throw new LinearApiError(`Failed to create issue: "${input.title}"`);
		}

		const issue = await response.issue;
		return {
			id: issue.id,
			identifier: issue.identifier,
			url: issue.url,
		};
	} catch (error) {
		if (error instanceof LinearApiError) {
			throw error;
		}
		throw new LinearApiError(
			`Failed to create issue: "${input.title}" - ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Update an existing Linear issue.
 */
export async function updateIssue(
	client: LinearClient,
	issueId: string,
	input: Partial<Omit<CreateIssueInput, "teamId">>,
): Promise<UpdateIssueResult> {
	try {
		const typedClient = client as unknown as LinearClientWithMethods;
		const response = await typedClient.updateIssue(issueId, input);

		if (!response.success) {
			throw new LinearApiError(`Failed to update issue: "${issueId}"`);
		}

		const issue = await response.issue;
		return {
			identifier: issue.identifier,
		};
	} catch (error) {
		if (error instanceof LinearApiError) {
			throw error;
		}
		throw new LinearApiError(
			`Failed to update issue: "${issueId}" - ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Fetch issues from Linear, resolving all async fields into plain data objects.
 * Supports cursor-based pagination.
 */
export async function fetchIssues(
	client: LinearClient,
	filter: Record<string, unknown>,
): Promise<LinearIssueData[]> {
	const allIssues: LinearIssueData[] = [];
	let cursor: string | undefined;

	do {
		const opts: Record<string, unknown> = { filter, first: 50 };
		if (cursor) {
			opts.after = cursor;
		}

		const typedClient = client as unknown as LinearClientWithMethods;
		const response = await typedClient.issues(opts);
		const nodes = response.nodes ?? [];

		for (const node of nodes) {
			const resolved = await resolveIssueFields(node);
			allIssues.push(resolved);
		}

		if (response.pageInfo?.hasNextPage) {
			cursor = response.pageInfo.endCursor;
		} else {
			cursor = undefined;
		}
	} while (cursor);

	return allIssues;
}

/**
 * Resolve async fields on a Linear issue node into a plain LinearIssueData.
 */
async function resolveIssueFields(node: Record<string, unknown>): Promise<LinearIssueData> {
	const [state, assignee, labels, project, team] = await Promise.all([
		node.state as Promise<unknown>,
		node.assignee as Promise<unknown>,
		typeof node.labels === "function"
			? (node.labels as () => Promise<unknown>)()
			: (node.labels as Promise<unknown>),
		node.project as Promise<unknown>,
		node.team as Promise<unknown>,
	]);

	return {
		id: node.id as string,
		identifier: node.identifier as string,
		url: node.url as string,
		title: node.title as string,
		description: node.description as string | undefined,
		priority: node.priority as number | undefined,
		estimate: node.estimate as number | undefined,
		state: (state as Record<string, unknown>) ?? undefined,
		assignee: (assignee as Record<string, unknown>) ?? undefined,
		labels: (labels as { nodes: Array<Record<string, unknown>> }) ?? { nodes: [] },
		project: (project as Record<string, unknown>) ?? undefined,
		team: team as Record<string, unknown>,
	};
}
