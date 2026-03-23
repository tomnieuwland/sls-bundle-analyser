import { execSync } from "node:child_process"
import { existsSync, writeFileSync } from "node:fs"
import { basename, dirname, extname, join, resolve } from "node:path"
import { build, type Metafile } from "esbuild"
import { withWorktree } from "./compare.js"
import type { BundleAnalyserConfig } from "./config.js"
import { buildEsbuildOptions } from "./esbuild-config.js"

type Template = "treemap" | "sunburst" | "network"

export interface VisualizeOptions {
	template: Template
	excludeThirdParty: boolean
	top?: number
	outputPath?: string
	open?: boolean
}

export function filterThirdParty(metafile: Metafile): Metafile {
	const inputs: Metafile["inputs"] = {}
	for (const [path, value] of Object.entries(metafile.inputs)) {
		if (!path.includes("node_modules")) {
			inputs[path] = value
		}
	}

	const outputs: Metafile["outputs"] = {}
	for (const [bundle, output] of Object.entries(metafile.outputs)) {
		const filteredInputs: typeof output.inputs = {}
		for (const [path, value] of Object.entries(output.inputs)) {
			if (!path.includes("node_modules")) {
				filteredInputs[path] = value
			}
		}
		outputs[bundle] = { ...output, inputs: filteredInputs }
	}

	return { inputs, outputs }
}

export function filterTopModules(metafile: Metafile, n: number): Metafile {
	// Collect all input paths with their total bytesInOutput across all outputs
	const totalByPath = new Map<string, number>()
	for (const output of Object.values(metafile.outputs)) {
		for (const [path, { bytesInOutput }] of Object.entries(output.inputs)) {
			totalByPath.set(path, (totalByPath.get(path) ?? 0) + bytesInOutput)
		}
	}

	// Sort descending and keep top N paths
	const topPaths = new Set(
		Array.from(totalByPath.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, n)
			.map(([path]) => path),
	)

	// Rebuild metafile with only those paths
	const inputs: Metafile["inputs"] = {}
	for (const [path, value] of Object.entries(metafile.inputs)) {
		if (topPaths.has(path)) {
			inputs[path] = value
		}
	}

	const outputs: Metafile["outputs"] = {}
	for (const [bundle, output] of Object.entries(metafile.outputs)) {
		const filteredInputs: typeof output.inputs = {}
		for (const [path, value] of Object.entries(output.inputs)) {
			if (topPaths.has(path)) {
				filteredInputs[path] = value
			}
		}
		outputs[bundle] = { ...output, inputs: filteredInputs }
	}

	return { inputs, outputs }
}

function resolveEntryPoint(entryPoint: string, cwd: string): string {
	// If it already has an extension, try as-is first
	const abs = resolve(cwd, entryPoint)
	if (existsSync(abs)) return abs

	// Try common extensions
	if (!extname(entryPoint)) {
		for (const ext of [".ts", ".js"]) {
			const candidate = resolve(cwd, entryPoint + ext)
			if (existsSync(candidate)) return candidate
		}
	}

	throw new Error(`Entry point not found: ${entryPoint} (resolved from ${cwd})`)
}

export function sanitizeForFilename(entryPoint: string): string {
	return entryPoint.replace(/[/\\]/g, "-").replace(/\.[^.]+$/, "")
}

async function buildAndVisualize(
	entryPoint: string,
	config: BundleAnalyserConfig,
	cwd: string,
	options: VisualizeOptions,
): Promise<string> {
	const resolvedPath = resolveEntryPoint(entryPoint, cwd)

	const buildOpts = buildEsbuildOptions({ entry: resolvedPath }, config)
	buildOpts.absWorkingDir = cwd

	const result = await build(buildOpts)

	if (!result.metafile) {
		throw new Error("esbuild did not produce a metafile")
	}

	// Dynamic import of esbuild-visualizer
	const { visualizer } = (await import(
		"esbuild-visualizer/dist/plugin/index.js"
	)) as {
		visualizer: (
			metafile: typeof result.metafile,
			opts?: { template?: string; title?: string },
		) => Promise<string>
	}

	let metafile = options.excludeThirdParty
		? filterThirdParty(result.metafile)
		: result.metafile

	if (options.top != null) {
		metafile = filterTopModules(metafile, options.top)
	}

	return visualizer(metafile, {
		template: options.template,
		title: entryPoint,
	})
}

export async function visualizeEntryPoint(
	entryPoint: string,
	config: BundleAnalyserConfig,
	cwd: string,
	options: VisualizeOptions,
): Promise<string> {
	const html = await buildAndVisualize(entryPoint, config, cwd, options)

	const sanitized = sanitizeForFilename(entryPoint)
	const outPath =
		options.outputPath ?? `/tmp/sls-bundle-analyser-${sanitized}.html`
	writeFileSync(outPath, html)

	if (options.open !== false && !options.outputPath) {
		execSync(`open ${outPath}`)
	}

	return outPath
}

export async function visualizeDiff(
	entryPoint: string,
	config: BundleAnalyserConfig,
	cwd: string,
	base: string,
	options: VisualizeOptions,
): Promise<{ currentPath: string; basePath: string }> {
	const currentHtml = await buildAndVisualize(entryPoint, config, cwd, options)
	const baseHtml = await withWorktree(base, cwd, (worktreeCwd) =>
		buildAndVisualize(entryPoint, config, worktreeCwd, options),
	)

	const sanitized = sanitizeForFilename(entryPoint)

	let currentPath: string
	let basePath: string

	if (options.outputPath) {
		const dir = dirname(options.outputPath)
		const ext = extname(options.outputPath)
		const stem = basename(options.outputPath, ext)
		currentPath = join(dir, `${stem}-current${ext}`)
		basePath = join(dir, `${stem}-${base}${ext}`)
	} else {
		currentPath = `/tmp/sls-bundle-analyser-${sanitized}-current.html`
		basePath = `/tmp/sls-bundle-analyser-${sanitized}-${base}.html`
	}

	writeFileSync(currentPath, currentHtml)
	writeFileSync(basePath, baseHtml)

	if (options.open !== false && !options.outputPath) {
		execSync(`open ${currentPath}`)
		execSync(`open ${basePath}`)
	}

	return { currentPath, basePath }
}
