import { describe, expect, it } from "vitest"
import { extractPackageName } from "../shared-modules.js"

describe("extractPackageName", () => {
	it("extracts regular package name", () => {
		expect(extractPackageName("node_modules/lodash/index.js")).toBe("lodash")
	})

	it("extracts scoped package name", () => {
		expect(
			extractPackageName("node_modules/@aws-sdk/client-s3/dist/index.js"),
		).toBe("@aws-sdk/client-s3")
	})

	it("returns null for non-node_modules paths", () => {
		expect(extractPackageName("src/handlers/hello.ts")).toBeNull()
	})

	it("handles nested node_modules", () => {
		expect(
			extractPackageName("node_modules/foo/node_modules/bar/index.js"),
		).toBe("bar")
	})

	it("handles package with no subpath", () => {
		expect(extractPackageName("node_modules/lodash")).toBe("lodash")
	})

	it("returns null for incomplete scoped package", () => {
		expect(extractPackageName("node_modules/@scope")).toBeNull()
	})
})
