import { relative } from "node:path"
import { build, type Metafile } from "esbuild"
import type { BundleAnalyserConfig } from "./config.js"
import { buildEsbuildOptions } from "./esbuild-config.js"
import type { ParseResult } from "./parse-serverless.js"

const BATCH_SIZE = 10

export interface DependencyGraph {
	/** For each source file (relative to cwd), which entry point keys depend on it */
	reverseMap: Map<string, Set<string>>
}

/**
 * Build a reverse dependency map using esbuild's metafile.
 *
 * Batches entry points to avoid overwhelming esbuild's IPC with huge metafiles.
 */
export async function buildDependencyGraph(
	parseResult: ParseResult,
	config: BundleAnalyserConfig,
	cwd: string,
): Promise<DependencyGraph> {
	const allEntryPoints: Record<string, string> = {}
	for (const [filePath] of parseResult.entries) {
		const key = relative(cwd, filePath)
		allEntryPoints[key] = filePath
	}

	const keys = Object.keys(allEntryPoints)
	if (keys.length === 0) {
		return { reverseMap: new Map() }
	}

	const reverseMap = new Map<string, Set<string>>()

	// Process in batches to avoid esbuild IPC overflow
	for (let i = 0; i < keys.length; i += BATCH_SIZE) {
		const batchKeys = keys.slice(i, i + BATCH_SIZE)
		const batchEntryPoints: Record<string, string> = {}
		for (const key of batchKeys) {
			batchEntryPoints[key] = allEntryPoints[key]
		}

		const options = buildEsbuildOptions(batchEntryPoints, config)
		// For dependency graph, skip minification — we only need the input list, not accurate sizes
		const result = await build({
			...options,
			absWorkingDir: cwd,
			minify: false,
		})

		if (!result.metafile) {
			throw new Error("esbuild did not produce a metafile")
		}

		mergeReverseMap(reverseMap, result.metafile)
	}

	return { reverseMap }
}

/**
 * Extract reverse dependency info from a metafile and merge into an existing map.
 *
 * esbuild's metafile.outputs has entries like:
 *   "dist/src/handlers/foo.js": { entryPoint: "src/handlers/foo.ts", inputs: { "src/services/bar.ts": ... } }
 *
 * We invert this to get:
 *   "src/services/bar.ts" -> Set(["src/handlers/foo.ts"])
 */
export function mergeReverseMap(
	reverseMap: Map<string, Set<string>>,
	metafile: Metafile,
): void {
	for (const [, outputMeta] of Object.entries(metafile.outputs)) {
		const { entryPoint } = outputMeta
		if (entryPoint) {
			for (const inputPath of Object.keys(outputMeta.inputs)) {
				let entries = reverseMap.get(inputPath)
				if (!entries) {
					entries = new Set()
					reverseMap.set(inputPath, entries)
				}
				entries.add(entryPoint)
			}
		}
	}
}

/**
 * Given a set of changed files and a reverse dependency map,
 * return the entry points that are affected.
 */
export function getAffectedEntryPoints(
	changedFiles: string[],
	reverseMap: Map<string, Set<string>>,
): Set<string> {
	const affected = new Set<string>()

	for (const file of changedFiles) {
		const entries = reverseMap.get(file)
		if (entries) {
			for (const entry of entries) {
				affected.add(entry)
			}
		}
	}

	return affected
}
