#!/usr/bin/env bun

import { resolve } from "node:path";
import { confirm, isCancel } from "@clack/prompts";

const NPM_REGISTRY = "https://registry.npmjs.org/";
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export interface CommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export interface CommandOptions {
	interactive?: boolean;
	silent?: boolean;
}

export type CommandRunner = (command: string[], options?: CommandOptions) => CommandResult;

export interface ReleaseOptions {
	confirmRelease: (message: string) => Promise<boolean>;
	dryRun: boolean;
	log: (message: string) => void;
	packageName: string;
	run: CommandRunner;
	sleep: (milliseconds: number) => Promise<void>;
	version: string;
	yes: boolean;
}

export interface ParsedArguments {
	dryRun: boolean;
	help: boolean;
	yes: boolean;
}

export class ReleaseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ReleaseError";
	}
}

export function parseArguments(args: string[]): ParsedArguments {
	const parsed: ParsedArguments = { dryRun: false, help: false, yes: false };

	for (const argument of args) {
		switch (argument) {
			case "--dry-run":
				parsed.dryRun = true;
				break;
			case "--yes":
				parsed.yes = true;
				break;
			case "--help":
			case "-h":
				parsed.help = true;
				break;
			default:
				throw new ReleaseError(`Unknown argument: ${argument}`);
		}
	}

	return parsed;
}

export function validateVersion(version: string): void {
	if (!VERSION_PATTERN.test(version)) {
		throw new ReleaseError(`package.json contains an invalid release version: ${version}`);
	}
}

function requireSuccess(command: string[], result: CommandResult): CommandResult {
	if (result.exitCode !== 0) {
		const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
		throw new ReleaseError(`Command failed: ${formatCommand(command)}\n${detail}`);
	}

	return result;
}

function runRequired(
	run: CommandRunner,
	command: string[],
	options?: CommandOptions,
): CommandResult {
	return requireSuccess(command, run(command, options));
}

function formatCommand(command: string[]): string {
	return command
		.map((argument) =>
			/^[A-Za-z0-9_./:@=-]+$/.test(argument) ? argument : JSON.stringify(argument),
		)
		.join(" ");
}

function isMissingNpmVersion(result: CommandResult): boolean {
	return (
		result.exitCode !== 0 && /(?:E404|404 Not Found)/i.test(`${result.stderr}\n${result.stdout}`)
	);
}

function npmVersionIsPublished(result: CommandResult, version: string): boolean {
	if (result.exitCode === 0) {
		if (result.stdout.trim() !== version) {
			throw new ReleaseError(
				`npm returned an unexpected version for this release: ${result.stdout.trim() || "(empty)"}`,
			);
		}
		return true;
	}

	if (isMissingNpmVersion(result)) {
		return false;
	}

	const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
	throw new ReleaseError(`Unable to check npm release state:\n${detail}`);
}

function npmViewCommand(packageName: string, version: string): string[] {
	return ["npm", "view", `${packageName}@${version}`, "version", `--registry=${NPM_REGISTRY}`];
}

async function verifyPublishedVersion(
	run: CommandRunner,
	sleep: ReleaseOptions["sleep"],
	packageName: string,
	version: string,
): Promise<void> {
	const command = npmViewCommand(packageName, version);

	for (let attempt = 1; attempt <= 5; attempt += 1) {
		const result = run(command, { silent: true });
		if (result.exitCode === 0 && result.stdout.trim() === version) {
			return;
		}
		if (!isMissingNpmVersion(result)) {
			requireSuccess(command, result);
		}
		if (attempt < 5) {
			await sleep(2_000);
		}
	}

	throw new ReleaseError(
		`${packageName}@${version} was published but could not be verified on ${NPM_REGISTRY}`,
	);
}

