import { loadConfig } from "../config.js"
import { parseServerlessHandlers } from "../parse-serverless.js"
import {
	analyzeSharedModules,
	formatSharedModulesJson,
	formatSharedModulesText,
} from "../shared-modules.js"

export interface SharedModulesOpts {
	json?: boolean
	top: string
}

export async function sharedModulesAction(
	opts: SharedModulesOpts,
): Promise<void> {
	const cwd = process.cwd()
	const config = loadConfig(cwd)

	process.stderr.write("Parsing serverless files...\n")
	const parseResult = parseServerlessHandlers(cwd, config.exclude)

	if (parseResult.entries.size === 0) {
		console.log("No serverless handler entry points found.")
		return
	}

	process.stderr.write(
		`Found ${parseResult.totalFunctions} functions (${parseResult.entries.size} unique entry points)\n`,
	)

	process.stderr.write("Analysing shared modules...\n")
	const result = await analyzeSharedModules(parseResult, config, cwd)

	const top = parseInt(opts.top, 10)

	if (opts.json) {
		console.log(formatSharedModulesJson(result, top))
	} else {
		console.log(formatSharedModulesText(result, top))
	}
}
