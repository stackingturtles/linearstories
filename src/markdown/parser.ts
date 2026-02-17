import matter from "gray-matter";
import { ParseError } from "../errors.ts";
import type { FileFrontmatter, ParsedFile, UserStory } from "../types.ts";

/**
 * Parse a markdown file containing user stories into a structured ParsedFile.
 *
 * Format rules:
 * - File-level YAML frontmatter (---...---) contains project/team defaults
 * - H2 headings (## ) separate individual stories
 * - After each H2, an optional fenced YAML block (```yaml ... ```) contains per-story metadata
 * - Everything between the YAML block (or H2 if no YAML) and the next H2/EOF is the story body
 */
export function parseMarkdownFile(content: string, filePath: string): ParsedFile {
	// 1. Extract file-level frontmatter using gray-matter
	const { data: rawFrontmatter, content: bodyContent } = matter(content);

	const frontmatter: FileFrontmatter = {};
	if (rawFrontmatter.project) {
		frontmatter.project = String(rawFrontmatter.project);
	}
	if (rawFrontmatter.team) {
		frontmatter.team = String(rawFrontmatter.team);
	}

	// 2. Split at H2 boundaries
	// We split on lines that start with "## " and keep the delimiter
	const h2Regex = /^## /m;
	if (!h2Regex.test(bodyContent)) {
		throw new ParseError(
			`No H2 headings found in file: ${filePath}. Each user story must start with an H2 heading (## ).`,
		);
	}

	// Split the content into sections. The first element before the first H2 is preamble (ignored).
	const sections = bodyContent.split(/^(?=## )/m);

	const stories: UserStory[] = [];

	for (const section of sections) {
		const trimmed = section.trim();
		if (!trimmed.startsWith("## ")) {
			// Skip preamble content before first H2
			continue;
		}

		const story = parseStorySection(trimmed, frontmatter);
		stories.push(story);
	}

	return {
		frontmatter,
		stories,
		filePath,
	};
}

/**
 * Parse a single story section (starting with ## ) into a UserStory.
 */
function parseStorySection(section: string, frontmatter: FileFrontmatter): UserStory {
	const lines = section.split("\n");

	// Extract title from the first line (## Title)
	const titleLine = lines[0] as string;
	const title = titleLine.replace(/^## /, "").trim();

	// Look for fenced YAML block: ```yaml ... ```
	const restContent = lines.slice(1).join("\n");
	const yamlBlockRegex = /```yaml\n([\s\S]*?)```/;
	const yamlMatch = restContent.match(yamlBlockRegex);

	let metadata: Record<string, unknown> = {};
	let body: string;

	if (yamlMatch) {
		// Parse the YAML content using gray-matter's trick
		const yamlContent = yamlMatch[1] as string;
		const parsed = matter(`---\n${yamlContent}---\n`);
		metadata = parsed.data;

		// Body is everything after the closing ``` of the YAML block
		const yamlBlockEnd = restContent.indexOf(yamlMatch[0]) + yamlMatch[0].length;
		body = restContent.slice(yamlBlockEnd).trim();
	} else {
		// No YAML block - everything after the title is the body
		body = restContent.trim();
	}

	// Extract metadata fields with proper null handling
	const linearId = extractStringOrNull(metadata.linear_id);
	const linearUrl = extractStringOrNull(metadata.linear_url);
	const priority = extractNumberOrNull(metadata.priority);
	const labels = extractLabels(metadata.labels);
	const estimate = extractNumberOrNull(metadata.estimate);
	const assignee = extractStringOrNull(metadata.assignee);
	const status = extractStringOrNull(metadata.status);

	// Inherit project/team from frontmatter
	const project = frontmatter.project ?? null;
	const team = frontmatter.team ?? null;

	return {
		title,
		linearId,
		linearUrl,
		priority,
		labels,
		estimate,
		assignee,
		status,
		body,
		project,
		team,
	};
}

function extractStringOrNull(value: unknown): string | null {
	if (value === undefined || value === null || value === "") {
		return null;
	}
	return String(value);
}

function extractNumberOrNull(value: unknown): number | null {
	if (value === undefined || value === null || value === "") {
		return null;
	}
	const num = Number(value);
	if (Number.isNaN(num)) {
		return null;
	}
	return num;
}

function extractLabels(value: unknown): string[] {
	if (value === undefined || value === null) {
		return [];
	}
	if (Array.isArray(value)) {
		return value.map(String);
	}
	if (typeof value === "string" && value.trim() !== "") {
		// Handle comma-separated string
		return value.split(",").map((s) => s.trim());
	}
	return [];
}
