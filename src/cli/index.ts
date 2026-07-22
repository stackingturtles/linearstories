#!/usr/bin/env bun
import { Command } from "commander";
import packageJson from "../../package.json" with { type: "json" };
import { registerExportCommand } from "./commands/export.ts";
import { registerImportCommand } from "./commands/import.ts";
import { registerVisualizeCommand } from "./commands/visualize.ts";

const program = new Command();

program
	.name("linearstories")
	.description("Bridge markdown user stories and Linear issues")
	.version(packageJson.version);

registerImportCommand(program);
registerExportCommand(program);
registerVisualizeCommand(program);

program.parse();
