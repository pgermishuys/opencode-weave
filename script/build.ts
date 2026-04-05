import { resolve } from "path"

// Resolve jsonc-parser to its ESM entry so Bun's bundler inlines the proper
// ES-module sources instead of the UMD build (which uses dynamic require() for
// submodules like ./impl/format that can't be bundled).
const jsoncParserEsm: import("bun").BunPlugin = {
  name: "jsonc-parser-esm",
  setup(build) {
    build.onResolve({ filter: /^jsonc-parser$/ }, () => ({
      path: resolve("node_modules/jsonc-parser/lib/esm/main.js"),
    }))
  },
}

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "node",
  format: "esm",
  external: ["@opencode-ai/plugin", "@opencode-ai/sdk", "zod", "picocolors"],
  plugins: [jsoncParserEsm],
  minify: false,
})

if (!result.success) {
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

console.log("Build succeeded:", result.outputs.map(o => o.path))
