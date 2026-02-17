import type { FileFrontmatter, UserStory } from "../types.ts";

/**
 * Serialize an array of UserStory objects back to markdown format.
 *
 * Produces markdown matching the import template format:
 * - Optional file-level YAML frontmatter (---...---)
 * - H2 headings for each story
 * - Optional fenced YAML blocks with metadata
 * - Story body content
 */
export function serializeStories(stories: UserStory[], frontmatter?: FileFrontmatter): string {
	const parts: string[] = [];

	// Emit file-level frontmatter if provided
	if (frontmatter && (frontmatter.project || frontmatter.team)) {
		parts.push("---");
		if (frontmatter.project) {
			parts.push(`project: "${frontmatter.project}"`);
		}
		if (frontmatter.team) {
			parts.push(`team: "${frontmatter.team}"`);
		}
		parts.push("---");
		parts.push("");
	}

	for (let i = 0; i < stories.length; i++) {
		const story = stories[i] as UserStory;

		// H2 heading
		parts.push(`## ${story.title}`);
		parts.push("");

		// Fenced YAML block (only if there is metadata to emit)
		const yamlLines = buildYamlLines(story);
		if (yamlLines.length > 0) {
			parts.push("```yaml");
			for (const line of yamlLines) {
				parts.push(line);
			}
			parts.push("```");
			parts.push("");
		}

		// Story body
		if (story.body.trim()) {
			parts.push(story.body);
			parts.push("");
		}
	}

	return parts.join("\n");
}

/**
 * Build YAML metadata lines for a story.
 * Only includes fields that have meaningful values.
 */
function buildYamlLines(story: UserStory): string[] {
	const lines: string[] = [];

	// linear_id and linear_url come first when present
	if (story.linearId !== null) {
		lines.push(`linear_id: ${story.linearId}`);
	}
	if (story.linearUrl !== null) {
		lines.push(`linear_url: ${story.linearUrl}`);
	}

	if (story.priority !== null) {
		lines.push(`priority: ${story.priority}`);
	}

	if (story.labels.length > 0) {
		lines.push(`labels: [${story.labels.join(", ")}]`);
	}

	if (story.estimate !== null) {
		lines.push(`estimate: ${story.estimate}`);
	}

	if (story.assignee !== null) {
		lines.push(`assignee: ${story.assignee}`);
	}

	if (story.status !== null) {
		lines.push(`status: ${story.status}`);
	}

	return lines;
}
