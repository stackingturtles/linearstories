import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ConfigError } from "../errors.ts";
import type { CliConfig, MultiContextConfig, ResolvedConfig } from "../types.ts";
import { assertConfigFile, isMultiContextConfig } from "./schema.ts";

export interface LoadConfigOptions {
	/** Explicit path to a config file (e.g. from --config flag) */
	configPath?: string;
	/** Working directory used for .linearrc.json discovery */
	cwd?: string;
	/** Named context to select from a multi-context config */
	context?: string;
}

/**
 * Discovers, reads, validates, and resolves the CLI configuration.
 *
 * Discovery order:
 *   1. `options.configPath` -- explicit --config flag
 *   2. `.linearrc.json` in `options.cwd` (or process.cwd())
 *   3. `~/.config/linearstories/config.json`
 *
 * After loading the file the LINEAR_API_KEY env var is merged in
 * (overrides the file value).  A ConfigError is thrown when no API key
 * is available from any source.
 */
export async function loadConfig(options?: LoadConfigOptions): Promise<ResolvedConfig> {
	const configPath = resolveConfigPath(options);
	const raw = configPath ? await readConfigFile(configPath) : {};

	// Validate shape (flat or multi-context)
	assertConfigFile(raw);

	// Resolve multi-context → flat CliConfig
	let config: CliConfig;

	if (isMultiContextConfig(raw)) {
		const multiConfig = raw as MultiContextConfig;
		const contextName = options?.context;

		if (!contextName) {
			const names = multiConfig.contexts.map((c) => c.name).join(", ");
			throw new ConfigError(
				`Config file contains multiple contexts. Use --context <name> to select one. Available contexts: ${names}`,
			);
		}

		const entry = multiConfig.contexts.find((c) => c.name === contextName);
		if (!entry) {
			const names = multiConfig.contexts.map((c) => c.name).join(", ");
			throw new ConfigError(`Context "${contextName}" not found. Available contexts: ${names}`);
		}

		config = {
			apiKey: entry.apiKey,
			defaultTeam: entry.defaultTeam,
			defaultProject: entry.defaultProject,
			defaultLabels: entry.defaultLabels,
		};
	} else {
		if (options?.context) {
			throw new ConfigError(
				"--context flag was specified but the config file does not use the multi-context format",
			);
		}
		config = raw as CliConfig;
	}

	// Merge env var -- env takes precedence
	const envApiKey = process.env.LINEAR_API_KEY;
	if (envApiKey) {
		config.apiKey = envApiKey;
	}

	// API key is required
	if (!config.apiKey) {
		throw new ConfigError(
			"No API key found. Provide one via LINEAR_API_KEY environment variable, " +
				'or set "apiKey" in your config file (.linearrc.json or ~/.config/linearstories/config.json).',
		);
	}

	return resolveConfig(config);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Determines which config file path to use based on discovery order.
 * Returns `undefined` when no config file is found (which is okay if
 * LINEAR_API_KEY is set in the environment).
 */
function resolveConfigPath(options?: LoadConfigOptions): string | undefined {
	// 1. Explicit path
	if (options?.configPath) {
		if (!existsSync(options.configPath)) {
			throw new ConfigError(`Config file not found: ${options.configPath}`);
		}
		return options.configPath;
	}

	// 2. .linearrc.json in cwd
	const cwd = options?.cwd ?? process.cwd();
	const rcPath = join(cwd, ".linearrc.json");
	if (existsSync(rcPath)) {
		return rcPath;
	}

	// 3. ~/.config/linearstories/config.json
	const home = process.env.HOME ?? homedir();
	const globalPath = join(home, ".config", "linearstories", "config.json");
	if (existsSync(globalPath)) {
		return globalPath;
	}

	return undefined;
}

/**
 * Reads and parses a JSON config file. Throws ConfigError on I/O or
 * parse failures.
 */
async function readConfigFile(filePath: string): Promise<unknown> {
	try {
		const text = await Bun.file(filePath).text();
		try {
			return JSON.parse(text);
		} catch {
			throw new ConfigError(`Malformed JSON in config file: ${filePath}`);
		}
	} catch (error) {
		if (error instanceof ConfigError) {
			throw error;
		}
		throw new ConfigError(`Failed to read config file: ${filePath}`);
	}
}

/**
 * Converts a validated CliConfig into a fully-resolved ResolvedConfig,
 * filling in defaults for optional fields.
 */
function resolveConfig(config: CliConfig): ResolvedConfig {
	return {
		apiKey: config.apiKey as string,
		defaultTeam: config.defaultTeam ?? null,
		defaultProject: config.defaultProject ?? null,
		defaultLabels: config.defaultLabels ?? [],
	};
}
