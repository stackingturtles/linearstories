import chalk from "chalk";
import type { Command } from "commander";
import { loadConfig } from "../../config/loader.ts";
import { ConfigError, LinearApiError, ParseError, ResolverError } from "../../errors.ts";
import { createLinearClient } from "../../linear/client.ts";
import { exportStories } from "../../sync/exporter.ts";
import type { ExportFilters } from "../../types.ts";

/**
 * Print a user-friendly error message and exit.
 */
function handleError(error: unknown): never {
	if (
		error instanceof ConfigError ||
		error instanceof ParseError ||
		error instanceof LinearApiError ||
		error instanceof ResolverError
	) {
		console.error(chalk.red(`${error.name}: ${error.message}`));
	} else if (error instanceof Error) {
		console.error(chalk.red(`Error: ${error.message}`));
	} else {
		console.error(chalk.red(`Error: ${String(error)}`));
	}
	process.exit(1);
}

export function registerExportCommand(program: Command) {
	program
		.command("export")
		.description("Export Linear issues to a markdown file")
		.option("-c, --config <path>", "Config file path")
		.option("-t, --team <name>", "Override default team")
		.option("-o, --output <file>", "Output file path", "./exported-stories.md")
		.option("-p, --project <name>", "Filter by project")
		.option("-i, --issues <ids>", "Comma-separated issue IDs")
		.option("-s, --status <state>", "Filter by status")
		.option("-a, --assignee <email>", "Filter by assignee")
		.option("--creator <email>", "Filter by creator")
		.action(async (options) => {
			try {
				const config = await loadConfig({ configPath: options.config });
				const client = createLinearClient(config.apiKey);

				const filters: ExportFilters = {};
				if (options.project) filters.project = options.project;
				if (options.issues) filters.issues = options.issues.split(",").map((s: string) => s.trim());
				if (options.status) filters.status = options.status;
				if (options.assignee) filters.assignee = options.assignee;
				if (options.creator) filters.creator = options.creator;

				const result = await exportStories(client, {
					config,
					filters,
					team: options.team ?? config.defaultTeam ?? undefined,
					outputPath: options.output,
				});

				console.log(chalk.green(`Exported ${result.count} stories to ${result.outputPath}`));
			} catch (error) {
				handleError(error);
			}
		});
}
