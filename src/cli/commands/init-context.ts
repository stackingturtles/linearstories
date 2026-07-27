import { resolve } from "node:path";
import * as prompts from "@clack/prompts";
import chalk from "chalk";
import type { Command } from "commander";
import {
	deleteContextConfig,
	readContextConfig,
	removeContext,
	upsertContext,
	writeContextConfig,
} from "../../config/contexts.ts";
import { getUserConfigPath, resolveConfigPath } from "../../config/loader.ts";
import { ConfigError } from "../../errors.ts";
import type { ContextEntry } from "../../types.ts";

interface TextOptions {
	message: string;
	placeholder?: string;
	initialValue?: string;
	validate?: (value: string | undefined) => string | undefined;
}

interface PasswordOptions {
	message: string;
	validate?: (value: string | undefined) => string | undefined;
}

export interface InitContextPrompts {
	intro(message: string): void;
	text(options: TextOptions): Promise<string | symbol>;
	password(options: PasswordOptions): Promise<string | symbol>;
	confirm(options: { message: string; initialValue?: boolean }): Promise<boolean | symbol>;
	isCancel(value: unknown): value is symbol;
	cancel(message: string): void;
	outro(message: string): void;
}

export interface InitContextOptions {
	configPath?: string;
	cwd?: string;
}

export interface InitContextResult {
	configPath: string;
	context: ContextEntry;
}

export interface DeleteContextResult {
	configPath: string;
	name: string;
	deletedConfigFile: boolean;
}

const interactivePrompts: InitContextPrompts = {
	intro: prompts.intro,
	text: prompts.text,
	password: prompts.password,
	confirm: prompts.confirm,
	isCancel: prompts.isCancel,
	cancel: prompts.cancel,
	outro: prompts.outro,
};

export function registerInitContextCommand(program: Command): void {
	program
		.command("initctx")
		.description("Interactively create or update a LinearStories context")
		.option("-c, --config <path>", "Config file path")
		.action(async (options: { config?: string }) => {
			try {
				await runInitContext({ configPath: options.config });
			} catch (error) {
				handleCommandError(error);
			}
		});
}

export function registerUpdateContextCommand(program: Command): void {
	program
		.command("updatectx")
		.description("Interactively update an existing LinearStories context")
		.argument("<name>", "Context name")
		.option("-c, --config <path>", "Config file path")
		.action(async (name: string, options: { config?: string }) => {
			try {
				await runUpdateContext(name, { configPath: options.config });
			} catch (error) {
				handleCommandError(error);
			}
		});
}

export function registerDeleteContextCommand(program: Command): void {
	program
		.command("deletectx")
		.description("Interactively delete an existing LinearStories context")
		.argument("<name>", "Context name")
		.option("-c, --config <path>", "Config file path")
		.action(async (name: string, options: { config?: string }) => {
			try {
				await runDeleteContext(name, { configPath: options.config });
			} catch (error) {
				handleCommandError(error);
			}
		});
}

export async function runInitContext(
	options: InitContextOptions = {},
	prompt: InitContextPrompts = interactivePrompts,
): Promise<InitContextResult | null> {
	const configPath = resolveContextConfigPath(options);
	const config = await readContextConfig(configPath);

	prompt.intro("Set up a LinearStories context");

	const nameAnswer = await prompt.text({
		message: "Context name",
		placeholder: "work",
		validate: (value) => (value?.trim() ? undefined : "Enter a context name."),
	});
	if (prompt.isCancel(nameAnswer)) return cancel(prompt);

	const name = nameAnswer.trim();
	const existing = config.contexts.find((context) => context.name === name);
	if (existing) {
		const replaceAnswer = await prompt.confirm({
			message: `Context "${name}" already exists. Update it?`,
			initialValue: true,
		});
		if (prompt.isCancel(replaceAnswer) || !replaceAnswer) return cancel(prompt);
	}

	const context = await promptForContext(name, existing, prompt);
	if (!context) return null;

	return saveContext(configPath, config, context, Boolean(existing), prompt);
}

export async function runUpdateContext(
	name: string,
	options: InitContextOptions = {},
	prompt: InitContextPrompts = interactivePrompts,
): Promise<InitContextResult | null> {
	const contextName = name.trim();
	if (!contextName) {
		throw new ConfigError("Enter a context name to update.");
	}

	const configPath = resolveContextConfigPath(options);
	const config = await readContextConfig(configPath);
	const existing = requireContext(config, contextName);

	prompt.intro(`Update LinearStories context "${contextName}"`);
	const context = await promptForContext(contextName, existing, prompt);
	if (!context) return null;

	return saveContext(configPath, config, context, true, prompt);
}

