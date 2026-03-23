import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

export interface HandlerEntry {
	/** Absolute path to the handler source file */
	filePath: string
	/** Export name (e.g. "handler") */
	exportName: string
	/** Function names in serverless config that use this handler */
	functionNames: string[]
	/** Which serverless file defined this handler */
	serverlessFile: string
}

export interface ParseResult {
	/** Map of absolute file path -> handler entry (deduplicated by file) */
	entries: Map<string, HandlerEntry>
	/** Total number of function definitions (before deduplication) */
	totalFunctions: number
}

/**
 * Extract all Lambda handler entry points from serverless*.yml files in a directory.
 *
 * Uses regex-based extraction to avoid issues with Serverless Framework's
 * custom ${...} variable interpolation syntax that breaks standard YAML parsers.
 */
export function parseServerlessHandlers(
	cwd: string,
	excludePatterns: string[],
): ParseResult {
	const ymlFiles = findServerlessFiles(cwd, excludePatterns)
	const entries = new Map<string, HandlerEntry>()
	let totalFunctions = 0

	for (const ymlFile of ymlFiles) {
		const content = readFileSync(ymlFile, "utf-8")
		const handlers = extractHandlers(content, ymlFile, cwd)

		for (const handler of handlers) {
			totalFunctions += 1
			const existing = entries.get(handler.filePath)
			if (existing) {
				existing.functionNames.push(...handler.functionNames)
			} else {
				entries.set(handler.filePath, handler)
			}
		}
	}

	return { entries, totalFunctions }
}

function findServerlessFiles(cwd: string, excludePatterns: string[]): string[] {
	const files = readdirSync(cwd)
		.filter((f) => /^serverless.*\.(ya?ml|js)$/.test(f))
		.filter((f) => !matchesAnyPattern(f, excludePatterns))
		.map((f) => join(cwd, f))

	return files
}

export function matchesAnyPattern(
	filename: string,
	patterns: string[],
): boolean {
	return patterns.some((pattern) => {
		const regex = new RegExp(
			`^${pattern.replace(/\*/g, ".*").replace(/\?/g, ".")}$`,
		)
		return regex.test(filename)
	})
}

interface RawHandler {
	functionName: string
	handlerPath: string
}

function extractHandlers(
	content: string,
	serverlessFile: string,
	cwd: string,
): HandlerEntry[] {
	const results: HandlerEntry[] = []

	const isJs = serverlessFile.endsWith(".js")

	if (!isJs) {
		// Follow ${file(...)} references in YAML functions blocks
		const fileRefs = extractFunctionFileRefs(content, serverlessFile)
		for (const refFile of fileRefs) {
			if (existsSync(refFile)) {
				const refContent = readFileSync(refFile, "utf-8")
				const refHandlers = extractHandlerLines(refContent)
				for (const raw of refHandlers) {
					const entry = resolveHandler(raw, refFile, cwd)
					if (entry) results.push(entry)
				}
			}
		}
	}

	const handlers = isJs
		? extractHandlerLinesFromJs(content)
		: extractHandlerLines(content)
	for (const raw of handlers) {
		const entry = resolveHandler(raw, serverlessFile, cwd)
		if (entry) results.push(entry)
	}

	return results
}

/**
 * Extract handler: lines from YAML content.
 *
 * We look for lines matching the pattern:
 *   handler: src/path/to/file.exportName
 *
 * We track function names by looking for top-level keys under `functions:`
 * that are followed by a `handler:` property.
 */
export function extractHandlerLines(content: string): RawHandler[] {
	const results: RawHandler[] = []
	const lines = content.split("\n")

	let inFunctions = false
	let currentFunction: string | null = null

	for (const line of lines) {
		// Detect `functions:` block
		if (/^functions:\s*$/.test(line)) {
			inFunctions = true
		} else if (inFunctions && /^\S/.test(line) && !line.startsWith("#")) {
			// Exit functions block when we hit another top-level key
			inFunctions = false
			currentFunction = null
		} else if (inFunctions) {
			// Detect function name (indented once, not a comment)
			const funcMatch = line.match(/^ {2}(\w[\w-]*):\s*$/)
			if (funcMatch) {
				;[, currentFunction] = funcMatch
			} else {
				// Detect handler value
				const handlerMatch = line.match(/^\s+handler:\s+(.+)$/)
				if (handlerMatch && currentFunction) {
					const handlerPath = handlerMatch[1].trim()
					// Skip handlers that are purely variable references like ${self:...}
					if (!handlerPath.startsWith("${")) {
						results.push({ functionName: currentFunction, handlerPath })
					}
				}
			}
		}
	}

	return results
}

/**
 * Extract handler lines from JavaScript serverless config files.
 *
 * Scans for `handler: 'src/path/to/file.exportName'` patterns and looks
 * backwards from each match to find the enclosing function name key.
 */
export function extractHandlerLinesFromJs(content: string): RawHandler[] {
	const results: RawHandler[] = []
	const lines = content.split("\n")

	for (let i = 0; i < lines.length; i += 1) {
		const handlerMatch = lines[i].match(/handler:\s*['"]([^'"]+)['"]/)
		if (handlerMatch) {
			const handlerPath = handlerMatch[1]
			if (!handlerPath.startsWith("${")) {
				// Look backwards for the function name (nearest `key: {` pattern)
				let functionName = "unknown"
				for (let j = i - 1; j >= 0; j -= 1) {
					const keyMatch = lines[j].match(
						/^\s+(?:'([^']+)'|"([^"]+)"|(\w[\w-]*)):\s*\{/,
					)
					if (keyMatch) {
						functionName = keyMatch[1] ?? keyMatch[2] ?? keyMatch[3]
						break
					}
				}

				results.push({ functionName, handlerPath })
			}
		}
	}

	return results
}

/**
 * Find ${file(...)} references within the functions: block.
 * e.g. `functions: ${file(./some-other-file.yml):functions}`
 * or individual function definitions loaded via file()
 */
export function extractFunctionFileRefs(
	content: string,
	ymlFile: string,
): string[] {
	const refs: string[] = []
	const dir = join(ymlFile, "..")

	// Match `functions: ${file(path)}` or `functions: ${file(path):key}`
	const functionsFileMatch = content.match(
		/^functions:\s*\$\{file\(([^)]+)\)(?::[^}]*)?\}/m,
	)
	if (functionsFileMatch) {
		refs.push(resolve(dir, functionsFileMatch[1]))
	}

	// Also match inline file references within functions block
	const inlineFileRegex = /^\s+\$\{file\(([^)]+)\)(?::[^}]*)?\}/gm
	for (const match of content.matchAll(inlineFileRegex)) {
		refs.push(resolve(dir, match[1]))
	}

	return refs
}

function resolveHandler(
	raw: RawHandler,
	serverlessFile: string,
	cwd: string,
): HandlerEntry | null {
	// Handler format: "src/path/to/file.exportName"
	// Split on the last dot to separate file path from export name
	const lastDot = raw.handlerPath.lastIndexOf(".")
	if (lastDot === -1) return null

	const relativePath = raw.handlerPath.substring(0, lastDot)
	const exportName = raw.handlerPath.substring(lastDot + 1)

	// Try resolving as .ts, .js, /index.ts, /index.js
	const extensions = [".ts", ".js", "/index.ts", "/index.js"]
	for (const ext of extensions) {
		const fullPath = resolve(cwd, relativePath + ext)
		if (existsSync(fullPath)) {
			return {
				filePath: fullPath,
				exportName,
				functionNames: [raw.functionName],
				serverlessFile,
			}
		}
	}

	return null
}
