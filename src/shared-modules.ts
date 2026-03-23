import { join, relative } from "node:path"
import { build } from "esbuild"
import type { BundleAnalyserConfig } from "./config.js"
import { buildEsbuildOptions } from "./esbuild-config.js"
import type { ParseResult } from "./parse-serverless.js"

export interface SharedModule {
	package: string
	bundleCount: number
	totalBytes: number
	avgBytesPerBundle: number
}

export interface SharedModulesResult {
	modules: SharedModule[]
	totalEntryPoints: number
}

const BATCH_SIZE = 10

export function extractPackageName(inputPath: string): string | null {
	const idx = inputPath.lastIndexOf("node_modules/")
	if (idx === -1) return null

	const rest = inputPath.slice(idx + "node_modules/".length)

	if (rest.startsWith("@")) {
		// Scoped package: @scope/pkg/...
		const parts = rest.split("/")
		if (parts.length >= 2) return `${parts[0]}/${parts[1]}`
		return null
	}

	// Regular package: pkg/...
	const slashIdx = rest.indexOf("/")
	return slashIdx === -1 ? rest : rest.slice(0, slashIdx)
}

export async function analyzeSharedModules(
	parseResult: ParseResult,
	config: BundleAnalyserConfig,
	cwd: string,
): Promise<SharedModulesResult> {
	const entries = Array.from(parseResult.entries.keys())

	// Per-package aggregation: package -> { perBundle: Map<entryIndex, bytes> }
	const packageData = new Map<string, Map<number, number>>()

	for (let i = 0; i < entries.length; i += BATCH_SIZE) {
		const batchEntries = entries.slice(i, i + BATCH_SIZE)
		const batchMap: Record<string, string> = {}
		for (const ep of batchEntries) {
			const key = relative(cwd, ep)
			batchMap[key] = ep
		}

		const options = buildEsbuildOptions(batchMap, config)
		const result = await build({ ...options, absWorkingDir: cwd })

		if (!result.metafile) {
			throw new Error("esbuild did not produce a metafile")
		}

		for (const output of Object.values(result.metafile.outputs)) {
			if (output.entryPoint) {
				const bundleIdx = entries.indexOf(join(cwd, output.entryPoint))

				for (const [inputPath, { bytesInOutput }] of Object.entries(
					output.inputs,
				)) {
					const pkg = extractPackageName(inputPath)
					if (pkg) {
						let perBundle = packageData.get(pkg)
						if (!perBundle) {
							perBundle = new Map()
							packageData.set(pkg, perBundle)
						}
						perBundle.set(
							bundleIdx,
							(perBundle.get(bundleIdx) ?? 0) + bytesInOutput,
						)
					}
				}
			}
		}

		process.stderr.write(
			`Bundled ${Math.min(i + BATCH_SIZE, entries.length)}/${entries.length} entry points...\n`,
		)
	}

	const modules: SharedModule[] = Array.from(packageData.entries()).map(
		([pkg, perBundle]) => {
			const totalBytes = Array.from(perBundle.values()).reduce(
				(sum, b) => sum + b,
				0,
			)
			return {
				package: pkg,
				bundleCount: perBundle.size,
				totalBytes,
				avgBytesPerBundle: Math.round(totalBytes / perBundle.size),
			}
		},
	)

	// Sort by bundleCount desc, secondary by totalBytes desc
	modules.sort(
		(a, b) => b.bundleCount - a.bundleCount || b.totalBytes - a.totalBytes,
	)

	return { modules, totalEntryPoints: entries.length }
}

const bold = (s: string): string => `\x1b[1m${s}\x1b[0m`
const dim = (s: string): string => `\x1b[2m${s}\x1b[0m`

function formatBytes(bytes: number): string {
	const abs = Math.abs(bytes)
	if (abs < 1024) return `${bytes} B`
	if (abs < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function formatSharedModulesText(
	result: SharedModulesResult,
	top: number,
): string {
	const lines: string[] = []
	const modules = result.modules.slice(0, top)

	lines.push(
		bold(
			`Shared node_modules packages (${result.totalEntryPoints} entry points)`,
		),
	)
	lines.push("=".repeat(60))

	if (modules.length === 0) {
		lines.push(dim("No shared node_modules packages found."))
		return lines.join("\n")
	}

	const nameWidth = Math.max(30, ...modules.map((m) => m.package.length))
	lines.push(
		`  ${"Module".padEnd(nameWidth)}  ${"Bundles".padStart(8)}  ${"Avg Size".padStart(10)}  ${"Total".padStart(10)}`,
	)
	lines.push(
		`  ${"─".repeat(nameWidth)}  ${"─".repeat(8)}  ${"─".repeat(10)}  ${"─".repeat(10)}`,
	)

	for (const mod of modules) {
		lines.push(
			`  ${mod.package.padEnd(nameWidth)}  ${String(mod.bundleCount).padStart(8)}  ${formatBytes(mod.avgBytesPerBundle).padStart(10)}  ${formatBytes(mod.totalBytes).padStart(10)}`,
		)
	}

	return lines.join("\n")
}

export function formatSharedModulesJson(
	result: SharedModulesResult,
	top: number,
): string {
	return JSON.stringify(
		{ ...result, modules: result.modules.slice(0, top) },
		null,
		2,
	)
}
