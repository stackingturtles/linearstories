import { EPIC_LABEL, isEpic, validateIssueType } from "../hierarchy.ts";
import type { LabelResolution, ResolvedLabel, Resolver } from "../linear/resolvers.ts";
import type {
	ImportPreflightReport,
	LabelPreflightResult,
	ResolvedConfig,
	UserStory,
} from "../types.ts";

export interface PreflightEntry {
	story: UserStory;
	index: number;
}

export interface PreflightOptions {
	config: ResolvedConfig;
	team?: string;
	project?: string;
	createMissingLabels?: boolean;
	allowMissingLabels?: boolean;
}

export interface StoryImportPlan {
	teamName: string;
	teamId?: string;
	projectName?: string;
	projectId?: string;
	labelNames: string[];
	labelIds: string[];
	syncLabels: boolean;
	assigneeId?: string;
	stateId?: string;
	localParentIndex?: number;
	externalParentReference?: string;
	externalParentId?: string;
}

export interface ImportPreflightOutcome {
	plans: Map<number, StoryImportPlan>;
	errorsByIndex: Map<number, string[]>;
	report: ImportPreflightReport;
}

interface LocalValidation {
	plans: Map<number, StoryImportPlan>;
	errorsByIndex: Map<number, string[]>;
}

interface LabelTarget {
	teamName: string;
	teamId: string;
	name: string;
	entryIndexes: Set<number>;
	resolution?: LabelResolution;
	result?: LabelPreflightResult;
}

export function validateLocalEntries(
	entries: PreflightEntry[],
	options: Pick<PreflightOptions, "config" | "team" | "project">,
): LocalValidation {
	const plans = new Map<number, StoryImportPlan>();
	const errorsByIndex = new Map<number, string[]>();
	const referenceIndex = buildReferenceIndex(entries);
	const invalidDefault = options.config.defaultLabels.includes(EPIC_LABEL)
		? `The ${EPIC_LABEL} label cannot be configured in defaultLabels because it identifies individual issues as epics`
		: undefined;

	for (const entry of entries) {
		const teamName = options.team ?? entry.story.team ?? options.config.defaultTeam ?? "";
		const projectName =
			options.project ?? entry.story.project ?? options.config.defaultProject ?? undefined;
		const storyLabels = isEpic(entry.story)
			? [EPIC_LABEL, ...entry.story.labels]
			: entry.story.labels;
		const plan: StoryImportPlan = {
			teamName,
			projectName,
			labelNames: deduplicateLabels(storyLabels, options.config.defaultLabels),
			labelIds: [],
			syncLabels: true,
		};
		plans.set(entry.index, plan);

		const validationError = invalidDefault ?? validateIssueType(entry.story);
		if (validationError) {
			addIndexError(errorsByIndex, entry.index, validationError);
		}
		if (!teamName) {
			addIndexError(errorsByIndex, entry.index, "No team specified and no default team configured");
		}

		const reference = entry.story.epic;
		if (!reference) {
			continue;
		}

		const localMatches = referenceIndex.get(reference) ?? [];
		if (localMatches.length > 1) {
			addIndexError(
				errorsByIndex,
				entry.index,
				`Epic reference "${reference}" is ambiguous within the imported files`,
			);
			continue;
		}

		const localEpic = localMatches[0];
		if (localEpic) {
			if (!isEpic(localEpic.story)) {
				addIndexError(
					errorsByIndex,
					entry.index,
					`Referenced local issue "${reference}" does not have the Epic label`,
				);
			} else {
				plan.localParentIndex = localEpic.index;
			}
			continue;
		}

		if (!isLinearIssueReference(reference)) {
			addIndexError(
				errorsByIndex,
				entry.index,
				`Epic title "${reference}" was not found in the imported files; use an exact local epic title or a Linear identifier such as ENG-42`,
			);
		} else {
			plan.externalParentReference = reference;
		}
	}

	return { plans, errorsByIndex };
}

