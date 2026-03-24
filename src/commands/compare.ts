import { relative } from "node:path"
import { compareBundles, getChangedFiles, getRepoRoot } from "../compare.js"
import { loadConfig } from "../config.js"
import {
	buildDependencyGraph,
	getAffectedEntryPoints,
} from "../dependency-graph.js"
import { parseServerlessHandlers } from "../parse-serverless.js"
import {
	buildReportData,
	formatJsonReport,
	formatTextReport,
	type ReportOptions,
} from "../report.js"

export interface CompareOpts {
	base?: string
	all?: boolean
	verbose?: boolean
	json?: boolean
	threshold: string
	failAbove?: string
	includeZeroDelta?: boolean
}

export async function compareAction(opts: CompareOpts): Promise<void> {
	const cwd = process.cwd()
	const config = loadConfig(cwd)
	const base = opts.base ?? config.base
	const all = opts.all === true
	const verbose = opts.verbose === true
	const json = opts.json === true
	const threshold = parseInt(opts.threshold, 10)
	const failAbove = opts.failAbove ? parseInt(opts.failAbove, 10) : undefined

	// Step 1: Parse serverless files
	process.stderr.write("Parsing serverless files...\n")
	const parseResult = parseServerlessHandlers(cwd, config.exclude)

	if (parseResult.entries.size === 0) {
		if (json) {
			console.log(
				formatJsonReport({
					directory: cwd,
					changedFiles: 0,
					affectedFunctions: 0,
					totalFunctions: 0,
					functions: [],
					topGrowingModules: [],
				}),
			)
		} else {
			console.log("No serverless handler entry points found.")
		}
		return
	}

	process.stderr.write(
		`Found ${parseResult.totalFunctions} functions (${parseResult.entries.size} unique entry points)\n`,
	)

	// Step 2: Build dependency graph
	process.stderr.write("Building dependency graph...\n")
	const graph = await buildDependencyGraph(parseResult, config, cwd)

	// Step 3: Determine affected entry points
	const repoRoot = getRepoRoot(cwd)
	const changedFiles = getChangedFiles(base, repoRoot)
	const cwdRelative = relative(repoRoot, cwd)

	// Filter changed files to those relevant to this service directory
	const relevantChangedFiles = changedFiles.filter(
		(f) => f.startsWith(`${cwdRelative}/`) || !cwdRelative,
	)

	let affectedEntryPoints: Set<string>

	if (all) {
		affectedEntryPoints = new Set(
			Array.from(parseResult.entries.keys()).map((fp) => relative(cwd, fp)),
		)
	} else {
		// Changed files in the dependency graph are relative to cwd (how esbuild reports them)
		// But git diff returns paths relative to repo root
		// We need to match them — the reverse map keys are relative to cwd (esbuild's absWorkingDir)
		affectedEntryPoints = getAffectedEntryPoints(changedFiles, graph.reverseMap)

		// Also check with paths relative to cwd
		const cwdRelativeChangedFiles = relevantChangedFiles.map((f) =>
			relative(cwdRelative, f),
		)
		const moreAffected = getAffectedEntryPoints(
			cwdRelativeChangedFiles,
			graph.reverseMap,
		)
		for (const ep of moreAffected) {
			affectedEntryPoints.add(ep)
		}
	}

	if (affectedEntryPoints.size === 0) {
		if (json) {
			console.log(
				formatJsonReport({
					directory: cwd,
					changedFiles: relevantChangedFiles.length,
					affectedFunctions: 0,
					totalFunctions: parseResult.totalFunctions,
					functions: [],
					topGrowingModules: [],
				}),
			)
		} else {
			console.log("No affected functions — bundle sizes unchanged.")
		}
		return
	}

	process.stderr.write(
		`${affectedEntryPoints.size} affected entry points, comparing against ${base}...\n`,
	)

	// Step 4: Compare bundles
	const comparison = await compareBundles(affectedEntryPoints, config, cwd)

	// Step 5: Report
	const includeZeroDelta = opts.includeZeroDelta === true
	const reportData = buildReportData(
		comparison,
		relevantChangedFiles.length,
		parseResult.totalFunctions,
		cwd,
		includeZeroDelta,
	)

	const reportOptions: ReportOptions = {
		verbose,
		json,
		threshold,
		cwd,
	}

	if (json) {
		console.log(formatJsonReport(reportData))
	} else {
		console.log(formatTextReport(reportData, reportOptions))
	}

	// Step 6: Fail if any function grew more than the limit
	if (failAbove != null) {
		const exceeded = reportData.functions.some((f) => f.deltaBytes > failAbove)
		if (exceeded) {
			process.stderr.write(
				`One or more functions grew by more than ${failAbove} bytes.\n`,
			)
			process.exit(1)
		}
	}
}
