import { relative } from "node:path"
import type { ComparisonResult } from "./compare.js"

export interface ReportOptions {
	verbose: boolean
	json: boolean
	threshold: number
	cwd: string
}

interface FunctionDelta {
	entryPoint: string
	currentBytes: number
	baseBytes: number
	deltaBytes: number
	deltaPercent: number
	isNew: boolean
	isRemoved: boolean
}

interface ModuleDelta {
	module: string
	deltaBytes: number
	affectedFunctions: number
}

export interface ReportData {
	directory: string
	changedFiles: number
	affectedFunctions: number
	totalFunctions: number
	functions: FunctionDelta[]
	topGrowingModules: ModuleDelta[]
}

export function buildReportData(
	comparison: ComparisonResult,
	changedFileCount: number,
	totalFunctions: number,
	cwd: string,
	includeZeroDelta = false,
): ReportData {
	const functions: FunctionDelta[] = []

	// Existing + changed functions
	for (const [ep, currentSize] of comparison.current) {
		const baseSize = comparison.base.get(ep)
		const isNew = comparison.newEntryPoints.has(ep)
		const baseBytes = baseSize?.bytes ?? 0
		const deltaBytes = currentSize.bytes - baseBytes
		const deltaPercent = baseBytes > 0 ? (deltaBytes / baseBytes) * 100 : 0

		functions.push({
			entryPoint: ep,
			currentBytes: currentSize.bytes,
			baseBytes,
			deltaBytes,
			deltaPercent,
			isNew,
			isRemoved: false,
		})
	}

	// Removed functions
	for (const ep of comparison.removedEntryPoints) {
		const baseSize = comparison.base.get(ep)
		if (baseSize) {
			functions.push({
				entryPoint: ep,
				currentBytes: 0,
				baseBytes: baseSize.bytes,
				deltaBytes: -baseSize.bytes,
				deltaPercent: -100,
				isNew: false,
				isRemoved: true,
			})
		}
	}

	// Filter out zero-delta functions unless explicitly requested
	const filtered = includeZeroDelta
		? functions
		: functions.filter((f) => f.deltaBytes !== 0)

	// Sort by absolute delta descending
	filtered.sort((a, b) => Math.abs(b.deltaBytes) - Math.abs(a.deltaBytes))

	// Compute top growing modules across all functions
	const moduleDeltas = computeModuleDeltas(comparison, includeZeroDelta)

	return {
		directory: relative(process.cwd(), cwd) || ".",
		changedFiles: changedFileCount,
		affectedFunctions: filtered.length,
		totalFunctions,
		functions: filtered,
		topGrowingModules: moduleDeltas,
	}
}

export function computeModuleDeltas(
	comparison: ComparisonResult,
	includeZeroDelta = false,
): ModuleDelta[] {
	const moduleMap = new Map<string, { totalDelta: number; count: number }>()

	for (const [ep, currentSize] of comparison.current) {
		const baseSize = comparison.base.get(ep)
		const totalDelta = currentSize.bytes - (baseSize?.bytes ?? 0)
		if (totalDelta === 0 && !includeZeroDelta) continue
		const baseModules = baseSize?.modules ?? new Map<string, number>()

		for (const [mod, currentBytes] of currentSize.modules) {
			const baseBytes = baseModules.get(mod) ?? 0
			const delta = currentBytes - baseBytes
			if (delta !== 0) {
				const existing = moduleMap.get(mod)
				if (existing) {
					existing.totalDelta += delta
					existing.count += 1
				} else {
					moduleMap.set(mod, { totalDelta: delta, count: 1 })
				}
			}
		}
	}

	return Array.from(moduleMap.entries())
		.map(([module, { totalDelta, count }]) => ({
			module,
			deltaBytes: totalDelta,
			affectedFunctions: count,
		}))
		.sort((a, b) => Math.abs(b.deltaBytes) - Math.abs(a.deltaBytes))
		.slice(0, 10)
}

const green = (s: string): string => `\x1b[32m${s}\x1b[0m`
const red = (s: string): string => `\x1b[31m${s}\x1b[0m`
const dim = (s: string): string => `\x1b[2m${s}\x1b[0m`
const bold = (s: string): string => `\x1b[1m${s}\x1b[0m`
const cyan = (s: string): string => `\x1b[36m${s}\x1b[0m`

export function formatBytes(bytes: number): string {
	const abs = Math.abs(bytes)
	if (abs < 1024) return `${bytes} B`
	if (abs < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatDelta(bytes: number, percent: number): string {
	if (bytes === 0) return dim("no change")
	const sign = bytes > 0 ? "+" : ""
	const text = `${sign}${formatBytes(bytes)} (${sign}${percent.toFixed(1)}%)`
	return bytes > 0 ? red(text) : green(text)
}

export function formatTextReport(
	data: ReportData,
	options: ReportOptions,
): string {
	const lines: string[] = []

	lines.push(bold(`sls-bundle-analyser — ${data.directory}`))
	lines.push("=".repeat(40 + data.directory.length))
	lines.push(`Changed files: ${data.changedFiles}`)
	lines.push(
		`Affected functions: ${data.affectedFunctions} of ${data.totalFunctions}`,
	)
	lines.push("")

	const filtered =
		options.threshold > 0
			? data.functions.filter(
					(f) => Math.abs(f.deltaBytes) >= options.threshold,
				)
			: data.functions

	if (filtered.length === 0) {
		lines.push(dim("No significant bundle size changes."))
		return lines.join("\n")
	}

	// Table header
	const nameWidth = Math.max(30, ...filtered.map((f) => f.entryPoint.length))
	lines.push(
		`  ${"Function".padEnd(nameWidth)}  ${"Base".padStart(10)}  ${"Branch".padStart(10)}  Delta`,
	)
	lines.push(
		`  ${"─".repeat(nameWidth)}  ${"─".repeat(10)}  ${"─".repeat(10)}  ${"─".repeat(20)}`,
	)

	for (const fn of filtered) {
		let label = fn.entryPoint
		if (fn.isNew) label = `${label} ${cyan("[NEW]")}`
		if (fn.isRemoved) label = `${label} ${dim("[REMOVED]")}`

		const baseStr = fn.isNew ? dim("—") : formatBytes(fn.baseBytes).padStart(10)
		const currentStr = fn.isRemoved
			? dim("—")
			: formatBytes(fn.currentBytes).padStart(10)
		const deltaStr = fn.isNew
			? cyan(formatBytes(fn.currentBytes))
			: formatDelta(fn.deltaBytes, fn.deltaPercent)

		lines.push(
			`  ${label.padEnd(nameWidth)}  ${baseStr}  ${currentStr}  ${deltaStr}`,
		)
	}

	// Top growing modules
	if (data.topGrowingModules.length > 0) {
		lines.push("")
		lines.push(bold("Top changing modules:"))
		for (const mod of data.topGrowingModules.slice(0, 5)) {
			const sign = mod.deltaBytes > 0 ? "+" : ""
			const sizeStr = `${sign}${formatBytes(mod.deltaBytes)}`
			const colouredSize = mod.deltaBytes > 0 ? red(sizeStr) : green(sizeStr)
			lines.push(
				`  ${mod.module.padEnd(50)} ${colouredSize} (in ${mod.affectedFunctions} functions)`,
			)
		}
	}

	return lines.join("\n")
}

export function formatJsonReport(data: ReportData): string {
	return JSON.stringify(data, null, 2)
}
