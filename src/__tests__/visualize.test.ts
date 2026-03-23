import type { Metafile } from "esbuild"
import { describe, expect, it } from "vitest"
import {
	filterThirdParty,
	filterTopModules,
	sanitizeForFilename,
} from "../visualize.js"

describe("sanitizeForFilename", () => {
	it("replaces slashes with dashes", () => {
		expect(sanitizeForFilename("src/handlers/hello.ts")).toBe(
			"src-handlers-hello",
		)
	})

	it("handles backslashes", () => {
		expect(sanitizeForFilename("src\\handlers\\hello.ts")).toBe(
			"src-handlers-hello",
		)
	})

	it("strips file extension", () => {
		expect(sanitizeForFilename("hello.ts")).toBe("hello")
	})

	it("handles paths with no extension", () => {
		expect(sanitizeForFilename("src/handlers/hello")).toBe("src-handlers-hello")
	})
})

describe("filterThirdParty", () => {
	const metafile: Metafile = {
		inputs: {
			"src/hello.ts": { bytes: 100, imports: [] },
			"node_modules/lodash/index.js": { bytes: 5000, imports: [] },
		},
		outputs: {
			"dist/hello.js": {
				bytes: 5100,
				entryPoint: "src/hello.ts",
				imports: [],
				exports: [],
				inputs: {
					"src/hello.ts": { bytesInOutput: 100 },
					"node_modules/lodash/index.js": { bytesInOutput: 5000 },
				},
			},
		},
	}

	it("removes node_modules from inputs", () => {
		const result = filterThirdParty(metafile)
		expect(Object.keys(result.inputs)).toEqual(["src/hello.ts"])
	})

	it("removes node_modules from output inputs", () => {
		const result = filterThirdParty(metafile)
		const output = result.outputs["dist/hello.js"]
		expect(Object.keys(output.inputs)).toEqual(["src/hello.ts"])
	})

	it("preserves non-node_modules entries", () => {
		const result = filterThirdParty(metafile)
		expect(result.inputs["src/hello.ts"].bytes).toBe(100)
	})
})

describe("filterTopModules", () => {
	const metafile: Metafile = {
		inputs: {
			"src/a.ts": { bytes: 100, imports: [] },
			"src/b.ts": { bytes: 200, imports: [] },
			"src/c.ts": { bytes: 300, imports: [] },
		},
		outputs: {
			"dist/out.js": {
				bytes: 600,
				entryPoint: "src/a.ts",
				imports: [],
				exports: [],
				inputs: {
					"src/a.ts": { bytesInOutput: 100 },
					"src/b.ts": { bytesInOutput: 200 },
					"src/c.ts": { bytesInOutput: 300 },
				},
			},
		},
	}

	it("keeps only top N modules by size", () => {
		const result = filterTopModules(metafile, 2)
		expect(Object.keys(result.inputs)).toHaveLength(2)
		expect(result.inputs["src/c.ts"]).toBeDefined()
		expect(result.inputs["src/b.ts"]).toBeDefined()
		expect(result.inputs["src/a.ts"]).toBeUndefined()
	})

	it("filters output inputs too", () => {
		const result = filterTopModules(metafile, 1)
		const output = result.outputs["dist/out.js"]
		expect(Object.keys(output.inputs)).toEqual(["src/c.ts"])
	})

	it("handles n larger than total modules", () => {
		const result = filterTopModules(metafile, 100)
		expect(Object.keys(result.inputs)).toHaveLength(3)
	})
})
