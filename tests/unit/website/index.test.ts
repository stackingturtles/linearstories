import { describe, expect, test } from "bun:test";

const root = new URL("../../..", import.meta.url);

describe("website project atlas showcase", () => {
	test("documents the visualization command with the supplied screenshot", async () => {
		const html = await Bun.file(new URL("website/index.html", root)).text();
		const screenshot = Bun.file(new URL("website/assets/project-atlas-screenshot.png", root));

		expect(html).toContain('id="project-atlas"');
		expect(html).toContain("Project Atlas: a local, interactive map");
		expect(html).toContain("linearstories visualize stories/project.md");
		expect(html).toContain("exact category-label filters");
		expect(html).toContain('src="assets/project-atlas-screenshot.png"');
		expect(html).toContain('loading="lazy"');
		expect(html).toContain('alt="Project Atlas visualization');
		expect(await screenshot.exists()).toBe(true);
	});

	test("presents agentic story review as the second workflow step", async () => {
		const html = await Bun.file(new URL("website/index.html", root)).text();

		expect(html).toContain("Review and improve");
		expect(html).toContain("/rate-userstories");
		expect(html).toContain("hard-fails contradictions across");
		expect(html).toContain("replacement Markdown for you to review");
	});

	test("consolidates features around the opinionated story workflow", async () => {
		const html = await Bun.file(new URL("website/index.html", root)).text();
		const featureCards = html.match(/class="feature-card(?: |")/g) ?? [];

		expect(featureCards).toHaveLength(5);
		expect(html).toContain("Epic → user story → acceptance criteria");
		expect(html).toContain("Linear sync");
		expect(html).toContain("Rate, review, improve");
		expect(html).not.toContain("<h3>Import to Linear</h3>");
		expect(html).not.toContain("<h3>Export from Linear</h3>");
		expect(html).not.toContain("<h3>Acceptance criteria first</h3>");
	});

	test("hands agent users the canonical llms.txt guide", async () => {
		const html = await Bun.file(new URL("website/index.html", root)).text();

		expect(html).toContain('id="agent-docs"');
		expect(html).toContain("Too busy to read all this?");
		expect(html).toContain("Have your agent do it for you.");
		expect(html).toContain('href="https://linearstories.com/llms.txt"');
		expect(html).toContain('aria-label="Copy agent documentation URL"');
	});
});
