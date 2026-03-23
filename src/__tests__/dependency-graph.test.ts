import type { Metafile } from "esbuild"
import { describe, expect, it } from "vitest"
import { getAffectedEntryPoints, mergeReverseMap } from "../dependency-graph.js"

describe("mergeReverseMap", () => {
	it("builds reverse map from metafile", () => {
		const reverseMap = new Map<string, Set<string>>()
		const metafile: Metafile = {
			inputs: {},
			outputs: {
				"dist/handler-a.js": {
					bytes: 1000,
					entryPoint: "src/handler-a.ts",
					imports: [],
					exports: [],
					inputs: {
						"src/handler-a.ts": { bytesInOutput: 500 },
						"src/shared/utils.ts": { bytesInOutput: 300 },
						"src/shared/db.ts": { bytesInOutput: 200 },
					},
				},
				"dist/handler-b.js": {
					bytes: 800,
					entryPoint: "src/handler-b.ts",
					imports: [],
					exports: [],
					inputs: {
						"src/handler-b.ts": { bytesInOutput: 400 },
						"src/shared/utils.ts": { bytesInOutput: 400 },
					},
				},
			},
		}

		mergeReverseMap(reverseMap, metafile)

		expect(reverseMap.get("src/shared/utils.ts")).toEqual(
			new Set(["src/handler-a.ts", "src/handler-b.ts"]),
		)
		expect(reverseMap.get("src/shared/db.ts")).toEqual(
			new Set(["src/handler-a.ts"]),
		)
		expect(reverseMap.get("src/handler-a.ts")).toEqual(
			new Set(["src/handler-a.ts"]),
		)
	})

	it("merges into existing map", () => {
		const reverseMap = new Map<string, Set<string>>([
			["src/shared/utils.ts", new Set(["src/existing.ts"])],
		])

		const metafile: Metafile = {
			inputs: {},
			outputs: {
				"dist/new.js": {
					bytes: 100,
					entryPoint: "src/new.ts",
					imports: [],
					exports: [],
					inputs: {
						"src/shared/utils.ts": { bytesInOutput: 100 },
					},
				},
			},
		}

		mergeReverseMap(reverseMap, metafile)

		expect(reverseMap.get("src/shared/utils.ts")).toEqual(
			new Set(["src/existing.ts", "src/new.ts"]),
		)
	})

	it("skips outputs without entryPoint", () => {
		const reverseMap = new Map<string, Set<string>>()
		const metafile: Metafile = {
			inputs: {},
			outputs: {
				"dist/chunk-abc.js": {
					bytes: 100,
					imports: [],
					exports: [],
					inputs: { "src/foo.ts": { bytesInOutput: 100 } },
				},
			},
		}

		mergeReverseMap(reverseMap, metafile)
		expect(reverseMap.size).toBe(0)
	})
})

describe("getAffectedEntryPoints", () => {
	const reverseMap = new Map<string, Set<string>>([
		["src/shared/utils.ts", new Set(["src/handler-a.ts", "src/handler-b.ts"])],
		["src/shared/db.ts", new Set(["src/handler-a.ts"])],
		["src/handler-c.ts", new Set(["src/handler-c.ts"])],
	])

	it("returns entry points affected by changed files", () => {
		const affected = getAffectedEntryPoints(["src/shared/utils.ts"], reverseMap)
		expect(affected).toEqual(new Set(["src/handler-a.ts", "src/handler-b.ts"]))
	})

	it("unions results from multiple changed files", () => {
		const affected = getAffectedEntryPoints(
			["src/shared/utils.ts", "src/handler-c.ts"],
			reverseMap,
		)
		expect(affected).toEqual(
			new Set(["src/handler-a.ts", "src/handler-b.ts", "src/handler-c.ts"]),
		)
	})

	it("returns empty set for unrelated changes", () => {
		const affected = getAffectedEntryPoints(["src/unrelated.ts"], reverseMap)
		expect(affected.size).toBe(0)
	})

	it("returns empty set for empty input", () => {
		expect(getAffectedEntryPoints([], reverseMap).size).toBe(0)
	})
})
