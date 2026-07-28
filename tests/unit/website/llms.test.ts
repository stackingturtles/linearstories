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
	expect(content).toContain("linearstories initctx");
	expect(content).toContain("linearstories updatectx <name>");
	expect(content).toContain("linearstories deletectx <name>");
	expect(content).toContain("linearstories contexts");
	expect(content).toContain("never includes the token itself");
	expect(content).toContain("--epics-only");
	expect(content).toContain("--label <name>");
	expect(content).toContain("without an unscoped query");
	expect(content).toContain("one GraphQL request per issue page");
	expect(content).toContain("exact `Epic` label and no parent issue");
	expect(content).toContain("at most three attempts");
});
