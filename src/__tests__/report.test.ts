import { describe, expect, it } from "vitest"
import type { ComparisonResult } from "../compare.js"
import { buildReportData, formatBytes } from "../report.js"

describe("formatBytes", () => {
	it("formats bytes", () => {
		expect(formatBytes(500)).toBe("500 B")
	})

	it("formats kilobytes", () => {
		expect(formatBytes(1024)).toBe("1.0 KB")
		expect(formatBytes(2560)).toBe("2.5 KB")
	})

	it("formats megabytes", () => {
		expect(formatBytes(1024 * 1024)).toBe("1.00 MB")
		expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.50 MB")
	})

	it("handles zero", () => {
		expect(formatBytes(0)).toBe("0 B")
	})

	it("handles negative values", () => {
		expect(formatBytes(-500)).toBe("-500 B")
		expect(formatBytes(-2560)).toBe("-2.5 KB")
	})
})

describe("buildReportData", () => {
	it("computes deltas for changed functions", () => {
		const comparison: ComparisonResult = {
			current: new Map([
				[
					"src/hello.ts",
					{ bytes: 1200, modules: new Map([["src/hello.ts", 1200]]) },
				],
			]),
			base: new Map([
				[
					"src/hello.ts",
					{ bytes: 1000, modules: new Map([["src/hello.ts", 1000]]) },
				],
			]),
			newEntryPoints: new Set(),
			removedEntryPoints: new Set(),
		}

		const data = buildReportData(comparison, 3, 10, process.cwd())
		expect(data.functions).toHaveLength(1)
		expect(data.functions[0].deltaBytes).toBe(200)
		expect(data.functions[0].deltaPercent).toBe(20)
		expect(data.changedFiles).toBe(3)
		expect(data.totalFunctions).toBe(10)
	})

	it("marks new entry points", () => {
		const comparison: ComparisonResult = {
			current: new Map([["src/new.ts", { bytes: 500, modules: new Map() }]]),
			base: new Map(),
			newEntryPoints: new Set(["src/new.ts"]),
			removedEntryPoints: new Set(),
		}

		const data = buildReportData(comparison, 1, 5, process.cwd())
		expect(data.functions[0].isNew).toBe(true)
		expect(data.functions[0].deltaPercent).toBe(0)
	})

	it("marks removed entry points", () => {
		const comparison: ComparisonResult = {
			current: new Map(),
			base: new Map([["src/old.ts", { bytes: 800, modules: new Map() }]]),
			newEntryPoints: new Set(),
			removedEntryPoints: new Set(["src/old.ts"]),
		}

		const data = buildReportData(comparison, 1, 5, process.cwd())
		expect(data.functions[0].isRemoved).toBe(true)
		expect(data.functions[0].deltaBytes).toBe(-800)
		expect(data.functions[0].deltaPercent).toBe(-100)
	})

	it("excludes zero-delta functions by default", () => {
		const comparison: ComparisonResult = {
			current: new Map([
				["src/changed.ts", { bytes: 1200, modules: new Map() }],
				["src/unchanged.ts", { bytes: 500, modules: new Map() }],
			]),
			base: new Map([
				["src/changed.ts", { bytes: 1000, modules: new Map() }],
				["src/unchanged.ts", { bytes: 500, modules: new Map() }],
			]),
			newEntryPoints: new Set(),
			removedEntryPoints: new Set(),
		}

		const data = buildReportData(comparison, 1, 5, process.cwd())
		expect(data.functions).toHaveLength(1)
		expect(data.functions[0].entryPoint).toBe("src/changed.ts")
		expect(data.affectedFunctions).toBe(1)
	})

	it("includes zero-delta functions when includeZeroDelta is true", () => {
		const comparison: ComparisonResult = {
			current: new Map([
				["src/changed.ts", { bytes: 1200, modules: new Map() }],
				["src/unchanged.ts", { bytes: 500, modules: new Map() }],
			]),
			base: new Map([
				["src/changed.ts", { bytes: 1000, modules: new Map() }],
				["src/unchanged.ts", { bytes: 500, modules: new Map() }],
			]),
			newEntryPoints: new Set(),
			removedEntryPoints: new Set(),
		}

		const data = buildReportData(comparison, 1, 5, process.cwd(), true)
		expect(data.functions).toHaveLength(2)
		expect(data.affectedFunctions).toBe(2)
	})

	it("sorts by absolute delta descending", () => {
		const comparison: ComparisonResult = {
			current: new Map([
				["src/small.ts", { bytes: 1010, modules: new Map() }],
				["src/big.ts", { bytes: 2000, modules: new Map() }],
			]),
			base: new Map([
				["src/small.ts", { bytes: 1000, modules: new Map() }],
				["src/big.ts", { bytes: 1000, modules: new Map() }],
			]),
			newEntryPoints: new Set(),
			removedEntryPoints: new Set(),
		}

		const data = buildReportData(comparison, 2, 5, process.cwd())
		expect(data.functions[0].entryPoint).toBe("src/big.ts")
		expect(data.functions[1].entryPoint).toBe("src/small.ts")
	})

	it("computes per-function module deltas with growth and shrinkage", () => {
		const comparison: ComparisonResult = {
			current: new Map([
				[
					"src/handler.ts",
					{
						bytes: 1500,
						modules: new Map([
							["src/handler.ts", 200],
							["node_modules/lodash/index.js", 800],
							["src/utils.ts", 500],
						]),
					},
				],
			]),
			base: new Map([
				[
					"src/handler.ts",
					{
						bytes: 1000,
						modules: new Map([
							["src/handler.ts", 200],
							["node_modules/lodash/index.js", 600],
							["src/old-util.ts", 200],
						]),
					},
				],
			]),
			newEntryPoints: new Set(),
			removedEntryPoints: new Set(),
		}

		const data = buildReportData(comparison, 1, 5, process.cwd())
		const fn = data.functions[0]
		expect(fn.moduleDeltas).toHaveLength(3)

		// Sorted by absolute delta descending
		// src/utils.ts: +500 (new module), lodash: +200, src/old-util.ts: -200
		expect(fn.moduleDeltas[0]).toEqual({
			module: "src/utils.ts",
			currentBytes: 500,
			baseBytes: 0,
			deltaBytes: 500,
		})
		expect(fn.moduleDeltas[1].module).toBe("node_modules/lodash/index.js")
		expect(fn.moduleDeltas[1].deltaBytes).toBe(200)

		// src/old-util.ts was removed
		const removed = fn.moduleDeltas.find((m) => m.module === "src/old-util.ts")
		expect(removed).toEqual({
			module: "src/old-util.ts",
			currentBytes: 0,
			baseBytes: 200,
			deltaBytes: -200,
		})
	})

	it("includes all modules with baseBytes 0 for new functions", () => {
		const comparison: ComparisonResult = {
			current: new Map([
				[
					"src/new.ts",
					{
						bytes: 1000,
						modules: new Map([
							["src/new.ts", 300],
							["src/dep.ts", 700],
						]),
					},
				],
			]),
			base: new Map(),
			newEntryPoints: new Set(["src/new.ts"]),
			removedEntryPoints: new Set(),
		}

		const data = buildReportData(comparison, 1, 5, process.cwd())
		const fn = data.functions[0]
		expect(fn.isNew).toBe(true)
		expect(fn.moduleDeltas).toHaveLength(2)
		for (const mod of fn.moduleDeltas) {
			expect(mod.baseBytes).toBe(0)
			expect(mod.deltaBytes).toBe(mod.currentBytes)
		}
	})

	it("includes all modules with currentBytes 0 for removed functions", () => {
		const comparison: ComparisonResult = {
			current: new Map(),
			base: new Map([
				[
					"src/old.ts",
					{
						bytes: 800,
						modules: new Map([
							["src/old.ts", 300],
							["src/dep.ts", 500],
						]),
					},
				],
			]),
			newEntryPoints: new Set(),
			removedEntryPoints: new Set(["src/old.ts"]),
		}

		const data = buildReportData(comparison, 1, 5, process.cwd())
		const fn = data.functions[0]
		expect(fn.isRemoved).toBe(true)
		expect(fn.moduleDeltas).toHaveLength(2)
		for (const mod of fn.moduleDeltas) {
			expect(mod.currentBytes).toBe(0)
			expect(mod.deltaBytes).toBe(-mod.baseBytes)
		}
	})

	it("has empty moduleDeltas when no modules changed", () => {
		const comparison: ComparisonResult = {
			current: new Map([
				[
					"src/a.ts",
					{
						bytes: 1200,
						modules: new Map([
							["src/a.ts", 500],
							["src/shared.ts", 700],
						]),
					},
				],
			]),
			base: new Map([
				[
					"src/a.ts",
					{
						bytes: 1000,
						modules: new Map([
							["src/a.ts", 500],
							["src/shared.ts", 700],
						]),
					},
				],
			]),
			newEntryPoints: new Set(),
			removedEntryPoints: new Set(),
		}

		// Function has a delta (1200 - 1000 = 200) but individual module sizes didn't change
		// This can happen when esbuild reports different total bytes but same per-module breakdown
		const data = buildReportData(comparison, 1, 5, process.cwd())
		expect(data.functions[0].moduleDeltas).toEqual([])
	})
})
