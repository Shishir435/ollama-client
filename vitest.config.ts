import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

const COVERAGE_MODE = process.argv.includes("--coverage")
const COVERAGE_TEST_TIMEOUT_MS = 30_000

const THREAD_TEST_PATTERNS = [
  "src/features/chat/hooks/__tests__/use-embedding-migration.test.ts",
  "src/lib/__tests__/backup-service.test.ts",
  "src/lib/persistence/**/__tests__/*.{test,spec}.{ts,tsx}",
  "src/lib/repositories/__tests__/{chat-history-facade,sqlite-chat-history}.test.ts",
  "src/lib/sqlite/**/__tests__/*.{test,spec}.{ts,tsx}",
  "src/lib/storage/__tests__/{backup-import-transaction,provider-migration}.test.ts"
]

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "happy-dom",
    setupFiles: ["./src/test/setup.ts"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit-vm",
          pool: "vmThreads",
          maxWorkers: COVERAGE_MODE ? 4 : 6,
          vmMemoryLimit: "256MB",
          testTimeout: COVERAGE_MODE ? COVERAGE_TEST_TIMEOUT_MS : 5_000,
          include: [
            "src/**/*.{test,spec}.{ts,tsx}",
            "config/**/*.{test,spec}.ts"
          ],
          exclude: THREAD_TEST_PATTERNS
        }
      },
      {
        extends: true,
        test: {
          name: "persistence",
          pool: "threads",
          maxWorkers: COVERAGE_MODE ? 4 : 6,
          testTimeout: COVERAGE_MODE ? COVERAGE_TEST_TIMEOUT_MS : 5_000,
          include: THREAD_TEST_PATTERNS
        }
      },
      {
        test: {
          name: "packages",
          environment: "node",
          maxWorkers: COVERAGE_MODE ? 4 : 6,
          testTimeout: COVERAGE_MODE ? COVERAGE_TEST_TIMEOUT_MS : 5_000,
          include: ["packages/*/src/**/*.test.ts"]
        }
      }
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: ["src/**/*.ts", "packages/*/src/**/*.ts"],
      exclude: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "packages/*/src/**/*.{test,spec}.{ts,tsx}",
        "src/**/*.d.ts",
        "packages/*/src/**/*.d.ts",
        // Browser composition roots are executed only inside packaged
        // extensions. Counting them as unit-test misses obscures the logic
        // coverage beneath them; the browser gates own these files instead.
        "src/entrypoints/**",
        "src/contents/index.ts",
        "src/contents/debug-init.ts",
        "src/lib/persistence/chat-db-worker.ts",
        "src/spike/**"
      ],
      thresholds: {
        branches: 67,
        functions: 75,
        lines: 80,
        statements: 78
      }
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  }
})
