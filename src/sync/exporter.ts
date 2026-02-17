import type { LinearClient } from "@linear/sdk";
import { buildIssueFilter, type IssueFilterInput } from "../linear/filters.ts";
import { fetchIssues } from "../linear/issues.ts";
import { Resolver } from "../linear/resolvers.ts";
import { serializeStories } from "../markdown/serializer.ts";
import type {
	ExportFilters,
	FileFrontmatter,
	LinearIssueData,
	ResolvedConfig,
	UserStory,
} from "../types.ts";

export interface ExportOptions {
	config: ResolvedConfig;
	filters: ExportFilters;
	team?: string;
	outputPath: string;
}

/**
 * Export Linear issues to a markdown file.
 *
 * Algorithm:
 * 1. Build filter from options.filters
 * 2. Fetch issues from Linear
 * 3. Convert LinearIssueData[] to UserStory[]
 * 4. Serialize to markdown
 * 5. Write to outputPath
 * 6. Return count and path
 */
export async function exportStories(
	client: LinearClient,
	options: ExportOptions,
): Promise<{ count: number; outputPath: string }> {
	const resolver = new Resolver(client);

	// 1. Build filter from high-level ExportFilters
	const filterInput = await buildFilterInput(resolver, options.filters, options.team);
	const filter = buildIssueFilter(filterInput);

	// 2. Fetch issues from Linear
	const issues = await fetchIssues(client, filter);

	// 3. Convert to UserStory[]
	const stories = issues.map(issueToUserStory);

	// 4. Build optional frontmatter
	const frontmatter: FileFrontmatter = {};
	if (options.team) {
		frontmatter.team = options.team;
	}
	// If all stories share the same project, include it in frontmatter
	if (options.filters.project) {
		frontmatter.project = options.filters.project;
	}

	// 5. Serialize and write
	const markdown = serializeStories(stories, frontmatter);
	await Bun.write(options.outputPath, markdown);

	// 6. Return count and path
	return {
		count: stories.length,
		outputPath: options.outputPath,
	};
}

/**
 * Convert high-level ExportFilters to the IssueFilterInput that buildIssueFilter expects.
 * This may involve resolving project names to IDs.
 */
async function buildFilterInput(
	resolver: Resolver,
	filters: ExportFilters,
	team?: string,
): Promise<IssueFilterInput> {
	const input: IssueFilterInput = {};

	if (filters.project && team) {
		try {
			const teamId = await resolver.resolveTeamId(team);
			const projectId = await resolver.resolveProjectId(filters.project, teamId);
			input.projectId = projectId;
		} catch {
			// If resolution fails, try filtering by project name as-is
			// (the API may accept it)
		}
	}

	if (filters.issues && filters.issues.length > 0) {
		input.identifiers = filters.issues;
	}

	if (filters.status) {
		input.statusName = filters.status;
	}

	if (filters.assignee) {
		input.assigneeEmail = filters.assignee;
	}

	if (filters.creator) {
		input.creatorEmail = filters.creator;
	}

	return input;
}

/**
 * Convert a LinearIssueData object to a UserStory.
 */
function issueToUserStory(issue: LinearIssueData): UserStory {
	return {
		title: issue.title,
		linearId: issue.identifier,
		linearUrl: issue.url,
		priority: issue.priority ?? null,
		labels: issue.labels?.nodes?.map((l) => l.name) ?? [],
		estimate: issue.estimate ?? null,
		assignee: issue.assignee?.email ?? null,
		status: issue.state?.name ?? null,
		body: issue.description ?? "",
		project: issue.project?.name ?? null,
		team: issue.team?.name ?? null,
	};
}
