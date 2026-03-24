#!/usr/bin/env node

import { Command, Option } from "commander"
import { compareAction } from "./commands/compare.js"
import { sharedModulesAction } from "./commands/shared-modules.js"
import { sizesAction } from "./commands/sizes.js"
import { visualizeAction } from "./commands/visualize.js"

const program = new Command()
	.name("sls-bundle-analyser")
	.description(
		"Analyze bundle size changes for Serverless Framework Lambda functions.",
	)

program
	.command("compare")
	.description("compare bundle sizes between current branch and a base branch")
	.option("--base <branch>", "base branch to compare against")
	.option("--all", "analyze all functions, not just those affected by changes")
	.option("--verbose", "show per-module breakdown for each function")
	.option("--json", "output raw JSON instead of text")
	.option(
		"--threshold <bytes>",
		"only show functions with delta above threshold (in bytes)",
		"0",
	)
	.option(
		"--fail-above <bytes>",
		"exit with code 1 if any function grew more than this many bytes",
	)
	.option(
		"--include-zero-delta",
		"include functions whose total bundle size did not change",
	)
	.action(compareAction)

program
	.command("sizes")
	.description("report bundle sizes for all functions (no branch comparison)")
	.option("--json", "output raw JSON")
	.addOption(
		new Option("--sort <field>", "sort order")
			.choices(["size", "name"] as const)
			.default("size"),
	)
	.action(sizesAction)

program
	.command("visualize")
	.description(
		"generate an interactive bundle treemap for a single entry point",
	)
	.argument("<entry-point>", "handler file to visualize")
	.addOption(
		new Option("--template <type>", "visualization type")
			.choices(["treemap", "sunburst", "network"] as const)
			.default("treemap"),
	)
	.option("--no-third-party", "exclude node_modules from the visualization")
	.option("--no-open", "generate the file without opening it in the browser")
	.option(
		"--output <path>",
		"write HTML to this path instead of opening in browser",
	)
	.option("--top <n>", "show only the N largest modules")
	.option("--diff", "compare visualization against base branch")
	.option("--base <branch>", "base branch for --diff (default: from config)")
	.action(visualizeAction)

program
	.command("shared-modules")
	.description(
		"find node_modules packages bundled across multiple Lambda functions",
	)
	.option("--json", "output raw JSON")
	.option("--top <n>", "show only the top N modules", "20")
	.action(sharedModulesAction)

program.parseAsync().catch((err: unknown) => {
	console.error("Error:", err instanceof Error ? err.message : err)
	process.exit(1)
})
