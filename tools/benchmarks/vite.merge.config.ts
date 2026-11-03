import { defineConfig } from "vite"

/**
 * Bundles the benchmark merge into one Node file.
 *
 * The aggregate job used to check out, install every dependency and run the
 * merge through tsx, which was about forty seconds of setup for three seconds
 * of work. The merge reads only relative modules and Node built-ins, so the
 * build job bundles it once and the job that merges runs the file with no
 * install at all.
 */
export default defineConfig({
  logLevel: "warn",
  publicDir: false,
  ssr: { noExternal: true },
  build: {
    ssr: "tools/benchmarks/merge-agent-benchmark.ts",
    outDir: "artifacts/benchmark-merge",
    emptyOutDir: true,
    target: "node20",
    minify: false,
    rollupOptions: {
      output: { entryFileNames: "merge-agent-benchmark.mjs", format: "es" }
    }
  }
})
