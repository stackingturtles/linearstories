import { describe, expect, test } from "bun:test";

const root = new URL("../../..", import.meta.url);

describe("website project atlas showcase", () => {
	test("documents the visualization command with the supplied screenshot", async () => {
		const html = await Bun.file(new URL("website/index.html", root)).text();
		const screenshot = Bun.file(new URL("website/assets/project-atlas-screenshot.png", root));

		expect(html).toContain('id="project-atlas"');
		expect(html).toContain("linearstories visualize stories/project.md");
		expect(html).toContain('src="assets/project-atlas-screenshot.png"');
		expect(html).toContain('loading="lazy"');
		expect(html).toContain('alt="Project Atlas visualization');
		expect(await screenshot.exists()).toBe(true);
	});
});
