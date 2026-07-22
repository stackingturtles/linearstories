import { basename } from "node:path";
import { ParseError } from "../errors.ts";
import { EPIC_LABEL, isEpic } from "../hierarchy.ts";
import type { ParsedFile, UserStory } from "../types.ts";

export type GraphStatus = "completed" | "in-progress" | "not-started";

export interface CriterionGraphNode {
	id: string;
	text: string;
	completed: boolean;
}

interface IssueGraphNode {
	id: string;
	title: string;
	shortTitle: string;
	status: GraphStatus;
	labels: string[];
	priority: number | null;
	estimate: number | null;
	assignee: string | null;
	linearUrl: string | null;
}

export interface StoryGraphNode extends IssueGraphNode {
	type: "story";
	progress: {
		completedCriteria: number;
		totalCriteria: number;
	};
	criteria: CriterionGraphNode[];
}

export interface EpicGraphNode extends IssueGraphNode {
	type: "epic";
	progress: {
		completedStories: number;
		totalStories: number;
		completedCriteria: number;
		totalCriteria: number;
	};
	children: StoryGraphNode[];
}

export interface ProjectGraphNode {
	id: string;
	type: "project";
	title: string;
	shortTitle: string;
	team: string | null;
	status: GraphStatus;
	progress: {
		completedEpics: number;
		totalEpics: number;
		completedStories: number;
		totalStories: number;
		completedCriteria: number;
		totalCriteria: number;
	};
	children: Array<EpicGraphNode | StoryGraphNode>;
}

export interface ProjectGraph {
	schemaVersion: 1;
	generatedAt: string;
	source: string;
	project: ProjectGraphNode;
}

interface PreparedIssue {
	story: UserStory;
	id: string;
	type: "epic" | "story";
	criteria: CriterionGraphNode[];
	status: GraphStatus;
}

export interface BuildProjectGraphOptions {
	generatedAt?: Date;
}

export function buildProjectGraph(
	parsed: ParsedFile,
	options: BuildProjectGraphOptions = {},
): ProjectGraph {
	const prepared = prepareIssues(parsed.stories);
	const epics = prepared.filter((issue) => issue.type === "epic");
	const stories = prepared.filter((issue) => issue.type === "story");
	const epicReferences = indexEpicReferences(epics);
	const childrenByEpic = new Map(epics.map((epic) => [epic.id, [] as PreparedIssue[]]));
	const childrenByReferencedEpic = new Map<string, PreparedIssue[]>();
	const standaloneStories: PreparedIssue[] = [];

	for (const story of stories) {
		if (!story.story.epic) {
			standaloneStories.push(story);
			continue;
		}

		const matches = epicReferences.get(story.story.epic) ?? [];
		if (matches.length === 0) {
			if (isLinearIdentifier(story.story.epic)) {
				if (prepared.some((issue) => issue.id === story.story.epic)) {
					throw new ParseError(
						`User story "${story.story.title}" references "${story.story.epic}", but that issue is not an epic`,
					);
				}
				const children = childrenByReferencedEpic.get(story.story.epic) ?? [];
				children.push(story);
				childrenByReferencedEpic.set(story.story.epic, children);
				continue;
			}
			throw new ParseError(
				`User story "${story.story.title}" references unknown epic "${story.story.epic}"`,
			);
		}
		if (matches.length > 1) {
			throw new ParseError(
				`User story "${story.story.title}" has an ambiguous epic reference "${story.story.epic}"`,
			);
		}
		childrenByEpic.get(matches[0]!.id)?.push(story);
	}

	const epicNodes = new Map(
		epics.map((epic) => [epic.id, buildEpicNode(epic, childrenByEpic.get(epic.id) ?? [])]),
	);
	const standaloneNodes = new Map(
		standaloneStories.map((story) => [story.id, buildStoryNode(story)]),
	);
	const referencedEpicNodes = [...childrenByReferencedEpic].map(([id, epicStories]) =>
		buildReferencedEpicNode(id, epicStories),
	);
	const children: Array<EpicGraphNode | StoryGraphNode> = [
		...epicNodes.values(),
		...referencedEpicNodes,
		...standaloneNodes.values(),
	];

	const allStoryNodes: StoryGraphNode[] = [...standaloneNodes.values()];
	for (const epic of epicNodes.values()) allStoryNodes.push(...epic.children);
	for (const epic of referencedEpicNodes) allStoryNodes.push(...epic.children);
	const allEpicNodes = [...epicNodes.values(), ...referencedEpicNodes];
	const completedCriteria = sum(allStoryNodes.map((story) => story.progress.completedCriteria));
	const totalCriteria = sum(allStoryNodes.map((story) => story.progress.totalCriteria));
	const projectTitle = parsed.frontmatter.project ?? titleFromPath(parsed.filePath);

	return {
		schemaVersion: 1,
		generatedAt: (options.generatedAt ?? new Date()).toISOString(),
		source: basename(parsed.filePath),
		project: {
			id: `project-${slugify(projectTitle)}`,
			type: "project",
			title: projectTitle,
			shortTitle: projectTitle,
			team: parsed.frontmatter.team ?? null,
			status: deriveContainerStatus("not-started", children),
			progress: {
				completedEpics: allEpicNodes.filter((epic) => epic.status === "completed").length,
				totalEpics: allEpicNodes.length,
				completedStories: allStoryNodes.filter((story) => story.status === "completed").length,
				totalStories: allStoryNodes.length,
				completedCriteria,
				totalCriteria,
			},
			children,
		},
	};
}