export async function runRelease(
	options: ReleaseOptions,
): Promise<"cancelled" | "complete" | "dry-run"> {
	const { confirmRelease, dryRun, log, packageName, run, sleep, version, yes } = options;
	const tag = `v${version}`;

	validateVersion(version);
	log(`Preparing ${packageName}@${version}`);

	const branchCommand = ["git", "branch", "--show-current"];
	const branch = runRequired(run, branchCommand, { silent: true }).stdout.trim();
	if (branch !== "main") {
		throw new ReleaseError(
			`Releases must run from main; current branch is ${branch || "(detached)"}`,
		);
	}

	const statusCommand = ["git", "status", "--porcelain"];
	const status = runRequired(run, statusCommand, { silent: true }).stdout.trim();
	if (status) {
		throw new ReleaseError(
			"The working tree is not clean. Commit or stash changes before releasing.",
		);
	}

	runRequired(run, ["git", "fetch", "--quiet", "origin", "main"]);
	const head = runRequired(run, ["git", "rev-parse", "HEAD"], { silent: true }).stdout.trim();
	const originMain = runRequired(run, ["git", "rev-parse", "origin/main"], {
		silent: true,
	}).stdout.trim();
	if (head !== originMain) {
		throw new ReleaseError(
			"main is not synchronized with origin/main. Pull or push the outstanding commits first.",
		);
	}

	const localTagResult = run(["git", "rev-parse", "-q", "--verify", `refs/tags/${tag}`], {
		silent: true,
	});
	const localTagExists = localTagResult.exitCode === 0;
	if (localTagExists) {
		const tagCommit = runRequired(run, ["git", "rev-list", "-n", "1", tag], {
			silent: true,
		}).stdout.trim();
		if (tagCommit !== head) {
			throw new ReleaseError(`${tag} already exists on a different commit`);
		}
	}

	const remoteTagResult = run(
		["git", "ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`],
		{ silent: true },
	);
	const remoteTagExists = remoteTagResult.exitCode === 0;
	if (remoteTagResult.exitCode !== 0 && remoteTagResult.exitCode !== 2) {
		requireSuccess(
			["git", "ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`],
			remoteTagResult,
		);
	}

	const npmStateCommand = npmViewCommand(packageName, version);
	const npmPublished = npmVersionIsPublished(run(npmStateCommand, { silent: true }), version);

	if (remoteTagExists && !npmPublished) {
		throw new ReleaseError(
			`${tag} already exists on origin, but ${packageName}@${version} is not published`,
		);
	}

	if (remoteTagExists && npmPublished) {
		log(`${packageName}@${version} and ${tag} are already published.`);
		return "complete";
	}

	runRequired(run, ["bun", "install", "--frozen-lockfile"]);
	runRequired(run, ["bun", "test"]);
	runRequired(run, ["bun", "run", "lint"]);

	if (!npmPublished) {
		runRequired(run, ["npm", "whoami", `--registry=${NPM_REGISTRY}`]);
		runRequired(run, ["npm", "pack", "--dry-run"]);
	} else {
		log(`${packageName}@${version} is already on npm; only ${tag} remains.`);
	}

	if (dryRun) {
		log(
			npmPublished
				? `Dry run complete. A real run would push ${tag}.`
				: `Dry run complete. A real run would publish ${packageName}@${version} and push ${tag}.`,
		);
		return "dry-run";
	}

	if (!yes) {
		const confirmed = await confirmRelease(
			npmPublished
				? `Push ${tag} to origin and trigger the GitHub release?`
				: `Publish ${packageName}@${version} to npm and push ${tag} to origin?`,
		);
		if (!confirmed) {
			log("Release cancelled.");
			return "cancelled";
		}
	}

	if (!npmPublished) {
		runRequired(run, ["npm", "publish", "--access", "public", `--registry=${NPM_REGISTRY}`], {
			interactive: true,
		});
		await verifyPublishedVersion(run, sleep, packageName, version);
	}

	if (!localTagExists) {
		runRequired(run, ["git", "tag", "-a", tag, "-m", `Release ${version}`]);
	}
	runRequired(run, ["git", "push", "origin", tag]);

	log(`Released ${packageName}@${version} and pushed ${tag}.`);
	return "complete";
}

export function createCommandRunner(rootDir: string): CommandRunner {
	return (command, options = {}) => {
		console.log(`$ ${formatCommand(command)}`);
		const result = Bun.spawnSync(command, {
			cwd: rootDir,
			env: process.env,
			stderr: options.interactive ? "inherit" : "pipe",
			stdin: "inherit",
			stdout: options.interactive ? "inherit" : "pipe",
		});
		const commandResult = {
			exitCode: result.exitCode,
			stderr: result.stderr?.toString() ?? "",
			stdout: result.stdout?.toString() ?? "",
		};

		if (!options.interactive && (!options.silent || result.exitCode !== 0)) {
			process.stdout.write(commandResult.stdout);
			process.stderr.write(commandResult.stderr);
		}

		return commandResult;
	};
}

function printHelp(): void {
	console.log(`Usage: bun run release:npm [options]

Publish the package.json version to npm, then tag the same commit for the GitHub release.

Options:
  --dry-run  Run every validation without publishing or tagging
  --yes      Skip the final confirmation prompt
  -h, --help Show this help`);
}

async function main(): Promise<void> {
	const rootDir = resolve(import.meta.dir, "..");
	const args = parseArguments(process.argv.slice(2));
	if (args.help) {
		printHelp();
		return;
	}

	const packageJson = await Bun.file(resolve(rootDir, "package.json")).json();
	const packageName = typeof packageJson.name === "string" ? packageJson.name : "";
	const version = typeof packageJson.version === "string" ? packageJson.version : "";
	if (!packageName || !version) {
		throw new ReleaseError("package.json must contain name and version");
	}

	await runRelease({
		confirmRelease: async (message) => {
			const answer = await confirm({ message });
			return !isCancel(answer) && answer;
		},
		dryRun: args.dryRun,
		log: console.log,
		packageName,
		run: createCommandRunner(rootDir),
		sleep: Bun.sleep,
		version,
		yes: args.yes,
	});
}

if (import.meta.main) {
	main().catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Release failed: ${message}`);
		process.exitCode = 1;
	});
}
