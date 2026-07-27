import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatContexts } from "../../../src/cli/commands/contexts.ts";
import {
	type InitContextPrompts,
	parseDefaultLabels,
	runDeleteContext,
	runInitContext,
	runUpdateContext,
} from "../../../src/cli/commands/init-context.ts";
import type { MultiContextConfig } from "../../../src/types.ts";

const ROOT = new URL("../../..", import.meta.url).pathname;
const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("initctx", () => {
	test("creates a secure user config from prompted values", async () => {
		const directory = createTempDirectory();
		const configPath = join(directory, "nested", "config.json");
		const prompt = new ScriptedPrompts({
			text: ["work", "Engineering", "Q1 Release", "User Story, Feature, User Story"],
			password: ["lin_api_super_secret"],
		});

		const result = await runInitContext({ configPath }, prompt);
		const config = readJsonConfig(configPath);

		expect(result?.context).toEqual({
			name: "work",
			apiKey: "lin_api_super_secret",
			defaultTeam: "Engineering",
			defaultProject: "Q1 Release",
			defaultLabels: ["User Story", "Feature"],
		});
		expect(config.contexts).toEqual([result?.context]);
		expect(statSync(configPath).mode & 0o777).toBe(0o600);
		expect(prompt.outroMessages[0]).toContain("linearstories import <files...>");
		expect(prompt.outroMessages[0]).not.toContain("lin_api_super_secret");
	});

	test("migrates a legacy flat config to default before adding a context", async () => {
		const directory = createTempDirectory();
		const configPath = join(directory, "config.json");
		writeFileSync(configPath, JSON.stringify({ apiKey: "lin_api_legacy", defaultTeam: "Legacy" }));
		const prompt = new ScriptedPrompts({
			text: ["work", "Engineering", "", "Feature"],
			password: ["lin_api_work"],
		});

		await runInitContext({ configPath }, prompt);
		const config = readJsonConfig(configPath);

		expect(config.contexts.map((context) => context.name)).toEqual(["default", "work"]);
		expect(config.contexts[0]?.apiKey).toBe("lin_api_legacy");
		expect(prompt.outroMessages[0]).toContain("--context work");
	});

	test("updates an existing context while retaining a blank masked token", async () => {
		const directory = createTempDirectory();
		const configPath = join(directory, "config.json");
		writeFileSync(
			configPath,
			JSON.stringify({
				contexts: [
					{
						name: "work",
						apiKey: "lin_api_existing",
						defaultTeam: "Engineering",
					},
				],
			}),
		);
		const prompt = new ScriptedPrompts({
			text: ["work", "Platform", "Roadmap", "Feature"],
			password: [""],
			confirm: [true],
		});

		await runInitContext({ configPath }, prompt);
		const [context] = readJsonConfig(configPath).contexts;

		expect(context).toEqual({
			name: "work",
			apiKey: "lin_api_existing",
			defaultTeam: "Platform",
			defaultProject: "Roadmap",
			defaultLabels: ["Feature"],
		});
	});

	test("does not modify an existing context when replacement is declined", async () => {
		const directory = createTempDirectory();
		const configPath = join(directory, "config.json");
		const original = JSON.stringify({ contexts: [{ name: "work", apiKey: "secret" }] });
		writeFileSync(configPath, original);
		const prompt = new ScriptedPrompts({ text: ["work"], confirm: [false] });

		expect(await runInitContext({ configPath }, prompt)).toBeNull();
		expect(readFileSync(configPath, "utf8")).toBe(original);
		expect(prompt.cancelMessages).toEqual(["No changes made."]);
	});

	test("normalizes and deduplicates comma-separated labels", () => {
		expect(parseDefaultLabels(" Feature,Auth, Feature, ,Platform ")).toEqual([
			"Feature",
			"Auth",
			"Platform",
		]);
	});

	test("rejects Epic as a default label", async () => {
		const directory = createTempDirectory();
		const configPath = join(directory, "config.json");
		const prompt = new ScriptedPrompts({
			text: ["work", "Engineering", "", "Epic, Feature"],
			password: ["lin_api_secret"],
		});

		expect(runInitContext({ configPath }, prompt)).rejects.toThrow(
			'"Epic" identifies epic issues and cannot be a default label.',
		);
		expect(existsSync(configPath)).toBe(false);
	});
});

