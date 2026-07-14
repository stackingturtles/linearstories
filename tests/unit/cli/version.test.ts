import { expect, test } from "bun:test";
import packageJson from "../../../package.json" with { type: "json" };

test("CLI version matches package metadata", () => {
	const result = Bun.spawnSync(["bun", "run", "src/cli/index.ts", "--version"], {
		cwd: new URL("../../..", import.meta.url).pathname,
	});

	expect(result.exitCode).toBe(0);
	expect(result.stdout.toString().trim()).toBe(packageJson.version);
});
