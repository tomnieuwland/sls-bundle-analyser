import type { Metafile } from "esbuild"
import { describe, expect, it } from "vitest"
import { extractSizes } from "../compare.js"

describe("extractSizes", () => {
	it("extracts sizes from metafile outputs", () => {
		const metafile: Metafile = {
			inputs: {},
			outputs: {
				"dist/handler-a.js": {
					bytes: 1500,
					entryPoint: "src/handler-a.ts",
					imports: [],
					exports: [],
					inputs: {
						"src/handler-a.ts": { bytesInOutput: 500 },
						"node_modules/lodash/index.js": { bytesInOutput: 1000 },
					},
				},
			},
		}

		const sizes = extractSizes(metafile)
		expect(sizes.size).toBe(1)

		const entry = sizes.get("src/handler-a.ts")

		expect(entry?.bytes).toBe(1500)
		expect(entry?.modules.get("src/handler-a.ts")).toBe(500)
		expect(entry?.modules.get("node_modules/lodash/index.js")).toBe(1000)
	})

	it("handles multiple entry points", () => {
		const metafile: Metafile = {
			inputs: {},
			outputs: {
				"dist/a.js": {
					bytes: 100,
					entryPoint: "src/a.ts",
					imports: [],
					exports: [],
					inputs: { "src/a.ts": { bytesInOutput: 100 } },
				},
				"dist/b.js": {
					bytes: 200,
					entryPoint: "src/b.ts",
					imports: [],
					exports: [],
					inputs: { "src/b.ts": { bytesInOutput: 200 } },
				},
			},
		}

		const sizes = extractSizes(metafile)
		expect(sizes.size).toBe(2)

		const aSize = sizes.get("src/a.ts")
		const bSize = sizes.get("src/b.ts")

		if (!aSize || !bSize) {
			throw new Error("Missing expected entry in test")
		}

		expect(sizes.get("src/a.ts")?.bytes).toBe(100)
		expect(sizes.get("src/b.ts")?.bytes).toBe(200)
	})

	it("skips outputs without entryPoint", () => {
		const metafile: Metafile = {
			inputs: {},
			outputs: {
				"dist/chunk.js": {
					bytes: 100,
					imports: [],
					exports: [],
					inputs: { "src/foo.ts": { bytesInOutput: 100 } },
				},
			},
		}

		expect(extractSizes(metafile).size).toBe(0)
	})
})
