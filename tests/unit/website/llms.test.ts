import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("llms.txt documents the agent-safe CLI workflow", () => {
	const content = readFileSync(new URL("../../../website/llms.txt", import.meta.url), "utf8");

	expect(content).toContain("linearstories import --dry-run");
	expect(content).toContain("linearstories import --preflight");
	expect(content).toContain("linearstories import --create-missing-labels");
	expect(content).toContain("linearstories import --allow-missing-labels");
	expect(content).toContain("CLI `--team` or `--project`");
	expect(content).toContain("exact, case-sensitive label `Epic`");
	expect(content).toContain("linearstories visualize stories/project.md");
	expect(content).toContain("Project Atlas visualization");
	expect(content).toContain("lowercase `epic` remains a user-story category");
	expect(content).toContain("does not load configuration or require an API key");
	expect(content).toContain("--no-open");
});
