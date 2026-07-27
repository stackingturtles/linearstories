#!/usr/bin/env bun
import { Command } from "commander";
import packageJson from "../../package.json" with { type: "json" };
import { registerContextsCommand } from "./commands/contexts.ts";
import { registerExportCommand } from "./commands/export.ts";
import { registerImportCommand } from "./commands/import.ts";
import {
	registerDeleteContextCommand,
	registerInitContextCommand,
	registerUpdateContextCommand,
} from "./commands/init-context.ts";
import { registerVisualizeCommand } from "./commands/visualize.ts";

const program = new Command();

program
	.name("linearstories")
	.description("Bridge markdown user stories and Linear issues")
	.version(packageJson.version);

registerImportCommand(program);
registerExportCommand(program);
registerVisualizeCommand(program);
registerInitContextCommand(program);
registerUpdateContextCommand(program);
registerDeleteContextCommand(program);
registerContextsCommand(program);

program.parse();