function prepareIssues(stories: UserStory[]): PreparedIssue[] {
	const ids = new Set<string>();
	let localEpic = 0;
	let localStory = 0;

	return stories.map((story) => {
		const type = isEpic(story) ? "epic" : "story";
		if (type === "epic" && story.epic) {
			throw new ParseError(
				`Epic "${story.title}" cannot reference another epic; only two hierarchy levels are supported`,
			);
		}

		const localNumber = type === "epic" ? ++localEpic : ++localStory;
		const id = story.linearId ?? uniqueLocalId(`local-${type}-${localNumber}`, ids);
		if (ids.has(id)) {
			throw new ParseError(`Duplicate linear_id "${id}" cannot be visualized`);
		}
		ids.add(id);

		const criteria = type === "story" ? extractAcceptanceCriteria(story.body, id) : [];
		return {
			story,
			id,
			type,
			criteria,
			status: normalizeStatus(
				story.status,
				criteria.filter((criterion) => criterion.completed).length,
			),
		};
	});
}

function uniqueLocalId(base: string, ids: Set<string>): string {
	let candidate = base;
	let suffix = 2;
	while (ids.has(candidate)) candidate = `${base}-${suffix++}`;
	return candidate;
}

function indexEpicReferences(epics: PreparedIssue[]): Map<string, PreparedIssue[]> {
	const references = new Map<string, PreparedIssue[]>();
	for (const epic of epics) {
		for (const reference of new Set([epic.id, epic.story.title])) {
			const matches = references.get(reference) ?? [];
			matches.push(epic);
			references.set(reference, matches);
		}
	}
	return references;
}

function buildReferencedEpicNode(id: string, children: PreparedIssue[]): EpicGraphNode {
	const storyNodes = children.map(buildStoryNode);
	return {
		id,
		type: "epic",
		title: `Referenced epic ${id}`,
		shortTitle: `Referenced epic ${id}`,
		status: deriveContainerStatus("not-started", storyNodes),
		labels: [EPIC_LABEL],
		priority: null,
		estimate: null,
		assignee: null,
		linearUrl: null,
		progress: {
			completedStories: storyNodes.filter((story) => story.status === "completed").length,
			totalStories: storyNodes.length,
			completedCriteria: sum(storyNodes.map((story) => story.progress.completedCriteria)),
			totalCriteria: sum(storyNodes.map((story) => story.progress.totalCriteria)),
		},
		children: storyNodes,
	};
}

