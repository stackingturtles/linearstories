import { resolve } from "node:path";
import chalk from "chalk";
import { type Command, InvalidArgumentError } from "commander";
import { ParseError } from "../../errors.ts";
import { parseMarkdownFile } from "../../markdown/parser.ts";
import { buildProjectGraph } from "../../visualization/graph.ts";
import { openBrowser, startVisualizationServer } from "../../visualization/server.ts";

const DEFAULT_PORT = 4173;
const DEFAULT_HOST = "127.0.0.1";

interface VisualizeOptions {
	host: string;
	port: number;
	open: boolean;
}

export function registerVisualizeCommand(program: Command): void {
	program
		.command("visualize")
		.description("Visualize epics, user stories, and acceptance criteria in a local browser")
		.argument("<file>", "LinearStories markdown file")
		.option("--host <host>", "HTTP server host", DEFAULT_HOST)
		.option("-p, --port <port>", "Local HTTP server port", parsePort, DEFAULT_PORT)
		.option("--no-open", "Start the server without opening a browser")
		.action(async (file: string, options: VisualizeOptions) => {
			try {
				const filePath = resolve(file);
				const markdownFile = Bun.file(filePath);
				if (!(await markdownFile.exists())) {
					throw new ParseError(`File not found: ${file}`);
				}

				const parsed = parseMarkdownFile(await markdownFile.text(), filePath);
				const graph = buildProjectGraph(parsed);
				const { server, url } = startVisualizationServer({
					graph,
					hostname: options.host,
					port: options.port,
				});

				console.log(chalk.green(formatVisualizationSummary(graph, url)));
				console.log(chalk.dim("Press Ctrl+C to stop the server."));

				if (options.open) {
					try {
						openBrowser(url);
					} catch (error) {
						console.warn(
							chalk.yellow(
								`Could not open a browser automatically: ${error instanceof Error ? error.message : String(error)}`,
							),
						);
					}
				}

				process.once("SIGINT", () => {
					server.stop();
					process.exit(0);
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Error: ${message}`));
				process.exit(1);
			}
		});
}

export function formatVisualizationSummary(
	graph: ReturnType<typeof buildProjectGraph>,
	url: string,
): string {
	const { totalEpics, totalStories } = graph.project.progress;
	return `Visualizing ${formatCount(totalEpics, "epic")} and ${formatCount(totalStories, "user story", "user stories")} at ${url}`;
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

function parsePort(value: string): number {
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new InvalidArgumentError("Port must be an integer between 1 and 65535.");
	}
	return port;
}
