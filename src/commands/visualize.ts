import { loadConfig } from "../config.js"
import {
	type VisualizeOptions,
	visualizeDiff,
	visualizeEntryPoint,
} from "../visualize.js"

export interface VisualizeOpts {
	template: string
	thirdParty: boolean
	open: boolean
	output?: string
	top?: string
	diff?: boolean
	base?: string
}

export async function visualizeAction(
	entryPoint: string,
	opts: VisualizeOpts,
): Promise<void> {
	const cwd = process.cwd()
	const config = loadConfig(cwd)

	const vizOptions: VisualizeOptions = {
		template: opts.template as "treemap" | "sunburst" | "network",
		excludeThirdParty: !opts.thirdParty,
		top: opts.top ? parseInt(opts.top, 10) : undefined,
		outputPath: opts.output,
		open: opts.open,
	}

	if (opts.diff) {
		const base = opts.base ?? config.base
		process.stderr.write(`Bundling ${entryPoint} (current vs ${base})...\n`)
		const { currentPath, basePath } = await visualizeDiff(
			entryPoint,
			config,
			cwd,
			base,
			vizOptions,
		)
		process.stderr.write(`Current: ${currentPath}\n`)
		process.stderr.write(`Base:    ${basePath}\n`)
	} else {
		process.stderr.write(`Bundling ${entryPoint}...\n`)
		const outPath = await visualizeEntryPoint(
			entryPoint,
			config,
			cwd,
			vizOptions,
		)
		process.stderr.write(`Written to ${outPath}\n`)
	}
}