describe("updatectx", () => {
	test("updates the named context and leaves other contexts unchanged", async () => {
		const directory = createTempDirectory();
		const configPath = join(directory, "config.json");
		writeFileSync(
			configPath,
			JSON.stringify({
				contexts: [
					{
						name: "work",
						apiKey: "lin_api_existing",
						defaultTeam: "Engineering",
					},
					{ name: "personal", apiKey: "lin_api_personal" },
				],
			}),
		);
		const prompt = new ScriptedPrompts({
			text: ["Platform", "Roadmap", "Feature"],
			password: [""],
		});

		const result = await runUpdateContext("work", { configPath }, prompt);
		const config = readJsonConfig(configPath);

		expect(result?.context).toEqual({
			name: "work",
			apiKey: "lin_api_existing",
			defaultTeam: "Platform",
			defaultProject: "Roadmap",
			defaultLabels: ["Feature"],
		});
		expect(config.contexts[1]).toEqual({ name: "personal", apiKey: "lin_api_personal" });
		expect(prompt.confirmAnswersRemaining).toBe(0);
		expect(prompt.outroMessages[0]).toContain("--context work");
	});

	test("fails without writing when the named context does not exist", async () => {
		const directory = createTempDirectory();
		const configPath = join(directory, "config.json");
		const original = JSON.stringify({
			contexts: [{ name: "personal", apiKey: "lin_api_personal" }],
		});
		writeFileSync(configPath, original);

		expect(runUpdateContext("work", { configPath }, new ScriptedPrompts({}))).rejects.toThrow(
			'Context "work" not found. Available contexts: personal',
		);
		expect(readFileSync(configPath, "utf8")).toBe(original);
	});
});

describe("deletectx", () => {
	test("deletes the named context and securely preserves the remaining config", async () => {
		const directory = createTempDirectory();
		const configPath = join(directory, "config.json");
		writeFileSync(
			configPath,
			JSON.stringify({
				contexts: [
					{ name: "work", apiKey: "lin_api_work" },
					{ name: "personal", apiKey: "lin_api_personal" },
				],
			}),
		);
		const prompt = new ScriptedPrompts({ confirm: [true] });

		const result = await runDeleteContext("work", { configPath }, prompt);

		expect(result).toEqual({ configPath, name: "work", deletedConfigFile: false });
		expect(readJsonConfig(configPath).contexts).toEqual([
			{ name: "personal", apiKey: "lin_api_personal" },
		]);
		expect(statSync(configPath).mode & 0o777).toBe(0o600);
		expect(prompt.outroMessages[0]).toContain('Deleted "work"');
	});

	test("removes the config file when deleting its final context", async () => {
		const directory = createTempDirectory();
		const configPath = join(directory, "config.json");
		writeFileSync(
			configPath,
			JSON.stringify({ contexts: [{ name: "work", apiKey: "lin_api_work" }] }),
		);

		const result = await runDeleteContext(
			"work",
			{ configPath },
			new ScriptedPrompts({ confirm: [true] }),
		);

		expect(result?.deletedConfigFile).toBe(true);
		expect(existsSync(configPath)).toBe(false);
	});

	test("does not modify the config when deletion is declined", async () => {
		const directory = createTempDirectory();
		const configPath = join(directory, "config.json");
		const original = JSON.stringify({ contexts: [{ name: "work", apiKey: "secret" }] });
		writeFileSync(configPath, original);
		const prompt = new ScriptedPrompts({ confirm: [false] });

		expect(await runDeleteContext("work", { configPath }, prompt)).toBeNull();
		expect(readFileSync(configPath, "utf8")).toBe(original);
		expect(prompt.cancelMessages).toEqual(["No changes made."]);
	});

	test("fails without writing when the named context does not exist", async () => {
		const directory = createTempDirectory();
		const configPath = join(directory, "config.json");
		const original = JSON.stringify({ contexts: [{ name: "personal" }] });
		writeFileSync(configPath, original);

		expect(runDeleteContext("work", { configPath }, new ScriptedPrompts({}))).rejects.toThrow(
			'Context "work" not found. Available contexts: personal',
		);
		expect(readFileSync(configPath, "utf8")).toBe(original);
	});
});

