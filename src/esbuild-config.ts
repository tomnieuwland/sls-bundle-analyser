import type { BuildOptions } from "esbuild"
import type { BundleAnalyserConfig } from "./config.js"

export function buildEsbuildOptions(
	entryPoints: Record<string, string>,
	config: BundleAnalyserConfig,
): BuildOptions {
	return {
		entryPoints,
		bundle: true,
		minify: true,
		platform: "node",
		target: "node20",
		format: "cjs",
		sourcemap: false,
		metafile: true,
		write: false,
		outdir: "dist",
		logLevel: "silent",
		...config.esbuild,
	}
}
