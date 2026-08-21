import { chmodSync, copyFileSync, mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"
import { resolveConfig } from "../../../config.js"
import { createCodexBackend } from "../index.js"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe("Codex backend", () => {
  it("streams a turn across an App Server dynamic-tool suspension", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "olc-codex-test-"))
    temporaryDirectories.push(directory)
    const executable = path.join(directory, "codex")
    copyFileSync(
      fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url)),
      executable
    )
    chmodSync(executable, 0o755)

    let suspend = () => {}
    let releaseToolResult: ((output: string) => void) | undefined
    const callClientTool = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          releaseToolResult = resolve
          suspend()
        })
    )
    const backend = createCodexBackend({
      config: resolveConfig({ REQUEST_TIMEOUT_MS: 5_000 }),
      options: {
        CODEX_PATH: executable,
        CODEX_PROJECT_DIR: path.join(directory, "workspace")
      },
      fileOptions: {},
      log: vi.fn(),
      retryAsync: (operation) => operation(),
      callClientTool
    })

    try {
      expect(await backend.listModels()).toMatchObject([
        {
          id: "codex/fake-codex",
          capabilities: {
            function_calling: true,
            vision: true,
            reasoning: true
          }
        }
      ])
      expect(await backend.resolveModel(undefined)).toEqual({
        providerId: "codex",
        modelId: "fake-codex"
      })

      const turn = await backend.startTurn({
        requestId: "request-1",
        model: { providerId: "codex", modelId: "fake-codex" },
        messages: [
          { role: "system", content: "Stay concise" },
          { role: "user", content: "Use lookup" }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "lookup",
              description: "Look up an answer",
              parameters: { type: "object" }
            }
          }
        ]
      })
      const suspended = new Promise<void>((resolve) => {
        suspend = resolve
      })
      const text: string[] = []
      const reasoning: string[] = []
      const handlers = {
        onText: (delta: string) => text.push(delta),
        onReasoning: (delta: string) => reasoning.push(delta)
      }

      expect(
        await turn.run(handlers, {
          suspended,
          hasUnannouncedToolCalls: () => true
        })
      ).toEqual({ status: "suspended" })
      expect(callClientTool).toHaveBeenCalledWith(
        expect.objectContaining({
          turnId: "thread-1",
          tool: "lookup",
          args: { query: "answer" }
        })
      )

      const outcome = await turn.resume([], handlers, {
        suspended: new Promise(() => {}),
        hasUnannouncedToolCalls: () => false,
        releaseToolResults: () => releaseToolResult?.("42")
      })
      expect(outcome).toEqual({
        status: "completed",
        content: "Result: 42",
        reasoning: "Checked. ",
        finish: "stop"
      })
      expect(text).toEqual(["Result: 42"])
      expect(reasoning).toEqual(["Checked. "])
      await turn.dispose()
    } finally {
      await backend.shutdown()
    }
  })
})
