import chalk from "chalk";
import type { Command } from "commander";
import { glob } from "glob";
import { loadConfig } from "../../config/loader.ts";
import { ConfigError, LinearApiError, ParseError, ResolverError } from "../../errors.ts";
import { createLinearClient } from "../../linear/client.ts";
import { importStories } from "../../sync/importer.ts";
import type { ImportPreflightReport, ImportSummary, LabelPreflightStatus } from "../../types.ts";

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
	if (summary.preflight) {
		printPreflight(summary.preflight);
	}

	console.log("");
	console.log(chalk.bold("Import Summary"));
	console.log(`  Total:   ${summary.total}`);
	console.log(`  Created: ${chalk.green(String(summary.created))}`);
	console.log(`  Updated: ${chalk.blue(String(summary.updated))}`);
	console.log(`  Skipped: ${chalk.yellow(String(summary.skipped))}`);
	console.log(`  Failed:  ${chalk.red(String(summary.failed))}`);

	// Print details for created/updated issues
	for (const result of summary.results) {
		if (result.action === "created" && result.linearId) {
			console.log(chalk.green(`  + ${result.linearId} ${result.story.title}`));
		} else if (result.action === "updated" && result.linearId) {
			console.log(chalk.blue(`  ~ ${result.linearId} ${result.story.title}`));
		} else if (result.action === "failed" && summary.preflight?.passed !== false) {
			console.log(chalk.red(`  x ${result.story.title}: ${result.error}`));
		}
	}
}

function printPreflight(report: ImportPreflightReport): void {
	console.log("");
	console.log(chalk.bold("Remote Preflight"));
	const teams = [...new Set(report.labels.map((label) => label.team))];
	const statuses: Array<{ status: LabelPreflightStatus; title: string }> = [
		{ status: "existing", title: "Existing" },
		{ status: "created", title: "Created" },
		{ status: "missing", title: "Missing" },
		{ status: "conflicting", title: "Conflicting" },
		{ status: "skipped", title: "Skipped" },
	];

	for (const team of teams) {
		console.log(`  Team: ${team}`);
		for (const { status, title } of statuses) {
			const labels = report.labels.filter(
				(label) => label.team === team && label.status === status,
			);
			if (labels.length === 0) continue;
			const values = labels.map((label) => {
				const scope = label.scope ? ` (${label.scope})` : "";
				const detail = label.detail ? ` - ${label.detail}` : "";
				return `${label.name}${scope}${detail}`;
			});
			console.log(`    ${title}: ${values.join(", ")}`);
		}
	}

	for (const warning of report.warnings) console.log(chalk.yellow(`  ! ${warning}`));
	for (const error of report.errors) console.log(chalk.red(`  x ${error}`));
	console.log(
		report.passed ? chalk.green("  Preflight passed.") : chalk.red("  Preflight failed."),
	);
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
		.description("Import epics and user stories from markdown files to Linear")
		.argument("<files...>", "Markdown file paths or glob patterns")
		.option("-c, --config <path>", "Config file path")
		.option("--context <name>", "Select a named context from multi-context config")
		.option("-t, --team <name>", "Override file and config team")
		.option("-p, --project <name>", "Override file and config project")
		.option("--dry-run", "Validate without calling Linear", false)
		.option("--preflight", "Check remote resources without creating labels or issues", false)
		.option(
			"--create-missing-labels",
			"Create missing team-scoped labels after remote preflight",
			false,
		)
		.option(
			"--allow-missing-labels",
			"Import while explicitly skipping labels unavailable to the target team",
			false,
		)
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
					preflight: options.preflight,
					createMissingLabels: options.createMissingLabels,
					allowMissingLabels: options.allowMissingLabels,
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
