import { ConfigError } from "../errors.ts";
import type { CliConfig } from "../types.ts";

/**
 * Type guard that checks whether a value conforms to the CliConfig shape.
 * All fields are optional, so an empty object is technically valid.
 */
export function isCliConfig(value: unknown): value is CliConfig {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}

	const obj = value as Record<string, unknown>;

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