export async function runDeleteContext(
	name: string,
	options: InitContextOptions = {},
	prompt: InitContextPrompts = interactivePrompts,
): Promise<DeleteContextResult | null> {
	const contextName = name.trim();
	if (!contextName) {
		throw new ConfigError("Enter a context name to delete.");
	}

	const configPath = resolveContextConfigPath(options);
	const config = await readContextConfig(configPath);
	requireContext(config, contextName);

	prompt.intro(`Delete LinearStories context "${contextName}"`);
	const confirmed = await prompt.confirm({
		message: `Delete context "${contextName}"? This cannot be undone.`,
		initialValue: false,
	});
	if (prompt.isCancel(confirmed) || !confirmed) return cancel(prompt);

	const updated = removeContext(config, contextName);
	const deletedConfigFile = updated.contexts.length === 0;
	if (deletedConfigFile) {
		await deleteContextConfig(configPath);
	} else {
		await writeContextConfig(configPath, updated);
	}

	prompt.outro(
		deletedConfigFile
			? `Deleted "${contextName}" and removed the empty config file ${configPath}`
			: `Deleted "${contextName}" from ${configPath}`,
	);
	return { configPath, name: contextName, deletedConfigFile };
}

async function promptForContext(
	name: string,
	existing: ContextEntry | undefined,
	prompt: InitContextPrompts,
): Promise<ContextEntry | null> {
	const apiKeyAnswer = await prompt.password({
		message: existing?.apiKey
			? "Linear API token (leave blank to keep the stored token)"
			: "Linear API token (leave blank to use LINEAR_API_KEY)",
		validate: (value) => {
			if (!value?.trim() && !existing?.apiKey && !process.env.LINEAR_API_KEY) {
				return "Enter a token or set LINEAR_API_KEY before continuing.";
			}
			return undefined;
		},
	});
	if (prompt.isCancel(apiKeyAnswer)) return cancel(prompt);

	const teamAnswer = await prompt.text({
		message: "Default team (optional)",
		placeholder: "Engineering",
		initialValue: existing?.defaultTeam,
	});
	if (prompt.isCancel(teamAnswer)) return cancel(prompt);

	const projectAnswer = await prompt.text({
		message: "Default project (optional)",
		placeholder: "Q1 Release",
		initialValue: existing?.defaultProject,
	});
	if (prompt.isCancel(projectAnswer)) return cancel(prompt);

	const labelsAnswer = await prompt.text({
		message: "Default labels, comma-separated (optional)",
		placeholder: "User Story, Feature",
		initialValue: existing?.defaultLabels?.join(", "),
		validate: validateDefaultLabels,
	});
	if (prompt.isCancel(labelsAnswer)) return cancel(prompt);

	return buildContextEntry({
		name,
		apiKey: apiKeyAnswer,
		existingApiKey: existing?.apiKey,
		defaultTeam: teamAnswer,
		defaultProject: projectAnswer,
		defaultLabels: labelsAnswer,
	});
}

async function saveContext(
	configPath: string,
	config: Awaited<ReturnType<typeof readContextConfig>>,
	context: ContextEntry,
	replace: boolean,
	prompt: InitContextPrompts,
): Promise<InitContextResult> {
	const updated = upsertContext(config, context, replace);
	await writeContextConfig(configPath, updated);
	const usage =
		updated.contexts.length === 1
			? "linearstories import <files...>"
			: `linearstories import --context ${context.name} <files...>`;

	prompt.outro(`Saved "${context.name}" to ${configPath}\nUse it with: ${usage}`);
	return { configPath, context };
}

export function parseDefaultLabels(value: string): string[] {
	return [
		...new Set(
			value
				.split(",")
				.map((label) => label.trim())
				.filter(Boolean),
		),
	];
}

function resolveContextConfigPath(options: InitContextOptions): string {
	if (options.configPath) {
		return resolve(options.cwd ?? process.cwd(), options.configPath);
	}

	return resolveConfigPath({ cwd: options.cwd }) ?? getUserConfigPath();
}

function requireContext(
	config: Awaited<ReturnType<typeof readContextConfig>>,
	name: string,
): ContextEntry {
	const context = config.contexts.find((entry) => entry.name === name);
	if (context) return context;

	const names = config.contexts.map((entry) => entry.name).join(", ");
	const guidance = names
		? ` Available contexts: ${names}`
		: " Run linearstories initctx to create one.";
	throw new ConfigError(`Context "${name}" not found.${guidance}`);
}

function buildContextEntry(values: {
	name: string;
	apiKey: string;
	existingApiKey?: string;
	defaultTeam: string;
	defaultProject: string;
	defaultLabels: string;
}): ContextEntry {
	const context: ContextEntry = { name: values.name };
	const apiKey = values.apiKey.trim() || values.existingApiKey;
	const defaultTeam = values.defaultTeam.trim();
	const defaultProject = values.defaultProject.trim();
	const defaultLabels = parseDefaultLabels(values.defaultLabels);

	if (apiKey) context.apiKey = apiKey;
	if (defaultTeam) context.defaultTeam = defaultTeam;
	if (defaultProject) context.defaultProject = defaultProject;
	if (defaultLabels.length > 0) context.defaultLabels = defaultLabels;

	return context;
}

function validateDefaultLabels(value: string | undefined): string | undefined {
	if (parseDefaultLabels(value ?? "").includes("Epic")) {
		return '"Epic" identifies epic issues and cannot be a default label.';
	}
	return undefined;
}

function cancel(prompt: InitContextPrompts): null {
	prompt.cancel("No changes made.");
	return null;
}

function handleCommandError(error: unknown): never {
	const message = error instanceof Error ? error.message : String(error);
	console.error(chalk.red(`Error: ${message}`));
	process.exit(1);
}
