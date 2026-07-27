import chalk from "chalk";
import type { Command } from "commander";
import { getContextEntries } from "../../config/contexts.ts";
import { readConfigFile, resolveConfigPath } from "../../config/loader.ts";
import { isMultiContextConfig } from "../../config/schema.ts";
import { ConfigError } from "../../errors.ts";
import type { CliConfig, MultiContextConfig } from "../../types.ts";

export function registerContextsCommand(program: Command): void {
	program
		.command("contexts")
		.alias("ctx")
		.description("List configured contexts without exposing API tokens")
		.option("-c, --config <path>", "Config file path")
		.action(async (options: { config?: string }) => {
			try {
				const configPath = resolveConfigPath({ configPath: options.config });
				if (!configPath) {
					throw new ConfigError("No config file found. Run linearstories initctx to create one.");
				}

				const config = await readConfigFile(configPath);
				console.log(formatContexts(config, configPath));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Error: ${message}`));
				process.exit(1);
			}
		});
}

export function formatContexts(config: CliConfig | MultiContextConfig, configPath: string): string {
	const entries = getContextEntries(config);
	const legacy = !isMultiContextConfig(config);
	const lines = [chalk.bold("LinearStories contexts"), chalk.dim(`Config: ${configPath}`), ""];

	for (const [index, context] of entries.entries()) {
		const suffix = legacy ? chalk.dim(" (legacy flat config)") : "";
		lines.push(`${chalk.cyan("> ")}${chalk.bold(context.name)}${suffix}`);
		lines.push(
			`  API token        ${context.apiKey ? chalk.green("configured (hidden)") : chalk.yellow("not stored")}`,
		);
		lines.push(`  Default team     ${context.defaultTeam ?? chalk.dim("not set")}`);
		lines.push(`  Default project  ${context.defaultProject ?? chalk.dim("not set")}`);
		lines.push(
			`  Default labels   ${context.defaultLabels?.length ? context.defaultLabels.join(", ") : chalk.dim("none")}`,
		);
		if (index < entries.length - 1) lines.push("");
	}

	return lines.join("\n");
}
