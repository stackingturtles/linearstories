import type { LinearClient } from "@linear/sdk";
import { EPIC_LABEL, isEpic, validateIssueType } from "../hierarchy.ts";
import { type CreateIssueInput, createIssue, updateIssue } from "../linear/issues.ts";
import { Resolver } from "../linear/resolvers.ts";
import { parseMarkdownFile } from "../markdown/parser.ts";
import { writeBackIds } from "../markdown/writer.ts";
import type { ImportResult, ImportSummary, ResolvedConfig, UserStory } from "../types.ts";

export interface ImportOptions {
	files: string[];
	config: ResolvedConfig;
	team?: string;
	project?: string;
	dryRun?: boolean;
	noWriteBack?: boolean;
}

interface StoryEntry {
	story: UserStory;
	filePath: string;
	index: number;
}

interface ParsedInput {
	filePath: string;
	fileContent: string;
	entries: StoryEntry[];
}

/**
 * Import epics and user stories from markdown files into Linear.
 *
 * Algorithm:
 * Epics are processed before user stories so a new epic and its children can be
 * imported together, even when they live in different files or source order.
 */
export async function importStories(
	client: LinearClient,
	options: ImportOptions,
): Promise<ImportSummary> {
	const resolver = new Resolver(client);
	const parsedInputs: ParsedInput[] = [];
	const entries: StoryEntry[] = [];

	for (const filePath of options.files) {
		const fileContent = await Bun.file(filePath).text();
		const parsed = parseMarkdownFile(fileContent, filePath);
		const startIndex = entries.length;
		const fileEntries = parsed.stories.map((story, offset) => ({
			story,
			filePath,
			index: startIndex + offset,
		}));
		entries.push(...fileEntries);
		parsedInputs.push({ filePath, fileContent, entries: fileEntries });
	}

	const resultsByIndex: Array<ImportResult | undefined> = new Array(entries.length);
	const referenceIndex = buildReferenceIndex(entries);
	const processingOrder = [
		...entries.filter((entry) => isEpic(entry.story)),
		...entries.filter((entry) => !isEpic(entry.story)),
	];
	const invalidDefault = options.config.defaultLabels.includes(EPIC_LABEL)
		? `The ${EPIC_LABEL} label cannot be configured in defaultLabels because it identifies individual issues as epics`
		: null;

	for (const entry of processingOrder) {
		const validationError = invalidDefault ?? validateIssueType(entry.story);
		if (validationError) {
			resultsByIndex[entry.index] = failedResult(entry.story, validationError);
			continue;
		}

		const parent = await resolveParentReference(
			resolver,
			entry,
			referenceIndex,
			resultsByIndex,
			options.dryRun === true,
		);
		if (parent.error) {
			resultsByIndex[entry.index] = failedResult(entry.story, parent.error);
			continue;
		}

		resultsByIndex[entry.index] = await processStory(
			client,
			resolver,
			entry.story,
			options,
			parent.parentId,
		);
	}

	const results = resultsByIndex.filter((result): result is ImportResult => result !== undefined);

	if (!options.dryRun && !options.noWriteBack) {
		for (const input of parsedInputs) {
			const writeBackUpdates = input.entries.flatMap((entry) => {
				const result = resultsByIndex[entry.index];
				return result?.action === "created" && result.linearId && result.linearUrl
					? [{ title: entry.story.title, linearId: result.linearId, linearUrl: result.linearUrl }]
					: [];
			});

			if (writeBackUpdates.length > 0) {
				const updatedContent = writeBackIds(input.filePath, input.fileContent, writeBackUpdates);
				await Bun.write(input.filePath, updatedContent);
			}
		}
	}

	return buildSummary(results);
}

function buildReferenceIndex(entries: StoryEntry[]): Map<string, StoryEntry[]> {
	const index = new Map<string, StoryEntry[]>();
	for (const entry of entries) {
		for (const reference of [entry.story.title, entry.story.linearId]) {
			if (!reference) {
				continue;
			}
			const matches = index.get(reference) ?? [];
			if (!matches.includes(entry)) {
				matches.push(entry);
			}
			index.set(reference, matches);
		}
	}
	return index;
}

async function resolveParentReference(
	resolver: Resolver,
	entry: StoryEntry,
	referenceIndex: Map<string, StoryEntry[]>,
	results: Array<ImportResult | undefined>,
	dryRun: boolean,
): Promise<{ parentId?: string; error?: string }> {
	const reference = entry.story.epic;
	if (!reference) {
		return {};
	}

	const localMatches = referenceIndex.get(reference) ?? [];
	if (localMatches.length > 1) {
		return { error: `Epic reference "${reference}" is ambiguous within the imported files` };
	}

	const localEpic = localMatches[0];
	if (localEpic) {
		if (!isEpic(localEpic.story)) {
			return { error: `Referenced local issue "${reference}" does not have the Epic label` };
		}

		const epicResult = results[localEpic.index];
		if (!epicResult || epicResult.action === "failed") {
			return {
				error: `Cannot link to epic "${reference}" because that epic failed to import${epicResult?.error ? `: ${epicResult.error}` : ""}`,
			};
		}

		if (dryRun) {
			return {};
		}

		const parentId = epicResult.linearId ?? localEpic.story.linearId;
		return parentId
			? { parentId }
			: { error: `Cannot link to epic "${reference}" because it has no Linear identifier` };
	}

	if (!isLinearIssueReference(reference)) {
		return {
			error: `Epic title "${reference}" was not found in the imported files; use an exact local epic title or a Linear identifier such as ENG-42`,
		};
	}

	if (dryRun) {
		return {};
	}

	try {
		const resolved = await resolver.resolveEpicIssue(reference);
		return { parentId: resolved.identifier };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

function isLinearIssueReference(reference: string): boolean {
	return (
		/^[A-Z][A-Z0-9]*-\d+$/i.test(reference) ||
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference)
	);
}

function failedResult(story: UserStory, error: string): ImportResult {
	return { story, action: "failed", error };
}

/**
 * Process a single story: resolve, then create or update.
 */
async function processStory(
	client: LinearClient,
	resolver: Resolver,
	story: UserStory,
	options: ImportOptions,
	parentId?: string,
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
		const storyLabels = isEpic(story) ? [EPIC_LABEL, ...story.labels] : story.labels;
		const allLabels = deduplicateLabels(storyLabels, options.config.defaultLabels);
		const labelIds = allLabels.length > 0 ? await resolver.resolveLabelIds(allLabels) : undefined;
		if (isEpic(story)) {
			const epicLabelIds = await resolver.resolveLabelIds([EPIC_LABEL]);
			if (epicLabelIds.length !== 1) {
				throw new Error(`Required Linear label not found: "${EPIC_LABEL}"`);
			}
		}

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
			return await updateStory(
				client,
				story,
				teamId,
				projectId,
				labelIds,
				assigneeId,
				stateId,
				parentId,
			);
		}
		// CREATE path: story does not have a linear_id
		return await createStory(
			client,
			story,
			teamId,
			projectId,
			labelIds,
			assigneeId,
			stateId,
			parentId,
		);
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
	parentId: string | undefined,
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
	if (parentId) {
		input.parentId = parentId;
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
	parentId: string | undefined,
): Promise<ImportResult> {
	// Linear accepts a human-readable issue identifier for updates.
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
	if (parentId) {
		updateInput.parentId = parentId;
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
