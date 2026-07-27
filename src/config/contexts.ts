import { existsSync } from "node:fs";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { ConfigError } from "../errors.ts";
import type { CliConfig, ContextEntry, MultiContextConfig } from "../types.ts";
import { readConfigFile } from "./loader.ts";
import { isMultiContextConfig } from "./schema.ts";

const LEGACY_CONTEXT_NAME = "default";

/** Reads an editable context config, migrating a legacy flat config in memory. */
export async function readContextConfig(filePath: string): Promise<MultiContextConfig> {
	if (!existsSync(filePath)) {
		return { contexts: [] };
	}

	const config = await readConfigFile(filePath);
	if (isMultiContextConfig(config)) {
		return { contexts: config.contexts.map((context) => ({ ...context })) };
	}

	return isEmptyConfig(config)
		? { contexts: [] }
		: { contexts: [{ ...config, name: LEGACY_CONTEXT_NAME }] };
}

/** Converts either supported config shape into entries suitable for display. */
export function getContextEntries(config: CliConfig | MultiContextConfig): ContextEntry[] {
	if (isMultiContextConfig(config)) {
		return config.contexts;
	}

	return [{ ...config, name: LEGACY_CONTEXT_NAME }];
}

/** Adds or replaces a named context without mutating the source config. */
export function upsertContext(
	config: MultiContextConfig,
	context: ContextEntry,
	replace = false,
): MultiContextConfig {
	const existingIndex = config.contexts.findIndex((entry) => entry.name === context.name);
	if (existingIndex >= 0 && !replace) {
		throw new ConfigError(`Context "${context.name}" already exists.`);
	}

	const contexts = config.contexts.map((entry) => ({ ...entry }));
	if (existingIndex >= 0) {
		contexts[existingIndex] = { ...context };
	} else {
		contexts.push({ ...context });
	}

	return { contexts };
}

/** Removes a named context without mutating the source config. */
export function removeContext(config: MultiContextConfig, name: string): MultiContextConfig {
	const contexts = config.contexts
		.filter((context) => context.name !== name)
		.map((context) => ({ ...context }));
	if (contexts.length === config.contexts.length) {
		throw new ConfigError(`Context "${name}" not found.`);
	}

	return { contexts };
}

/** Writes a context config atomically and restricts it to the current user. */
export async function writeContextConfig(
	filePath: string,
	config: MultiContextConfig,
): Promise<void> {
	if (config.contexts.length === 0) {
		throw new ConfigError("Cannot write a config without at least one context.");
	}

	const directory = dirname(filePath);
	const temporaryPath = join(directory, `.${basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
	await mkdir(directory, { recursive: true, mode: 0o700 });

	try {
		await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
		await rename(temporaryPath, filePath);
		await chmod(filePath, 0o600);
	} catch (error) {
		await rm(temporaryPath, { force: true });
		throw new ConfigError(
			`Failed to write config file: ${filePath}${error instanceof Error ? ` (${error.message})` : ""}`,
		);
	}
}

/** Removes a config file after its final context has been deleted. */
export async function deleteContextConfig(filePath: string): Promise<void> {
	try {
		await rm(filePath);
	} catch (error) {
		throw new ConfigError(
			`Failed to delete config file: ${filePath}${error instanceof Error ? ` (${error.message})` : ""}`,
		);
	}
}

function isEmptyConfig(config: CliConfig): boolean {
	return Object.keys(config).length === 0;
}