function buildStoryNode(issue: PreparedIssue): StoryGraphNode {
	const completedCriteria = issue.criteria.filter((criterion) => criterion.completed).length;
	return {
		...buildIssueFields(issue),
		type: "story",
		progress: {
			completedCriteria,
			totalCriteria: issue.criteria.length,
		},
		criteria: issue.criteria,
	};
}

function buildEpicNode(issue: PreparedIssue, children: PreparedIssue[]): EpicGraphNode {
	const storyNodes = children.map(buildStoryNode);
	return {
		...buildIssueFields(issue),
		type: "epic",
		status: deriveContainerStatus(issue.status, storyNodes),
		progress: {
			completedStories: storyNodes.filter((story) => story.status === "completed").length,
			totalStories: storyNodes.length,
			completedCriteria: sum(storyNodes.map((story) => story.progress.completedCriteria)),
			totalCriteria: sum(storyNodes.map((story) => story.progress.totalCriteria)),
		},
		children: storyNodes,
	};
}

function buildIssueFields(issue: PreparedIssue): IssueGraphNode {
	return {
		id: issue.id,
		title: plainText(issue.story.title),
		shortTitle: issue.type === "story" ? makeShortTitle(issue.story.title) : issue.story.title,
		status: issue.status,
		labels: issue.story.labels,
		priority: issue.story.priority,
		estimate: issue.story.estimate,
		assignee: issue.story.assignee,
		linearUrl: issue.story.linearUrl,
	};
}

function extractAcceptanceCriteria(body: string, issueId: string): CriterionGraphNode[] {
	const heading = /^### Acceptance Criteria\s*$/im.exec(body);
	if (!heading) return [];

	const remainder = body.slice(heading.index + heading[0].length);
	const nextHeading = remainder.search(/^#{1,3}\s+/m);
	const section = nextHeading === -1 ? remainder : remainder.slice(0, nextHeading);
	const criteria: CriterionGraphNode[] = [];

	for (const line of section.split("\n")) {
		const match = line.match(/^\s*- \[([ xX])\]\s+(.+)$/);
		if (!match) continue;
		criteria.push({
			id: `${issueId}-AC-${String(criteria.length + 1).padStart(2, "0")}`,
			text: plainText(match[2]!),
			completed: match[1]!.toLowerCase() === "x",
		});
	}

	return criteria;
}

function normalizeStatus(rawStatus: string | null, completedCriteria: number): GraphStatus {
	const normalized = rawStatus?.trim().toLowerCase();
	if (normalized === "done" || normalized === "completed") return "completed";
	if (normalized === "in progress" || normalized === "in-progress") return "in-progress";
	if (completedCriteria > 0) return "in-progress";
	return "not-started";
}

function isLinearIdentifier(value: string): boolean {
	return /^[A-Z][A-Z0-9]*-\d+$/.test(value);
}

function deriveContainerStatus(
	explicitStatus: GraphStatus,
	children: Array<{ status: GraphStatus }>,
): GraphStatus {
	if (explicitStatus === "completed") return "completed";
	if (children.length > 0 && children.every((child) => child.status === "completed")) {
		return "completed";
	}
	if (
		explicitStatus === "in-progress" ||
		children.some((child) => child.status !== "not-started")
	) {
		return "in-progress";
	}
	return "not-started";
}

function makeShortTitle(title: string): string {
	const userStory = title.match(/^As an? .+?, I want (.+?)(?: so that .+)?$/i);
	return plainText(userStory?.[1] ?? title)
		.replace(/^the\s+/i, "")
		.replace(/\.$/, "");
}

function plainText(value: string): string {
	return value
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/[~*_]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function titleFromPath(filePath: string): string {
	const fileName = basename(filePath)
		.replace(/\.linearstories\.md$/i, "")
		.replace(/\.md$/i, "");
	return fileName.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function slugify(value: string): string {
	return (
		value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "") || "stories"
	);
}

function sum(values: number[]): number {
	return values.reduce((total, value) => total + value, 0);
}
