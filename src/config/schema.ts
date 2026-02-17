import { ConfigError } from "../errors.ts";
import type { CliConfig, ContextEntry, MultiContextConfig } from "../types.ts";

/**
 * Validates the optional config fields shared between flat configs and context entries.
 */
function hasValidConfigFields(obj: Record<string, unknown>): boolean {
	if (obj.apiKey !== undefined && typeof obj.apiKey !== "string") {
		return false;
	}

	if (obj.defaultTeam !== undefined && typeof obj.defaultTeam !== "string") {
		return false;
	}

	if (obj.defaultProject !== undefined && typeof obj.defaultProject !== "string") {
		return false;
	}

	if (obj.defaultLabels !== undefined) {
		if (!Array.isArray(obj.defaultLabels)) {
			return false;
		}
		for (const label of obj.defaultLabels) {
			if (typeof label !== "string") {
				return false;
			}
		}
	}

	return true;
}

/**
 * Type guard that checks whether a value conforms to the CliConfig shape.
 * All fields are optional, so an empty object is technically valid.
 */
export function isCliConfig(value: unknown): value is CliConfig {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}

	return hasValidConfigFields(value as Record<string, unknown>);
}

/**
 * Type guard that checks whether a value conforms to a ContextEntry.
 * Requires a non-empty `name` string plus valid optional config fields.
 */
export function isContextEntry(value: unknown): value is ContextEntry {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}

	const obj = value as Record<string, unknown>;

	if (typeof obj.name !== "string" || obj.name.length === 0) {
		return false;
	}

	return hasValidConfigFields(obj);
}

/**
 * Type guard that checks whether a value conforms to MultiContextConfig.
 * Requires a non-empty `contexts` array where every element is a valid
 * ContextEntry and no two entries share the same name.
 */
export function isMultiContextConfig(value: unknown): value is MultiContextConfig {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}

	const obj = value as Record<string, unknown>;

	if (!Array.isArray(obj.contexts) || obj.contexts.length === 0) {
		return false;
	}

	const names = new Set<string>();
	for (const entry of obj.contexts) {
		if (!isContextEntry(entry)) {
			return false;
		}
		if (names.has(entry.name)) {
			return false;
		}
		names.add(entry.name);
	}

	return true;
}

/**
 * Validates and asserts that the parsed JSON conforms to CliConfig.
 * Throws a ConfigError if the shape is invalid.
 */
export function assertCliConfig(value: unknown): asserts value is CliConfig {
	if (!isCliConfig(value)) {
		throw new ConfigError(
			"Invalid config shape: expected an object with optional apiKey (string), defaultTeam (string), defaultProject (string), and defaultLabels (string[])",
		);
	}
}

/**
 * Validates a parsed config file as either a flat CliConfig or a MultiContextConfig.
 * Throws a ConfigError if the shape is invalid.
 */
export function assertConfigFile(value: unknown): asserts value is CliConfig | MultiContextConfig {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new ConfigError(
			"Invalid config shape: expected an object with optional apiKey (string), defaultTeam (string), defaultProject (string), and defaultLabels (string[])",
		);
	}

	const obj = value as Record<string, unknown>;

	if ("contexts" in obj) {
		if (!isMultiContextConfig(value)) {
			throw new ConfigError(
				"Invalid multi-context config: expected a non-empty contexts array where each entry has a unique non-empty name string and valid optional config fields",
			);
		}
	} else {
		if (!isCliConfig(value)) {
			throw new ConfigError(
				"Invalid config shape: expected an object with optional apiKey (string), defaultTeam (string), defaultProject (string), and defaultLabels (string[])",
			);
		}
	}
}
