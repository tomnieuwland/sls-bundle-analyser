# sls-bundle-analyser

CLI tool for analysing Lambda bundle sizes in Serverless Framework projects. It parses `serverless*.yml` files to discover handler entry points, bundles them with esbuild, and reports on size changes between branches.

To get started, run `npx @tomnieuwland/sls-bundle-analyser sizes` in the root of your project.

## Commands

### `sls-bundle-analyser compare`

Compares bundle sizes between the current branch and a base branch. Builds a dependency graph to determine which functions are affected by code changes, then reports size deltas.

| Flag                   | Description                                                                     |
| ---------------------- | ------------------------------------------------------------------------------- |
| `--base <branch>`      | Base branch to compare against (default: from config or `main`)                 |
| `--all`                | Analyze all functions, not just those affected by changes                       |
| `--verbose`            | Show per-module breakdown for each function                                     |
| `--json`               | Output raw JSON instead of a text table                                         |
| `--threshold <bytes>`  | Only show functions with delta above this threshold                             |
| `--fail-above <bytes>` | Exit with code 1 if any function grew more than this many bytes (useful for CI) |
| `--include-zero-delta` | Include functions whose total bundle size did not change                         |

### `sls-bundle-analyser sizes`

Bundles all discovered functions and reports their sizes. No branch comparison — just a snapshot of current bundle sizes.

| Flag             | Description                                           |
| ---------------- | ----------------------------------------------------- |
| `--json`         | Output raw JSON                                       |
| `--sort <field>` | Sort order: `size` (default, largest first) or `name` |

### `sls-bundle-analyser visualize <entry-point>`

Generates an interactive treemap (or sunburst/network diagram) for a single handler's bundle and opens it in the browser.

| Flag                | Description                                                                  |
| ------------------- | ---------------------------------------------------------------------------- |
| `--template <type>` | Visualization type: `treemap`, `sunburst`, or `network` (default: `treemap`) |
| `--no-third-party`  | Exclude `node_modules` from the visualization                                |
| `--no-open`         | Generate the file without opening it in the browser                          |
| `--top <n>`         | Show only the N largest modules                                              |
| `--output <path>`   | Write HTML to this path instead of opening in the browser                    |
| `--diff`            | Generate side-by-side visualizations comparing current branch against base   |
| `--base <branch>`   | Base branch for `--diff` (default: from config or `main`)                    |

### `sls-bundle-analyser shared-modules`

Analyses which `node_modules` packages are bundled across multiple Lambda functions, helping identify candidates for a shared layer.

| Flag        | Description                                 |
| ----------- | ------------------------------------------- |
| `--json`    | Output raw JSON instead of a text table     |
| `--top <n>` | Show only the top N modules (default: `20`) |

## Configuration

Configuration is loaded from the service directory (the directory you run the tool from). The tool checks two locations in order:

1. **`.bundle-analyser.json`** — a standalone config file in the service directory
2. **`package.json`** — a `"bundle-analyser"` key at the top level

If neither is found, defaults are used. All fields are optional.

```json
{
  "exclude": ["serverless.local-*.yml"],
  "base": "main",
  "esbuild": {}
}
```

### Fields

| Field     | Type       | Default                      | Description                                                                                                                                                                        |
| --------- | ---------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exclude` | `string[]` | `["serverless.local-*.yml"]` | Glob patterns for `serverless*.yml` files to skip. Useful for ignoring local dev overrides.                                                                                        |
| `base`    | `string`   | `"main"`                     | Default base branch for the `compare` and `visualize --diff` commands. Can be overridden per-invocation with `--base`.                                                             |
| `esbuild` | `object`   | `{}`                         | esbuild [BuildOptions](https://esbuild.github.io/api/#build) overrides merged on top of the built-in defaults (`bundle`, `minify`, `platform: "node"`, `target: "node20"`, `cjs`). |

### Example in `package.json`

```json
{
  "name": "my-service",
  "bundle-analyser": {
    "base": "develop",
    "exclude": ["serverless.local-*.yml", "serverless.test.yml"],
    "esbuild": {
      "external": ["aws-sdk"]
    }
  }
}
```

## Examples

```bash
# Compare affected functions against main
sls-bundle-analyser compare

# Compare all functions against a specific branch
sls-bundle-analyser compare --all --base feature-branch

# CI gate: fail if any function grew by more than 50KB
sls-bundle-analyser compare --all --fail-above 51200

# JSON output for scripting
sls-bundle-analyser compare --all --json

# Report all bundle sizes (no comparison)
sls-bundle-analyser sizes

# Bundle sizes sorted alphabetically, as JSON
sls-bundle-analyser sizes --sort name --json

# Visualize a single handler
sls-bundle-analyser visualize src/handlers/someHandler.ts

# Visualize only first-party code, top 10 modules, save to file
sls-bundle-analyser visualize src/handlers/someHandler.ts --no-third-party --top 10 --output report.html

# Side-by-side diff visualization against main
sls-bundle-analyser visualize src/handlers/someHandler.ts --diff

# Find most widely shared node_modules packages
sls-bundle-analyser shared-modules --top 10
```
