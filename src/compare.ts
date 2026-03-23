import { execSync } from "node:child_process"
import { existsSync, mkdirSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { build, type Metafile } from "esbuild"
import type { BundleAnalyserConfig } from "./config.js"
import { buildEsbuildOptions } from "./esbuild-config.js"

export interface BundleSize {
	/** Total output bytes for this entry point */
	bytes: number
	/** Per-input-module sizes */
	modules: Map<string, number>
}

export interface ComparisonResult {
	/** Entry point key (relative path) -> sizes on current branch */
	current: Map<string, BundleSize>
	/** Entry point key (relative path) -> sizes on base branch (missing = new function) */
	base: Map<string, BundleSize>
	/** Entry points that exist on branch but not on base */
	newEntryPoints: Set<string>
	/** Entry points that exist on base but not on branch */
	removedEntryPoints: Set<string>
}

/**
 * Get files changed between the base branch and HEAD.
 * Returns paths relative to the repo root.
 */
export function getChangedFiles(base: string, repoRoot: string): string[] {
	try {
		const output = execSync(`git diff --name-only ${base}...HEAD`, {
			cwd: repoRoot,
			encoding: "utf-8",
		})
		return output
			.trim()
			.split("\n")
			.filter((f) => f.length > 0)
	} catch {
		// If the base branch doesn't exist or there's no common ancestor, return empty
		return []
	}
}

/**
 * Find the root of the git repository.
 */
export function getRepoRoot(cwd: string): string {
	return execSync("git rev-parse --show-toplevel", {
		cwd,
		encoding: "utf-8",
	}).trim()
}

const BATCH_SIZE = 10

/**
 * Bundle the specified entry points and return their sizes from the metafile.
 * Batches entry points to avoid overwhelming esbuild's IPC.
 */
export async function bundleAndMeasure(
	entryPoints: Record<string, string>,
	config: BundleAnalyserConfig,
	cwd: string,
): Promise<Map<string, BundleSize>> {
	const keys = Object.keys(entryPoints)
	if (keys.length === 0) {
		return new Map()
	}

	const allSizes = new Map<string, BundleSize>()

	for (let i = 0; i < keys.length; i += BATCH_SIZE) {
		const batchKeys = keys.slice(i, i + BATCH_SIZE)
		const batch: Record<string, string> = {}
		for (const key of batchKeys) {
			batch[key] = entryPoints[key]
		}

		const options = buildEsbuildOptions(batch, config)
		const result = await build({ ...options, absWorkingDir: cwd })

		if (!result.metafile) {
			throw new Error("esbuild did not produce a metafile")
		}

		for (const [k, v] of extractSizes(result.metafile)) {
			allSizes.set(k, v)
		}
	}

	return allSizes
}

export function extractSizes(metafile: Metafile): Map<string, BundleSize> {
	const sizes = new Map<string, BundleSize>()

	for (const [, outputMeta] of Object.entries(metafile.outputs)) {
		const { entryPoint } = outputMeta
		if (entryPoint) {
			const modules = new Map<string, number>()
			for (const [inputPath, inputMeta] of Object.entries(outputMeta.inputs)) {
				modules.set(inputPath, inputMeta.bytesInOutput)
			}

			sizes.set(entryPoint, { bytes: outputMeta.bytes, modules })
		}
	}

	return sizes
}

/**
 * Compare bundle sizes between the current branch and the base branch.
 *
 * Uses git worktree to checkout the base branch without disturbing the working directory.
 */
export async function compareBundles(
	affectedEntryPoints: Set<string>,
	config: BundleAnalyserConfig,
	cwd: string,
): Promise<ComparisonResult> {
	// Build entry points map for affected functions
	const entryPoints: Record<string, string> = {}
	for (const ep of affectedEntryPoints) {
		entryPoints[ep] = join(cwd, ep)
	}

	// Bundle on current branch
	const current = await bundleAndMeasure(entryPoints, config, cwd)

	// Bundle on base branch using git worktree
	const base = await bundleOnBase(affectedEntryPoints, config, cwd, config.base)

	// Determine new and removed entry points
	const newEntryPoints = new Set<string>()
	const removedEntryPoints = new Set<string>()

	for (const ep of current.keys()) {
		if (!base.has(ep)) newEntryPoints.add(ep)
	}
	for (const ep of base.keys()) {
		if (!current.has(ep)) removedEntryPoints.add(ep)
	}

	return { current, base, newEntryPoints, removedEntryPoints }
}

/**
 * Run a function against a git worktree checked out at the given branch.
 *
 * Creates a temporary worktree, symlinks node_modules, calls `fn` with the
 * worktree-equivalent of `cwd`, and cleans up afterwards.
 */
export async function withWorktree<T>(
	branch: string,
	cwd: string,
	fn: (worktreeCwd: string) => Promise<T>,
): Promise<T> {
	const repoRoot = getRepoRoot(cwd)
	const cwdRelative = relative(repoRoot, cwd)
	const worktreePath = join(tmpdir(), `sls-bundle-analyser-${Date.now()}`)

	try {
		execSync(`git worktree add "${worktreePath}" "${branch}" --detach`, {
			cwd: repoRoot,
			encoding: "utf-8",
			stdio: "pipe",
		})

		const worktreeCwd = join(worktreePath, cwdRelative)

		symlinkNodeModules(cwd, worktreeCwd, repoRoot, worktreePath)

		return await fn(worktreeCwd)
	} finally {
		try {
			execSync(`git worktree remove "${worktreePath}" --force`, {
				cwd: repoRoot,
				encoding: "utf-8",
				stdio: "pipe",
			})
		} catch {
			// Best effort cleanup
		}
	}
}

async function bundleOnBase(
	entryPoints: Set<string>,
	config: BundleAnalyserConfig,
	cwd: string,
	branch: string,
): Promise<Map<string, BundleSize>> {
	return withWorktree(branch, cwd, async (worktreeCwd) => {
		const worktreeEntryPoints: Record<string, string> = {}
		for (const ep of entryPoints) {
			const worktreeFile = join(worktreeCwd, ep)
			if (existsSync(worktreeFile)) {
				worktreeEntryPoints[ep] = worktreeFile
			}
		}

		return bundleAndMeasure(worktreeEntryPoints, config, worktreeCwd)
	})
}

/**
 * Symlink node_modules directories so the worktree can resolve dependencies
 * without running npm install.
 *
 * We symlink both the service-level node_modules and the repo root node_modules
 * since some packages may be hoisted.
 */
function symlinkNodeModules(
	cwd: string,
	worktreeCwd: string,
	repoRoot: string,
	worktreePath: string,
): void {
	// Service-level node_modules
	const srcModules = join(cwd, "node_modules")
	const destModules = join(worktreeCwd, "node_modules")
	if (existsSync(srcModules) && !existsSync(destModules)) {
		mkdirSync(dirname(destModules), { recursive: true })
		symlinkSync(srcModules, destModules, "dir")
	}

	// Root-level node_modules (for hoisted packages)
	const rootSrcModules = join(repoRoot, "node_modules")
	const rootDestModules = join(worktreePath, "node_modules")
	if (existsSync(rootSrcModules) && !existsSync(rootDestModules)) {
		symlinkSync(rootSrcModules, rootDestModules, "dir")
	}
}
