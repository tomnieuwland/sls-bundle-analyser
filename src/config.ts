import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { BuildOptions } from "esbuild"

export interface BundleAnalyserConfig {
	/** Glob patterns for serverless files to exclude */
	exclude: string[]
	/** esbuild BuildOptions overrides merged with defaults */
	esbuild: Partial<BuildOptions>
	/** Base branch to compare against */
	base: string
}

const DEFAULT_CONFIG: BundleAnalyserConfig = {
	exclude: ["serverless.local-*.yml"],
	esbuild: {},
	base: "main",
}

export function loadConfig(cwd: string): BundleAnalyserConfig {
	const configPath = join(cwd, ".bundle-analyser.json")

	if (existsSync(configPath)) {
		const raw = JSON.parse(
			readFileSync(configPath, "utf-8"),
		) as Partial<BundleAnalyserConfig>
		return {
			exclude: raw.exclude ?? DEFAULT_CONFIG.exclude,
			esbuild: { ...DEFAULT_CONFIG.esbuild, ...raw.esbuild },
			base: raw.base ?? DEFAULT_CONFIG.base,
		}
	}

	const pkgPath = join(cwd, "package.json")
	if (existsSync(pkgPath)) {
		const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<
			string,
			unknown
		>
		const raw = pkg["bundle-analyser"] as
			| Partial<BundleAnalyserConfig>
			| undefined
		if (raw) {
			return {
				exclude: raw.exclude ?? DEFAULT_CONFIG.exclude,
				esbuild: { ...DEFAULT_CONFIG.esbuild, ...raw.esbuild },
				base: raw.base ?? DEFAULT_CONFIG.base,
			}
		}
	}

	return { ...DEFAULT_CONFIG }
}
