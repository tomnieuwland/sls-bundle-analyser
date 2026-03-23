import { describe, expect, it } from "vitest"
import {
	extractFunctionFileRefs,
	extractHandlerLines,
	extractHandlerLinesFromJs,
	matchesAnyPattern,
} from "../parse-serverless.js"

describe("matchesAnyPattern", () => {
	it("matches exact filename", () => {
		expect(matchesAnyPattern("serverless.yml", ["serverless.yml"])).toBe(true)
	})

	it("matches wildcard pattern", () => {
		expect(matchesAnyPattern("serverless-api.yml", ["serverless-*.yml"])).toBe(
			true,
		)
	})

	it("does not match non-matching pattern", () => {
		expect(matchesAnyPattern("serverless.yml", ["other.yml"])).toBe(false)
	})

	it("matches question mark wildcard", () => {
		expect(matchesAnyPattern("serverless-a.yml", ["serverless-?.yml"])).toBe(
			true,
		)
		expect(matchesAnyPattern("serverless-ab.yml", ["serverless-?.yml"])).toBe(
			false,
		)
	})

	it("matches against multiple patterns", () => {
		expect(
			matchesAnyPattern("serverless-api.yml", ["nope.yml", "serverless-*.yml"]),
		).toBe(true)
	})

	it("returns false for empty patterns", () => {
		expect(matchesAnyPattern("serverless.yml", [])).toBe(false)
	})
})

describe("extractHandlerLines", () => {
	it("extracts handlers from a functions block", () => {
		const yaml = `
service: my-service

functions:
  hello:
    handler: src/handlers/hello.handler
  goodbye:
    handler: src/handlers/goodbye.main
`.trimStart()

		const result = extractHandlerLines(yaml)
		expect(result).toEqual([
			{ functionName: "hello", handlerPath: "src/handlers/hello.handler" },
			{ functionName: "goodbye", handlerPath: "src/handlers/goodbye.main" },
		])
	})

	it("skips variable-only handler references", () => {
		const yaml = `
functions:
  dynamic:
    handler: \${self:custom.handler}
  static:
    handler: src/handlers/static.handler
`.trimStart()

		const result = extractHandlerLines(yaml)
		expect(result).toEqual([
			{ functionName: "static", handlerPath: "src/handlers/static.handler" },
		])
	})

	it("stops at next top-level key", () => {
		const yaml = `
functions:
  hello:
    handler: src/handlers/hello.handler

resources:
  notAFunction:
    handler: src/should/not/match.handler
`.trimStart()

		const result = extractHandlerLines(yaml)
		expect(result).toHaveLength(1)
		expect(result[0].functionName).toBe("hello")
	})

	it("handles functions with extra properties", () => {
		const yaml = `
functions:
  hello:
    timeout: 30
    memorySize: 256
    handler: src/handlers/hello.handler
    events:
      - http:
          path: /hello
          method: get
`.trimStart()

		const result = extractHandlerLines(yaml)
		expect(result).toEqual([
			{ functionName: "hello", handlerPath: "src/handlers/hello.handler" },
		])
	})

	it("returns empty for content with no functions block", () => {
		const yaml = `
service: my-service
provider:
  name: aws
`.trimStart()

		expect(extractHandlerLines(yaml)).toEqual([])
	})
})

describe("extractHandlerLinesFromJs", () => {
	it("extracts handlers from JS config", () => {
		const js = `
module.exports = {
  functions: {
    hello: {
      handler: 'src/handlers/hello.handler',
      timeout: 30,
    },
    goodbye: {
      handler: "src/handlers/goodbye.main",
    },
  },
}
`.trimStart()

		const result = extractHandlerLinesFromJs(js)
		expect(result).toEqual([
			{ functionName: "hello", handlerPath: "src/handlers/hello.handler" },
			{ functionName: "goodbye", handlerPath: "src/handlers/goodbye.main" },
		])
	})

	it("handles quoted function keys", () => {
		const js = `
module.exports = {
  functions: {
    'my-function': {
      handler: 'src/handlers/my-function.handler',
    },
  },
}
`.trimStart()

		const result = extractHandlerLinesFromJs(js)
		expect(result).toEqual([
			{
				functionName: "my-function",
				handlerPath: "src/handlers/my-function.handler",
			},
		])
	})

	it("skips variable references", () => {
		const js = `
module.exports = {
  functions: {
    dynamic: {
      handler: '\${self:custom.handler}',
    },
  },
}
`.trimStart()

		expect(extractHandlerLinesFromJs(js)).toEqual([])
	})
})

describe("extractFunctionFileRefs", () => {
	it("extracts top-level file reference", () => {
		const yaml = `functions: \${file(./functions.yml):functions}`

		const result = extractFunctionFileRefs(yaml, "/project/serverless.yml")
		expect(result).toContain("/project/functions.yml")
	})

	it("extracts inline file references", () => {
		const yaml = `
functions:
  \${file(./api-functions.yml)}
  \${file(./worker-functions.yml)}
`.trimStart()

		const result = extractFunctionFileRefs(yaml, "/project/serverless.yml")
		expect(result).toContain("/project/api-functions.yml")
		expect(result).toContain("/project/worker-functions.yml")
	})

	it("returns empty when no file refs", () => {
		const yaml = `
functions:
  hello:
    handler: src/hello.handler
`.trimStart()

		expect(extractFunctionFileRefs(yaml, "/project/serverless.yml")).toEqual([])
	})
})
