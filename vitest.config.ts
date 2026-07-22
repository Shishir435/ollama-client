import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

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
          maxWorkers: 6,
          vmMemoryLimit: "256MB",
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
          exclude: THREAD_TEST_PATTERNS
        }
      },
      {
        extends: true,
        test: {
          name: "persistence",
          pool: "threads",
          maxWorkers: 6,
          include: THREAD_TEST_PATTERNS
        }
      }
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/**/*.d.ts",
        "src/lib/lucide-icon.ts"
      ]
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  }
})