export async function preflightEntries(
	resolver: Resolver,
	entries: PreflightEntry[],
	options: PreflightOptions,
): Promise<ImportPreflightOutcome> {
	const local = validateLocalEntries(entries, options);
	const report: ImportPreflightReport = {
		passed: false,
		labels: [],
		errors: [],
		warnings: [],
	};

	for (const entry of entries) {
		for (const error of local.errorsByIndex.get(entry.index) ?? []) {
			addReportError(report, `${entry.story.title}: ${error}`);
		}
	}
	if (report.errors.length > 0) {
		return { ...local, report };
	}

	const entriesByIndex = new Map(entries.map((entry) => [entry.index, entry]));
	const teamTargets = groupPlans(local.plans, (plan) => plan.teamName);
	for (const [teamName, indexes] of teamTargets) {
		try {
			const teamId = await resolver.resolveTeamId(teamName);
			for (const index of indexes) {
				const plan = local.plans.get(index);
				if (plan) plan.teamId = teamId;
			}
		} catch (error) {
			addResourceError(
				report,
				local.errorsByIndex,
				indexes,
				`Team "${teamName}" could not be resolved: ${errorMessage(error)}`,
			);
		}
	}

	const projectTargets = new Map<
		string,
		{ teamName: string; teamId: string; projectName: string; indexes: Set<number> }
	>();
	for (const [index, plan] of local.plans) {
		if (!plan.teamId || !plan.projectName) continue;
		const key = resourceKey(plan.teamId, plan.projectName);
		const target = projectTargets.get(key) ?? {
			teamName: plan.teamName,
			teamId: plan.teamId,
			projectName: plan.projectName,
			indexes: new Set<number>(),
		};
		target.indexes.add(index);
		projectTargets.set(key, target);
	}
	for (const target of projectTargets.values()) {
		try {
			const projectId = await resolver.resolveProjectId(target.projectName, target.teamId);
			for (const index of target.indexes) {
				const plan = local.plans.get(index);
				if (plan) plan.projectId = projectId;
			}
		} catch (error) {
			addResourceError(
				report,
				local.errorsByIndex,
				target.indexes,
				`Project "${target.projectName}" for team "${target.teamName}" could not be resolved: ${errorMessage(error)}`,
			);
		}
	}

	const labelTargets = collectLabelTargets(local.plans);
	for (const target of labelTargets.values()) {
		try {
			target.resolution = await resolver.resolveLabel(target.name, target.teamId);
		} catch (error) {
			target.result = {
				team: target.teamName,
				name: target.name,
				status: "conflicting",
				detail: `Lookup failed: ${errorMessage(error)}`,
			};
			addResourceError(
				report,
				local.errorsByIndex,
				target.entryIndexes,
				`Label "${target.name}" for team "${target.teamName}" could not be checked: ${errorMessage(error)}`,
			);
		}
	}

	await resolveAssignees(resolver, entriesByIndex, local, report);
	await resolveStates(resolver, entriesByIndex, local, report);
	await resolveExternalParents(resolver, local, report);

	const provisionTargets: LabelTarget[] = [];
	for (const target of labelTargets.values()) {
		if (!target.resolution) continue;
		if (target.resolution.status === "existing") {
			target.result = existingLabelResult(target, target.resolution.label);
			continue;
		}

		const resolution = target.resolution;
		if (options.createMissingLabels && resolution.provisionable) {
			provisionTargets.push(target);
			target.result = unresolvedLabelResult(target, resolution);
			continue;
		}
		if (options.allowMissingLabels && resolution.provisionable && target.name !== EPIC_LABEL) {
			target.result = {
				team: target.teamName,
				name: target.name,
				status: "skipped",
				detail: resolution.detail,
			};
			for (const index of target.entryIndexes) {
				const plan = local.plans.get(index);
				if (plan) plan.syncLabels = false;
			}
			report.warnings.push(
				`Team "${target.teamName}": label "${target.name}" will be skipped (${resolution.detail})`,
			);
			continue;
		}

		target.result = unresolvedLabelResult(target, resolution);
		addResourceError(
			report,
			local.errorsByIndex,
			target.entryIndexes,
			`Team "${target.teamName}": label "${target.name}" is unresolved (${resolution.detail})`,
		);
	}

	if (report.errors.length === 0) {
		await validateLabelGroups(resolver, entriesByIndex, local, report, labelTargets);
	}

	if (options.createMissingLabels && report.errors.length === 0) {
		for (const target of provisionTargets) {
			try {
				const label = await resolver.createTeamLabel(target.name, target.teamId);
				target.resolution = { status: "existing", label };
				target.result = {
					team: target.teamName,
					name: target.name,
					status: "created",
					scope: "team",
				};
			} catch (error) {
				addResourceError(
					report,
					local.errorsByIndex,
					target.entryIndexes,
					`Team "${target.teamName}": label "${target.name}" could not be created: ${errorMessage(error)}`,
				);
				break;
			}
		}
	}

	for (const target of labelTargets.values()) {
		if (target.result) report.labels.push(target.result);
		if (target.resolution?.status !== "existing") continue;
		for (const index of target.entryIndexes) {
			const plan = local.plans.get(index);
			if (plan) plan.labelIds.push(target.resolution.label.id);
		}
	}

	report.labels.sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
	report.passed = report.errors.length === 0;
	return { ...local, report };
}

