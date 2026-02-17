import type { LinearClient } from "@linear/sdk";
import { type CreateIssueInput, createIssue, updateIssue } from "../linear/issues.ts";
import { Resolver } from "../linear/resolvers.ts";
import { parseMarkdownFile } from "../markdown/parser.ts";
import { writeBackIds } from "../markdown/writer.ts";
import type {
	ImportResult,
	ImportSummary,
	ParsedFile,
	ResolvedConfig,
	UserStory,
} from "../types.ts";

export interface ImportOptions {
	files: string[];
	config: ResolvedConfig;
	team?: string;
	project?: string;
	dryRun?: boolean;
	noWriteBack?: boolean;
}

/**
 * Import user stories from markdown files into Linear.
 *
 * Algorithm:
 * 1. Read each file and parse with parseMarkdownFile
 * 2. For each story, resolve names to UUIDs (team, project, labels, assignee, status)
 * 3. If linear_id present -> update, else -> create
 * 4. If not dry-run: make API calls
 * 5. If not no-write-back: write back linear_id and linear_url
 * 6. Continue on failure per story
 * 7. Return ImportSummary
 */
export async function importStories(
	client: LinearClient,
	options: ImportOptions,
): Promise<ImportSummary> {
	const resolver = new Resolver(client);
	const results: ImportResult[] = [];

	for (const filePath of options.files) {
		// 1. Read and parse the markdown file
		const fileContent = await Bun.file(filePath).text();
		const parsed = parseMarkdownFile(fileContent, filePath);

		// Track write-back updates for this file
		const writeBackUpdates: Array<{
			title: string;
			linearId: string;
			linearUrl: string;
		}> = [];

		// 2. Process each story
		for (const story of parsed.stories) {
			const result = await processStory(client, resolver, story, parsed, options);
			results.push(result);

			// Collect write-back data for newly created stories
			if (result.action === "created" && result.linearId && result.linearUrl) {
				writeBackUpdates.push({
					title: story.title,
					linearId: result.linearId,
					linearUrl: result.linearUrl,
				});
			}
		}

		// 5. Write back if applicable
		if (!options.dryRun && !options.noWriteBack && writeBackUpdates.length > 0) {
			const updatedContent = writeBackIds(filePath, fileContent, writeBackUpdates);
			await Bun.write(filePath, updatedContent);
		}
	}

	// 7. Build and return summary
	return buildSummary(results);
}

/**
 * Process a single story: resolve, then create or update.
 */
async function processStory(
	client: LinearClient,
	resolver: Resolver,
	story: UserStory,
	_parsed: ParsedFile,
	options: ImportOptions,
): Promise<ImportResult> {
	// Dry-run: skip all API calls
	if (options.dryRun) {
		return {
			story,
			action: "skipped",
		};
	}

	try {
		// Determine team: story.team -> options.team -> config.defaultTeam
		const teamName = story.team ?? options.team ?? options.config.defaultTeam;
		if (!teamName) {
			return {
				story,
				action: "failed",
				error: "No team specified for story and no default team configured",
			};
		}

		const teamId = await resolver.resolveTeamId(teamName);

		// Determine project: story.project -> options.project -> config.defaultProject
		const projectName = story.project ?? options.project ?? options.config.defaultProject;
		let projectId: string | undefined;
		if (projectName) {
			projectId = await resolver.resolveProjectId(projectName, teamId);
		}

		// Merge labels: story.labels + config.defaultLabels (deduplicated)
		const allLabels = deduplicateLabels(story.labels, options.config.defaultLabels);
		const labelIds = allLabels.length > 0 ? await resolver.resolveLabelIds(allLabels) : undefined;

		// Resolve assignee
		let assigneeId: string | undefined;
		if (story.assignee) {
			assigneeId = await resolver.resolveAssigneeId(story.assignee);
		}

		// Resolve workflow state
		let stateId: string | undefined;
		if (story.status) {
			stateId = await resolver.resolveWorkflowStateId(story.status, teamId);
		}

		if (story.linearId) {
			// UPDATE path: story already has a linear_id
			return await updateStory(client, story, teamId, projectId, labelIds, assigneeId, stateId);
		}
		// CREATE path: story does not have a linear_id
		return await createStory(client, story, teamId, projectId, labelIds, assigneeId, stateId);
	} catch (error) {
		return {
			story,
			action: "failed",
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Create a new Linear issue from a story.
 */
async function createStory(
	client: LinearClient,
	story: UserStory,
	teamId: string,
	projectId: string | undefined,
	labelIds: string[] | undefined,
	assigneeId: string | undefined,
	stateId: string | undefined,
): Promise<ImportResult> {
	const input: CreateIssueInput = {
		title: story.title,
		teamId,
	};

	if (story.body) {
		input.description = story.body;
	}
	if (projectId) {
		input.projectId = projectId;
	}
	if (labelIds && labelIds.length > 0) {
		input.labelIds = labelIds;
	}
	if (assigneeId) {
		input.assigneeId = assigneeId;
	}
	if (story.priority !== null) {
		input.priority = story.priority;
	}
	if (story.estimate !== null) {
		input.estimate = story.estimate;
	}
	if (stateId) {
		input.stateId = stateId;
	}

	const result = await createIssue(client, input);

	return {
		story,
		action: "created",
		linearId: result.identifier,
		linearUrl: result.url,
	};
}

/**
 * Update an existing Linear issue from a story.
 */
async function updateStory(
	client: LinearClient,
	story: UserStory,
	_teamId: string,
	projectId: string | undefined,
	labelIds: string[] | undefined,
	assigneeId: string | undefined,
	stateId: string | undefined,
): Promise<ImportResult> {
	// We need to look up the internal UUID for the issue by its identifier.
	// The linear_id in the story is the identifier (e.g., "ENG-42"), but
	// updateIssue needs the internal UUID. We use the identifier to find
	// the issue first.
	const issueIdentifier = story.linearId as string;

	const updateInput: Record<string, unknown> = {
		title: story.title,
	};

	if (story.body) {
		updateInput.description = story.body;
	}
	if (projectId) {
		updateInput.projectId = projectId;
	}
	if (labelIds && labelIds.length > 0) {
		updateInput.labelIds = labelIds;
	}
	if (assigneeId) {
		updateInput.assigneeId = assigneeId;
	}
	if (story.priority !== null) {
		updateInput.priority = story.priority;
	}
	if (story.estimate !== null) {
		updateInput.estimate = story.estimate;
	}
	if (stateId) {
		updateInput.stateId = stateId;
	}

	await updateIssue(client, issueIdentifier, updateInput);

	return {
		story,
		action: "updated",
		linearId: issueIdentifier,
		linearUrl: story.linearUrl ?? undefined,
	};
}

/**
 * Deduplicate labels from story and default labels.
 */
function deduplicateLabels(storyLabels: string[], defaultLabels: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];

	for (const label of [...storyLabels, ...defaultLabels]) {
		if (!seen.has(label)) {
			seen.add(label);
			result.push(label);
		}
	}

	return result;
}

/**
 * Build an ImportSummary from an array of ImportResult.
 */
function buildSummary(results: ImportResult[]): ImportSummary {
	let created = 0;
	let updated = 0;
	let failed = 0;
	let skipped = 0;

	for (const result of results) {
		switch (result.action) {
			case "created":
				created++;
				break;
			case "updated":
				updated++;
				break;
			case "failed":
				failed++;
				break;
			case "skipped":
				skipped++;
				break;
		}
	}

	return {
		total: results.length,
		created,
		updated,
		failed,
		skipped,
		results,
	};
}
