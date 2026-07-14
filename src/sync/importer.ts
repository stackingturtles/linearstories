import type { LinearClient } from "@linear/sdk";
import { isEpic } from "../hierarchy.ts";
import {
	type CreateIssueInput,
	createIssue,
	type UpdateIssueInput,
	updateIssue,
} from "../linear/issues.ts";
import { Resolver } from "../linear/resolvers.ts";
import { parseMarkdownFile } from "../markdown/parser.ts";
import { writeBackIds } from "../markdown/writer.ts";
import type {
	ImportPreflightReport,
	ImportResult,
	ImportSummary,
	ResolvedConfig,
	UserStory,
} from "../types.ts";
import { preflightEntries, type StoryImportPlan, validateLocalEntries } from "./preflight.ts";

export interface ImportOptions {
	files: string[];
	config: ResolvedConfig;
	team?: string;
	project?: string;
	dryRun?: boolean;
	preflight?: boolean;
	createMissingLabels?: boolean;
	allowMissingLabels?: boolean;
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

/** Import epics and user stories after validating every local and remote prerequisite. */
export async function importStories(
	client: LinearClient,
	options: ImportOptions,
): Promise<ImportSummary> {
	validateImportOptions(options);
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

	const preflightOptions = {
		config: options.config,
		team: options.team,
		project: options.project,
		createMissingLabels: options.createMissingLabels,
		allowMissingLabels: options.allowMissingLabels,
	};

	if (options.dryRun) {
		const local = validateLocalEntries(entries, preflightOptions);
		return buildSummary(buildValidationResults(entries, local.errorsByIndex));
	}

	const resolver = new Resolver(client);
	const preflight = await preflightEntries(resolver, entries, preflightOptions);
	if (!preflight.report.passed) {
		return buildSummary(buildValidationResults(entries, preflight.errorsByIndex), preflight.report);
	}
	if (options.preflight) {
		return buildSummary(
			entries.map((entry) => ({ story: entry.story, action: "skipped" })),
			preflight.report,
		);
	}

	const resultsByIndex: Array<ImportResult | undefined> = new Array(entries.length);
	const processingOrder = [
		...entries.filter((entry) => isEpic(entry.story)),
		...entries.filter((entry) => !isEpic(entry.story)),
	];

	for (const entry of processingOrder) {
		const plan = preflight.plans.get(entry.index);
		if (!plan?.teamId) {
			resultsByIndex[entry.index] = failedResult(
				entry.story,
				"Import plan is missing a resolved team",
			);
			continue;
		}

		const parent = resolvePlannedParent(entry, plan, entries, resultsByIndex);
		if (parent.error) {
			resultsByIndex[entry.index] = failedResult(entry.story, parent.error);
			continue;
		}

		resultsByIndex[entry.index] = await processStory(client, entry.story, plan, parent.parentId);
	}

	const results = resultsByIndex.filter((result): result is ImportResult => result !== undefined);
	if (!options.noWriteBack) {
		await writeBackCreatedIds(parsedInputs, resultsByIndex);
	}

	return buildSummary(results, preflight.report);
}

function validateImportOptions(options: ImportOptions): void {
	if (options.dryRun && options.preflight) {
		throw new Error("--dry-run and --preflight are separate modes and cannot be combined");
	}
	if (options.dryRun && (options.createMissingLabels || options.allowMissingLabels)) {
		throw new Error("--dry-run cannot be combined with remote label options");
	}
	if (options.preflight && options.createMissingLabels) {
		throw new Error("--preflight is read-only and cannot be combined with --create-missing-labels");
	}
	if (options.createMissingLabels && options.allowMissingLabels) {
		throw new Error("Choose either --create-missing-labels or --allow-missing-labels, not both");
	}
}

function resolvePlannedParent(
	entry: StoryEntry,
	plan: StoryImportPlan,
	entries: StoryEntry[],
	results: Array<ImportResult | undefined>,
): { parentId?: string; error?: string } {
	if (plan.externalParentId) return { parentId: plan.externalParentId };
	if (plan.localParentIndex === undefined) return {};

	const parentEntry = entries[plan.localParentIndex];
	const parentResult = results[plan.localParentIndex];
	const reference = entry.story.epic as string;
	if (!parentResult || parentResult.action === "failed") {
		return {
			error: `Cannot link to epic "${reference}" because that epic failed to import${parentResult?.error ? `: ${parentResult.error}` : ""}`,
		};
	}

	const parentId = parentResult.linearId ?? parentEntry?.story.linearId ?? undefined;
	return parentId
		? { parentId }
		: { error: `Cannot link to epic "${reference}" because it has no Linear identifier` };
}

async function processStory(
	client: LinearClient,
	story: UserStory,
	plan: StoryImportPlan,
	parentId?: string,
): Promise<ImportResult> {
	try {
		return story.linearId
			? await updateStory(client, story, plan, parentId)
			: await createStory(client, story, plan, parentId);
	} catch (error) {
		return failedResult(story, error instanceof Error ? error.message : String(error));
	}
}

async function createStory(
	client: LinearClient,
	story: UserStory,
	plan: StoryImportPlan,
	parentId?: string,
): Promise<ImportResult> {
	const input: CreateIssueInput = {
		title: story.title,
		teamId: plan.teamId as string,
	};

	if (story.body) input.description = story.body;
	if (plan.projectId) input.projectId = plan.projectId;
	if (plan.labelIds.length > 0) input.labelIds = plan.labelIds;
	if (plan.assigneeId) input.assigneeId = plan.assigneeId;
	if (story.priority !== null) input.priority = story.priority;
	if (story.estimate !== null) input.estimate = story.estimate;
	if (plan.stateId) input.stateId = plan.stateId;
	if (parentId) input.parentId = parentId;

	const result = await createIssue(client, input);
	return {
		story,
		action: "created",
		linearId: result.identifier,
		linearUrl: result.url,
	};
}

async function updateStory(
	client: LinearClient,
	story: UserStory,
	plan: StoryImportPlan,
	parentId?: string,
): Promise<ImportResult> {
	const issueIdentifier = story.linearId as string;
	const updateInput: UpdateIssueInput = {
		title: story.title,
		parentId: parentId ?? null,
	};

	if (plan.syncLabels) updateInput.labelIds = plan.labelIds;
	if (story.body) updateInput.description = story.body;
	if (plan.projectId) updateInput.projectId = plan.projectId;
	if (plan.assigneeId) updateInput.assigneeId = plan.assigneeId;
	if (story.priority !== null) updateInput.priority = story.priority;
	if (story.estimate !== null) updateInput.estimate = story.estimate;
	if (plan.stateId) updateInput.stateId = plan.stateId;
	await updateIssue(client, issueIdentifier, updateInput);

	return {
		story,
		action: "updated",
		linearId: issueIdentifier,
		linearUrl: story.linearUrl ?? undefined,
	};
}

async function writeBackCreatedIds(
	parsedInputs: ParsedInput[],
	resultsByIndex: Array<ImportResult | undefined>,
): Promise<void> {
	for (const input of parsedInputs) {
		const updates = input.entries.flatMap((entry) => {
			const result = resultsByIndex[entry.index];
			return result?.action === "created" && result.linearId && result.linearUrl
				? [{ title: entry.story.title, linearId: result.linearId, linearUrl: result.linearUrl }]
				: [];
		});
		if (updates.length > 0) {
			await Bun.write(input.filePath, writeBackIds(input.filePath, input.fileContent, updates));
		}
	}
}

function buildValidationResults(
	entries: StoryEntry[],
	errorsByIndex: Map<number, string[]>,
): ImportResult[] {
	return entries.map((entry) => {
		const errors = errorsByIndex.get(entry.index);
		return errors && errors.length > 0
			? failedResult(entry.story, errors.join("; "))
			: { story: entry.story, action: "skipped" };
	});
}

function failedResult(story: UserStory, error: string): ImportResult {
	return { story, action: "failed", error };
}

function buildSummary(results: ImportResult[], preflight?: ImportPreflightReport): ImportSummary {
	const summary: ImportSummary = {
		total: results.length,
		created: 0,
		updated: 0,
		failed: 0,
		skipped: 0,
		results,
		preflight,
	};
	for (const result of results) summary[result.action]++;
	return summary;
}