async function resolveAssignees(
	resolver: Resolver,
	entries: Map<number, PreflightEntry>,
	local: LocalValidation,
	report: ImportPreflightReport,
): Promise<void> {
	const targets = new Map<string, Set<number>>();
	for (const [index, entry] of entries) {
		if (entry.story.assignee) addTarget(targets, entry.story.assignee, index);
	}
	for (const [assignee, indexes] of targets) {
		try {
			const assigneeId = await resolver.resolveAssigneeId(assignee);
			if (!assigneeId) {
				addResourceError(report, local.errorsByIndex, indexes, `Assignee not found: "${assignee}"`);
				continue;
			}
			for (const index of indexes) {
				const plan = local.plans.get(index);
				if (plan) plan.assigneeId = assigneeId;
			}
		} catch (error) {
			addResourceError(
				report,
				local.errorsByIndex,
				indexes,
				`Assignee "${assignee}" could not be resolved: ${errorMessage(error)}`,
			);
		}
	}
}

async function resolveStates(
	resolver: Resolver,
	entries: Map<number, PreflightEntry>,
	local: LocalValidation,
	report: ImportPreflightReport,
): Promise<void> {
	const targets = new Map<
		string,
		{ name: string; teamName: string; teamId: string; indexes: Set<number> }
	>();
	for (const [index, entry] of entries) {
		const plan = local.plans.get(index);
		if (!entry.story.status || !plan?.teamId) continue;
		const key = resourceKey(plan.teamId, entry.story.status.toLowerCase());
		const target = targets.get(key) ?? {
			name: entry.story.status,
			teamName: plan.teamName,
			teamId: plan.teamId,
			indexes: new Set<number>(),
		};
		target.indexes.add(index);
		targets.set(key, target);
	}
	for (const target of targets.values()) {
		try {
			const stateId = await resolver.resolveWorkflowStateId(target.name, target.teamId);
			if (!stateId) {
				addResourceError(
					report,
					local.errorsByIndex,
					target.indexes,
					`Workflow state "${target.name}" was not found for team "${target.teamName}"`,
				);
				continue;
			}
			for (const index of target.indexes) {
				const plan = local.plans.get(index);
				if (plan) plan.stateId = stateId;
			}
		} catch (error) {
			addResourceError(
				report,
				local.errorsByIndex,
				target.indexes,
				`Workflow state "${target.name}" for team "${target.teamName}" could not be resolved: ${errorMessage(error)}`,
			);
		}
	}
}

async function resolveExternalParents(
	resolver: Resolver,
	local: LocalValidation,
	report: ImportPreflightReport,
): Promise<void> {
	const targets = new Map<string, Set<number>>();
	for (const [index, plan] of local.plans) {
		if (plan.externalParentReference) addTarget(targets, plan.externalParentReference, index);
	}
	for (const [reference, indexes] of targets) {
		try {
			const epic = await resolver.resolveEpicIssue(reference);
			for (const index of indexes) {
				const plan = local.plans.get(index);
				if (plan) plan.externalParentId = epic.identifier;
			}
		} catch (error) {
			addResourceError(
				report,
				local.errorsByIndex,
				indexes,
				`Epic "${reference}" could not be resolved: ${errorMessage(error)}`,
			);
		}
	}
}

