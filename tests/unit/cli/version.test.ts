import { expect, test } from "bun:test";
import packageJson from "../../../package.json" with { type: "json" };

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
