import { describe, expect, test } from "bun:test";
import {
	type CommandOptions,
	type CommandResult,
	parseArguments,
	ReleaseError,
	runRelease,
	validateVersion,
} from "../../../scripts/release-npm.ts";

const success = (stdout = ""): CommandResult => ({ exitCode: 0, stderr: "", stdout });
const missing = (stderr = ""): CommandResult => ({ exitCode: 2, stderr, stdout: "" });

function createRunner(options: { dirty?: boolean; npmPublished?: boolean; remoteTag?: boolean }) {
	const calls: string[][] = [];
	const interactiveCalls: string[][] = [];
	let npmChecks = 0;

	return {
		calls,
		interactiveCalls,
		run(command: string[], commandOptions?: CommandOptions): CommandResult {
			calls.push(command);
			if (commandOptions?.interactive) interactiveCalls.push(command);
			const key = command.join(" ");

			if (key === "git branch --show-current") return success("main\n");
			if (key === "git status --porcelain") {
				return success(options.dirty ? " M package.json\n" : "");
			}
			if (key === "git rev-parse HEAD" || key === "git rev-parse origin/main") {
				return success("abc123\n");
			}
			if (key.startsWith("git rev-parse -q --verify refs/tags/")) return missing();
			if (key.startsWith("git ls-remote --exit-code --tags origin")) {
				return options.remoteTag ? success("abc123\trefs/tags/v1.5.0\n") : missing();
			}
			if (key.startsWith("npm view linearstories@1.5.0 version")) {
				npmChecks += 1;
				if (options.npmPublished || npmChecks > 1) return success("1.5.0\n");
				return missing("npm error code E404");
			}

			return success();
		},
	};
}

function releaseOptions(run: ReturnType<typeof createRunner>["run"]) {
	return {
		confirmRelease: async () => true,
		dryRun: false,
		log: () => {},
		packageName: "linearstories",
		run,
		sleep: async () => {},
		version: "1.5.0",
		yes: true,
	};
}

describe("release argument parsing", () => {
	test("supports dry-run, confirmation bypass, and help", () => {
		expect(parseArguments(["--dry-run", "--yes"])).toEqual({
			dryRun: true,
			help: false,
			yes: true,
		});
		expect(parseArguments(["-h"]).help).toBe(true);
	});

	test("rejects unknown arguments and invalid versions", () => {
		expect(() => parseArguments(["--force"])).toThrow(ReleaseError);
		expect(() => validateVersion("release-1.5")).toThrow(ReleaseError);
		expect(() => validateVersion("1.5.0")).not.toThrow();
	});
});

describe("npm release workflow", () => {
	test("dry-run validates without publishing or tagging", async () => {
		const runner = createRunner({});
		const result = await runRelease({
			...releaseOptions(runner.run),
			dryRun: true,
		});
		const commands = runner.calls.map((command) => command.join(" "));

		expect(result).toBe("dry-run");
		expect(commands).toContain("bun test");
		expect(commands).toContain("npm pack --dry-run");
		expect(commands.some((command) => command.startsWith("npm publish"))).toBe(false);
		expect(commands.some((command) => command.startsWith("git tag"))).toBe(false);
	});

	test("publishes, verifies, tags, and pushes in order", async () => {
		const runner = createRunner({});
		const result = await runRelease(releaseOptions(runner.run));
		const commands = runner.calls.map((command) => command.join(" "));
		const publishIndex = commands.findIndex((command) => command.startsWith("npm publish"));
		const tagIndex = commands.findIndex((command) => command.startsWith("git tag -a"));
		const pushIndex = commands.findIndex((command) => command.startsWith("git push origin"));

		expect(result).toBe("complete");
		expect(publishIndex).toBeGreaterThan(-1);
		expect(tagIndex).toBeGreaterThan(publishIndex);
		expect(pushIndex).toBeGreaterThan(tagIndex);
		expect(runner.interactiveCalls.map((command) => command.join(" "))).toEqual([
			"npm publish --access public --registry=https://registry.npmjs.org/",
		]);
	});

	test("resumes by tagging when npm is already published", async () => {
		const runner = createRunner({ npmPublished: true });
		await runRelease(releaseOptions(runner.run));
		const commands = runner.calls.map((command) => command.join(" "));

		expect(commands.some((command) => command.startsWith("npm publish"))).toBe(false);
		expect(commands).toContain("git tag -a v1.5.0 -m Release 1.5.0");
		expect(commands).toContain("git push origin v1.5.0");
	});

	test("refuses dirty worktrees and remote tags without npm releases", async () => {
		const dirtyRunner = createRunner({ dirty: true });
		await expect(runRelease(releaseOptions(dirtyRunner.run))).rejects.toThrow(
			"working tree is not clean",
		);

		const taggedRunner = createRunner({ remoteTag: true });
		await expect(runRelease(releaseOptions(taggedRunner.run))).rejects.toThrow(
			"already exists on origin",
		);
	});

	test("cancellation prevents npm and git mutations", async () => {
		const runner = createRunner({});
		const result = await runRelease({
			...releaseOptions(runner.run),
			confirmRelease: async () => false,
			yes: false,
		});
		const commands = runner.calls.map((command) => command.join(" "));

		expect(result).toBe("cancelled");
		expect(commands.some((command) => command.startsWith("npm publish"))).toBe(false);
		expect(commands.some((command) => command.startsWith("git tag"))).toBe(false);
		expect(commands.some((command) => command.startsWith("git push"))).toBe(false);
	});
});
