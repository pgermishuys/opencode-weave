const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "node",
  format: "esm",
  external: ["@opencode-ai/plugin", "@opencode-ai/sdk", "zod", "jsonc-parser", "picocolors"],
  minify: false,
})

if (!result.success) {
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

console.log("Build succeeded:", result.outputs.map(o => o.path))
