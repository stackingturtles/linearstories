#!/usr/bin/env bun
import { Command } from "commander";
import packageJson from "../../package.json" with { type: "json" };
import { registerExportCommand } from "./commands/export.ts";
import { registerImportCommand } from "./commands/import.ts";

const program = new Command();

program
	.name("linearstories")
	.description("Bridge markdown user stories and Linear issues")
	.version(packageJson.version);

registerImportCommand(program);
registerExportCommand(program);

program.parse();