async function validateLabelGroups(
	resolver: Resolver,
	entries: Map<number, PreflightEntry>,
	local: LocalValidation,
	report: ImportPreflightReport,
	labelTargets: Map<string, LabelTarget>,
): Promise<void> {
	for (const [index, plan] of local.plans) {
		const seenGroups = new Map<string, string>();
		for (const name of plan.labelNames) {
			if (!plan.teamId) continue;
			const target = labelTargets.get(resourceKey(plan.teamId, name));
			if (target?.resolution?.status !== "existing") continue;
			const parentId = target.resolution.label.parentId;
			if (!parentId) continue;
			const existing = seenGroups.get(parentId);
			if (!existing) {
				seenGroups.set(parentId, name);
				continue;
			}
			const groupName = await resolver.resolveGroupName(parentId);
			const message = `Labels "${existing}" and "${name}" are both in group "${groupName}"`;
			addIndexError(local.errorsByIndex, index, message);
			addReportError(report, `${entries.get(index)?.story.title ?? `Issue ${index}`}: ${message}`);
		}
	}
}

function collectLabelTargets(plans: Map<number, StoryImportPlan>): Map<string, LabelTarget> {
	const targets = new Map<string, LabelTarget>();
	for (const [index, plan] of plans) {
		if (!plan.teamId) continue;
		for (const name of plan.labelNames) {
			const key = resourceKey(plan.teamId, name);
			const target = targets.get(key) ?? {
				teamName: plan.teamName,
				teamId: plan.teamId,
				name,
				entryIndexes: new Set<number>(),
			};
			target.entryIndexes.add(index);
			targets.set(key, target);
		}
	}
	return targets;
}

function existingLabelResult(target: LabelTarget, label: ResolvedLabel): LabelPreflightResult {
	return {
		team: target.teamName,
		name: target.name,
		status: "existing",
		scope: label.scope,
	};
}

function unresolvedLabelResult(
	target: LabelTarget,
	resolution: Exclude<LabelResolution, { status: "existing" }>,
): LabelPreflightResult {
	return {
		team: target.teamName,
		name: target.name,
		status: resolution.status === "missing" ? "missing" : "conflicting",
		detail: resolution.detail,
	};
}

function groupPlans(
	plans: Map<number, StoryImportPlan>,
	selector: (plan: StoryImportPlan) => string,
): Map<string, Set<number>> {
	const groups = new Map<string, Set<number>>();
	for (const [index, plan] of plans) addTarget(groups, selector(plan), index);
	return groups;
}

function addTarget(targets: Map<string, Set<number>>, key: string, index: number): void {
	const indexes = targets.get(key) ?? new Set<number>();
	indexes.add(index);
	targets.set(key, indexes);
}

function addResourceError(
	report: ImportPreflightReport,
	errorsByIndex: Map<number, string[]>,
	indexes: Iterable<number>,
	message: string,
): void {
	addReportError(report, message);
	for (const index of indexes) addIndexError(errorsByIndex, index, message);
}

function addReportError(report: ImportPreflightReport, message: string): void {
	if (!report.errors.includes(message)) report.errors.push(message);
}

function addIndexError(errors: Map<number, string[]>, index: number, message: string): void {
	const current = errors.get(index) ?? [];
	if (!current.includes(message)) current.push(message);
	errors.set(index, current);
}

function buildReferenceIndex(entries: PreflightEntry[]): Map<string, PreflightEntry[]> {
	const index = new Map<string, PreflightEntry[]>();
	for (const entry of entries) {
		for (const reference of [entry.story.title, entry.story.linearId]) {
			if (!reference) continue;
			const matches = index.get(reference) ?? [];
			if (!matches.includes(entry)) matches.push(entry);
			index.set(reference, matches);
		}
	}
	return index;
}

function deduplicateLabels(storyLabels: string[], defaultLabels: string[]): string[] {
	return [...new Set([...storyLabels, ...defaultLabels])];
}

function resourceKey(scope: string, name: string): string {
	return `${scope}\u0000${name}`;
}

function isLinearIssueReference(reference: string): boolean {
	return (
		/^[A-Z][A-Z0-9]*-\d+$/i.test(reference) ||
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference)
	);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
