import type { UserStory } from "./types.ts";

export const EPIC_LABEL = "Epic";

export function isEpic(story: UserStory): boolean {
	return story.labels.includes(EPIC_LABEL);
}

export function validateIssueType(story: UserStory): string | null {
	if (isEpic(story)) {
		if (story.epic) {
			return `Epic "${story.title}" cannot reference another epic; only two hierarchy levels are supported`;
		}
		if (hasAcceptanceCriteriaSection(story.body)) {
			return `Epic "${story.title}" must not contain an Acceptance Criteria section`;
		}
		return null;
	}

	if (!hasAcceptanceCriteriaChecklist(story.body)) {
		return `User story "${story.title}" must contain an ### Acceptance Criteria section with at least one checkbox item`;
	}

	return null;
}

function hasAcceptanceCriteriaSection(body: string): boolean {
	return /^### Acceptance Criteria\s*$/im.test(body);
}

function hasAcceptanceCriteriaChecklist(body: string): boolean {
	const heading = /^### Acceptance Criteria\s*$/im.exec(body);
	if (!heading) {
		return false;
	}

	const sectionStart = heading.index + heading[0].length;
	const remainder = body.slice(sectionStart);
	const nextHeading = remainder.search(/^#{1,3}\s+/m);
	const section = nextHeading === -1 ? remainder : remainder.slice(0, nextHeading);
	return /^\s*- \[[ xX]\]\s+\S/m.test(section);
}