describe("contexts", () => {
	test("formats all context fields without exposing stored tokens", () => {
		const output = formatContexts(
			{
				contexts: [
					{
						name: "work",
						apiKey: "lin_api_never_print_this",
						defaultTeam: "Engineering",
						defaultProject: "Roadmap",
						defaultLabels: ["Feature", "Platform"],
					},
					{ name: "personal" },
				],
			},
			"/tmp/config.json",
		);

		expect(output).toContain("LinearStories contexts");
		expect(output).toContain("work");
		expect(output).toContain("Engineering");
		expect(output).toContain("Feature, Platform");
		expect(output).toContain("configured (hidden)");
		expect(output).toContain("personal");
		expect(output).not.toContain("lin_api_never_print_this");
	});

	test("supports both contexts and ctx command names", () => {
		const directory = createTempDirectory();
		const configPath = join(directory, "config.json");
		writeFileSync(
			configPath,
			JSON.stringify({ contexts: [{ name: "work", apiKey: "lin_api_hidden" }] }),
		);

		for (const command of ["contexts", "ctx"]) {
			const result = Bun.spawnSync(
				["bun", "run", "src/cli/index.ts", command, "--config", configPath],
				{ cwd: ROOT, env: withBunPath() },
			);
			const output = result.stdout.toString();

			expect(result.exitCode).toBe(0);
			expect(output).toContain("work");
			expect(output).toContain("configured (hidden)");
			expect(output).not.toContain("lin_api_hidden");
		}
	});
});

type TextPromptOptions = Parameters<InitContextPrompts["text"]>[0];
type PasswordPromptOptions = Parameters<InitContextPrompts["password"]>[0];

class ScriptedPrompts implements InitContextPrompts {
	private readonly textAnswers: Array<string | symbol>;
	private readonly passwordAnswers: Array<string | symbol>;
	private readonly confirmAnswers: Array<boolean | symbol>;
	readonly cancelMessages: string[] = [];
	readonly outroMessages: string[] = [];
	get confirmAnswersRemaining(): number {
		return this.confirmAnswers.length;
	}

	constructor(answers: {
		text?: Array<string | symbol>;
		password?: Array<string | symbol>;
		confirm?: Array<boolean | symbol>;
	}) {
		this.textAnswers = [...(answers.text ?? [])];
		this.passwordAnswers = [...(answers.password ?? [])];
		this.confirmAnswers = [...(answers.confirm ?? [])];
	}

	intro(): void {}

	async text(options: TextPromptOptions): Promise<string | symbol> {
		const answer = this.take(this.textAnswers, options.message);
		this.validate(answer, options.validate);
		return answer;
	}

	async password(options: PasswordPromptOptions): Promise<string | symbol> {
		const answer = this.take(this.passwordAnswers, options.message);
		this.validate(answer, options.validate);
		return answer;
	}

	async confirm(): Promise<boolean | symbol> {
		return this.take(this.confirmAnswers, "confirmation");
	}

	isCancel(value: unknown): value is symbol {
		return typeof value === "symbol";
	}

	cancel(message: string): void {
		this.cancelMessages.push(message);
	}

	outro(message: string): void {
		this.outroMessages.push(message);
	}

	private take<T>(answers: T[], prompt: string): T {
		const answer = answers.shift();
		if (answer === undefined) throw new Error(`No scripted answer for ${prompt}`);
		return answer;
	}

	private validate(
		answer: string | symbol,
		validator?: (value: string | undefined) => string | undefined,
	): void {
		if (typeof answer !== "string" || !validator) return;
		const error = validator(answer);
		if (error) throw new Error(error);
	}
}

function createTempDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "linearstories-contexts-"));
	temporaryDirectories.push(directory);
	return directory;
}

function readJsonConfig(filePath: string): MultiContextConfig {
	return JSON.parse(readFileSync(filePath, "utf8")) as MultiContextConfig;
}

function withBunPath(): Record<string, string> {
	return {
		...process.env,
		PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`,
	} as Record<string, string>;
}
