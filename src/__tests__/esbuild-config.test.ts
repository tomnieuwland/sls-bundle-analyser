import { describe, expect, it } from "vitest"
import { buildEsbuildOptions } from "../esbuild-config.js"

describe("buildEsbuildOptions", () => {
	it("returns default options", () => {
		const result = buildEsbuildOptions(
			{ entry: "src/hello.ts" },
			{ base: "main", exclude: [], esbuild: {} },
		)
		expect(result.bundle).toBe(true)
		expect(result.minify).toBe(true)
		expect(result.platform).toBe("node")
		expect(result.target).toBe("node20")
		expect(result.format).toBe("cjs")
		expect(result.metafile).toBe(true)
		expect(result.write).toBe(false)
		expect(result.entryPoints).toEqual({ entry: "src/hello.ts" })
	})

	it("merges user esbuild config", () => {
		const result = buildEsbuildOptions(
			{ entry: "src/hello.ts" },
			{
				base: "main",
				exclude: [],
				esbuild: { target: "node18", external: ["aws-sdk"] },
			},
		)
		expect(result.target).toBe("node18")
		expect(result.external).toEqual(["aws-sdk"])
		expect(result.bundle).toBe(true) // defaults preserved
	})

	it("allows overriding any default", () => {
		const result = buildEsbuildOptions(
			{},
			{ base: "main", exclude: [], esbuild: { minify: false } },
		)
		expect(result.minify).toBe(false)
	})
})
