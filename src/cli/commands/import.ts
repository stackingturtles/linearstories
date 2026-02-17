import chalk from "chalk";
import type { Command } from "commander";
import { glob } from "glob";
import { loadConfig } from "../../config/loader.ts";
import { ConfigError, LinearApiError, ParseError, ResolverError } from "../../errors.ts";
import { createLinearClient } from "../../linear/client.ts";
import { importStories } from "../../sync/importer.ts";
import type { ImportSummary } from "../../types.ts";

/**
 * Resolve an array of file paths / glob patterns into deduplicated file paths.
 */
async function resolveGlobs(patterns: string[]): Promise<string[]> {
	const allFiles: string[] = [];
	for (const pattern of patterns) {
		const matches = await glob(pattern);
		allFiles.push(...matches);
	}
	// Deduplicate while preserving order
	return [...new Set(allFiles)];
}

/**
 * Print a formatted import summary to stdout.
 */
function printSummary(summary: ImportSummary): void {
	console.log("");
	console.log(chalk.bold("Import Summary"));
	console.log(`  Total:   ${summary.total}`);
	console.log(`  Created: ${chalk.green(String(summary.created))}`);
	console.log(`  Updated: ${chalk.blue(String(summary.updated))}`);
	console.log(`  Skipped: ${chalk.yellow(String(summary.skipped))}`);
	console.log(`  Failed:  ${chalk.red(String(summary.failed))}`);

	// Print details for created/updated stories
	for (const result of summary.results) {
		if (result.action === "created" && result.linearId) {
			console.log(chalk.green(`  + ${result.linearId} ${result.story.title}`));
		} else if (result.action === "updated" && result.linearId) {
			console.log(chalk.blue(`  ~ ${result.linearId} ${result.story.title}`));
		} else if (result.action === "failed") {
			console.log(chalk.red(`  x ${result.story.title}: ${result.error}`));
		}
	}
}

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

export function registerImportCommand(program: Command) {
	program
		.command("import")
		.description("Import user stories from markdown files to Linear")
		.argument("<files...>", "Markdown file paths or glob patterns")
		.option("-c, --config <path>", "Config file path")
		.option("--context <name>", "Select a named context from multi-context config")
		.option("-t, --team <name>", "Override default team")
		.option("-p, --project <name>", "Override default project")
		.option("--dry-run", "Validate without calling Linear", false)
		.option("--no-write-back", "Skip writing Linear IDs back to markdown")
		.action(async (filePatterns: string[], options) => {
			try {
				// Resolve glob patterns to file paths
				const files = await resolveGlobs(filePatterns);
				if (files.length === 0) {
					console.error(chalk.red("No files matched the provided patterns."));
					process.exit(1);
				}

				// Load config
				const config = await loadConfig({ configPath: options.config, context: options.context });

				// Create client
				const client = createLinearClient(config.apiKey);

				// Import
				const summary = await importStories(client, {
					files,
					config,
					team: options.team,
					project: options.project,
					dryRun: options.dryRun,
					noWriteBack: !options.writeBack, // Commander converts --no-write-back to writeBack: false
				});

				// Print summary
				printSummary(summary);

				// Exit with error code if any failures
				if (summary.failed > 0) {
					process.exit(1);
				}
			} catch (error) {
				handleError(error);
			}
		});
}
