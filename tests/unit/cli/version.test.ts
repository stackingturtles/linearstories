import { expect, test } from "bun:test";
import packageJson from "../../../package.json" with { type: "json" };
import { buildExportFilters } from "../../../src/cli/commands/export.ts";
import { formatVisualizationSummary } from "../../../src/cli/commands/visualize.ts";
import type { ProjectGraph } from "../../../src/visualization/graph.ts";

test("CLI version matches package metadata", () => {
	const result = Bun.spawnSync(["bun", "run", "src/cli/index.ts", "--version"], {
		cwd: new URL("../../..", import.meta.url).pathname,
	});

	expect(result.exitCode).toBe(0);
	expect(result.stdout.toString().trim()).toBe(packageJson.version);
});

test("import help exposes local, remote, and label provisioning modes", () => {
	const result = Bun.spawnSync(["bun", "run", "src/cli/index.ts", "import", "--help"], {
		cwd: new URL("../../..", import.meta.url).pathname,
	});
	const output = result.stdout.toString();

	expect(result.exitCode).toBe(0);
	expect(output).toContain("--dry-run");
	expect(output).toContain("--preflight");
	expect(output).toContain("--create-missing-labels");
	expect(output).toContain("--allow-missing-labels");
	expect(output).toContain("Override file and config team");
});

test("visualize help exposes the local server options", () => {
	const result = Bun.spawnSync(["bun", "run", "src/cli/index.ts", "visualize", "--help"], {
		cwd: new URL("../../..", import.meta.url).pathname,
		env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}` },
	});
	const output = result.stdout.toString();

	expect(result.exitCode).toBe(0);
	expect(output).toContain("<file>");
	expect(output).toContain("--port <port>");
	expect(output).toContain("--no-open");
});

test("export help exposes label and epic-only filters", () => {
	const result = Bun.spawnSync(["bun", "run", "src/cli/index.ts", "export", "--help"], {
		cwd: new URL("../../..", import.meta.url).pathname,
	});
	const output = result.stdout.toString();

	expect(result.exitCode).toBe(0);
	expect(output).toContain("--label <name>");
	expect(output).toContain("--epics-only");
});

test("epics-only maps to the exact Epic label and conflicts with label", () => {
	expect(buildExportFilters({ epicsOnly: true })).toEqual({
		label: "Epic",
		topLevelOnly: true,
	});
	expect(() => buildExportFilters({ epicsOnly: true, label: "Feature" })).toThrow(
		"--label and --epics-only cannot be used together",
	);
});

test("CLI help exposes context setup and listing commands", () => {
	const result = Bun.spawnSync(["bun", "run", "src/cli/index.ts", "--help"], {
		cwd: new URL("../../..", import.meta.url).pathname,
		env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}` },
	});
	const output = result.stdout.toString();

	expect(result.exitCode).toBe(0);
	expect(output).toContain("initctx");
	expect(output).toContain("updatectx [options] <name>");
	expect(output).toContain("deletectx [options] <name>");
	expect(output).toContain("contexts|ctx");
});

test("visualize summary pluralizes issue counts", () => {
	const graph = {
		project: { progress: { totalEpics: 1, totalStories: 2 } },
	} as ProjectGraph;

	expect(formatVisualizationSummary(graph, "http://127.0.0.1:4173")).toBe(
		"Visualizing 1 epic and 2 user stories at http://127.0.0.1:4173",
	);
});
