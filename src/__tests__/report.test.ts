import { describe, expect, it } from "vitest"
import type { ComparisonResult } from "../compare.js"
import { buildReportData, computeModuleDeltas, formatBytes } from "../report.js"

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
})

describe("computeModuleDeltas", () => {
	it("aggregates module changes across functions", () => {
		const comparison: ComparisonResult = {
			current: new Map([
				[
					"src/a.ts",
					{
						bytes: 1000,
						modules: new Map([
							["node_modules/lodash/index.js", 500],
							["src/a.ts", 500],
						]),
					},
				],
				[
					"src/b.ts",
					{
						bytes: 1000,
						modules: new Map([["node_modules/lodash/index.js", 600]]),
					},
				],
			]),
			base: new Map([
				[
					"src/a.ts",
					{
						bytes: 800,
						modules: new Map([
							["node_modules/lodash/index.js", 400],
							["src/a.ts", 400],
						]),
					},
				],
				[
					"src/b.ts",
					{
						bytes: 900,
						modules: new Map([["node_modules/lodash/index.js", 500]]),
					},
				],
			]),
			newEntryPoints: new Set(),
			removedEntryPoints: new Set(),
		}

		const deltas = computeModuleDeltas(comparison)
		const lodash = deltas.find(
			(d) => d.module === "node_modules/lodash/index.js",
		)
		expect(lodash).toBeDefined()
		expect(lodash?.deltaBytes).toBe(200) // +100 from a, +100 from b
		expect(lodash?.affectedFunctions).toBe(2)
	})

	it("excludes modules with zero delta", () => {
		const comparison: ComparisonResult = {
			current: new Map([
				["src/a.ts", { bytes: 500, modules: new Map([["src/a.ts", 500]]) }],
			]),
			base: new Map([
				["src/a.ts", { bytes: 500, modules: new Map([["src/a.ts", 500]]) }],
			]),
			newEntryPoints: new Set(),
			removedEntryPoints: new Set(),
		}

		expect(computeModuleDeltas(comparison)).toEqual([])
	})

	it("limits to top 10", () => {
		const modules = new Map<string, number>()
		const baseModules = new Map<string, number>()
		for (let i = 0; i < 15; i++) {
			modules.set(`mod${i}`, 100 + i)
			baseModules.set(`mod${i}`, 50)
		}

		const comparison: ComparisonResult = {
			current: new Map([["src/a.ts", { bytes: 2000, modules }]]),
			base: new Map([["src/a.ts", { bytes: 1000, modules: baseModules }]]),
			newEntryPoints: new Set(),
			removedEntryPoints: new Set(),
		}

		expect(computeModuleDeltas(comparison)).toHaveLength(10)
	})
})
