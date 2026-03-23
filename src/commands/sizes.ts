import { join, relative } from "node:path"
import { bundleAndMeasure } from "../compare.js"
import { loadConfig } from "../config.js"
import { parseServerlessHandlers } from "../parse-serverless.js"

export interface SizesOpts {
	json?: boolean
	sort: string
}

interface FunctionSize {
	entryPoint: string
	bytes: number
}

const bold = (s: string): string => `\x1b[1m${s}\x1b[0m`

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatSizesText(functions: FunctionSize[], total: number): string {
	const lines: string[] = []

	lines.push(bold(`Bundle sizes — ${functions.length} of ${total} functions`))
	lines.push("=".repeat(60))

	if (functions.length === 0) {
		lines.push("No functions found.")
		return lines.join("\n")
	}

	const nameWidth = Math.max(30, ...functions.map((f) => f.entryPoint.length))
	lines.push(`  ${"Function".padEnd(nameWidth)}  ${"Size".padStart(10)}`)
	lines.push(`  ${"─".repeat(nameWidth)}  ${"─".repeat(10)}`)

	for (const fn of functions) {
		lines.push(
			`  ${fn.entryPoint.padEnd(nameWidth)}  ${formatBytes(fn.bytes).padStart(10)}`,
		)
	}

	const totalBytes = functions.reduce((sum, f) => sum + f.bytes, 0)
	lines.push("")
	lines.push(
		`  ${"Total".padEnd(nameWidth)}  ${formatBytes(totalBytes).padStart(10)}`,
	)

	return lines.join("\n")
}

export async function sizesAction(opts: SizesOpts): Promise<void> {
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

	// Build entry points map
	const entryPoints: Record<string, string> = {}
	for (const [absPath] of parseResult.entries) {
		const rel = relative(cwd, absPath)
		entryPoints[rel] = join(cwd, rel)
	}

	process.stderr.write("Bundling...\n")
	const sizes = await bundleAndMeasure(entryPoints, config, cwd)

	const functions: FunctionSize[] = Array.from(sizes.entries()).map(
		([ep, size]) => ({
			entryPoint: ep,
			bytes: size.bytes,
		}),
	)

	if (opts.sort === "name") {
		functions.sort((a, b) => a.entryPoint.localeCompare(b.entryPoint))
	} else {
		functions.sort((a, b) => b.bytes - a.bytes)
	}

	if (opts.json) {
		console.log(JSON.stringify({ functions }, null, 2))
	} else {
		console.log(formatSizesText(functions, parseResult.totalFunctions))
	}
}
