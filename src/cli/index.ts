#!/usr/bin/env bun
import { Command } from "commander";
import { registerExportCommand } from "./commands/export.ts";
import { registerImportCommand } from "./commands/import.ts";

const program = new Command();

program
	.name("linearstories")
	.description("Bridge markdown user stories and Linear issues")
	.version("0.1.0");

registerImportCommand(program);
registerExportCommand(program);

program.parse();
