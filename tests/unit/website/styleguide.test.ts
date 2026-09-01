import { describe, expect, test } from "bun:test";

const styleguidePath = new URL("../../../website/styleguide.html", import.meta.url);
const html = await Bun.file(styleguidePath).text();

describe("website styleguide", () => {
	test("documents the LinearStories foundations and component families", () => {
		for (const section of [
			"colours",
			"typography",
			"spacing",
			"buttons",
			"forms",
			"cards",
			"badges",
			"feedback",
			"data",
			"code",
			"composition",
			"accessibility",
		]) {
			expect(html).toContain(`id="${section}"`);
		}
	});

	test("uses the canonical palette and typography", () => {
		expect(html).toContain("#0a0d12");
		expect(html).toContain("#0ea5e9");
		expect(html).toContain("Instrument+Serif");
		expect(html).toContain("DM+Sans");
		expect(html).toContain("JetBrains+Mono");
		expect(html).toContain('href="style.css"');
	});

	test("includes keyboard-labelled interactive examples", () => {
		expect(html).toContain('aria-controls="sidebar"');
		expect(html).toContain('aria-label="Copy Base colour hex value"');
		expect(html).toContain('role="tablist"');
		expect(html).toContain('aria-labelledby="dialogTitle"');
	});
});
