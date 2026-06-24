import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  hasPermission: vi.fn()
}))

vi.mock("@/lib/browser-api", () => ({
  browser: {
    downloads: {
      download: (...args: unknown[]) => mocks.download(...args)
    }
  }
}))

vi.mock("@/lib/permissions", () => ({
  hasPermission: mocks.hasPermission
}))

import {
  runSaveArtifact,
  sanitizeArtifactFilename
} from "../save-artifact-tool"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.hasPermission.mockResolvedValue(true)
  mocks.download.mockResolvedValue(7)
})

describe("sanitizeArtifactFilename", () => {
  it("strips path segments and keeps the basename", () => {
    expect(sanitizeArtifactFilename("../../etc/passwd")).toBe("passwd.txt")
    expect(sanitizeArtifactFilename("a/b/c/report.md")).toBe("report.md")
  })

  it("replaces illegal characters and trims dangling separators", () => {
    expect(sanitizeArtifactFilename("my report!! .md")).toBe("my-report-.md")
    expect(sanitizeArtifactFilename("weird***name")).toBe("weird-name.txt")
  })

  it("appends .txt when no extension is present", () => {
    expect(sanitizeArtifactFilename("notes")).toBe("notes.txt")
  })

  it("falls back to a default when nothing usable remains", () => {
    expect(sanitizeArtifactFilename("")).toBe("artifact.txt")
    expect(sanitizeArtifactFilename("///")).toBe("artifact.txt")
  })
})

describe("save_artifact tool", () => {
  it("rejects empty content without touching downloads", async () => {
    const result = await runSaveArtifact({ filename: "x.txt", content: "" }, {})
    expect(result.isError).toBe(true)
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it("errors with guidance when the downloads permission is missing", async () => {
    mocks.hasPermission.mockResolvedValue(false)
    const result = await runSaveArtifact(
      { filename: "report.md", content: "# Hi" },
      {}
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain("Downloads permission is required")
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it("saves via a data URL with the right MIME and a Save-As dialog", async () => {
    const result = await runSaveArtifact(
      { filename: "report.md", content: "# Title" },
      {}
    )
    expect(result.isError).toBeUndefined()
    expect(mocks.download).toHaveBeenCalledTimes(1)
    const arg = mocks.download.mock.calls[0][0] as {
      url: string
      filename: string
      saveAs: boolean
    }
    expect(arg.filename).toBe("report.md")
    expect(arg.saveAs).toBe(true)
    expect(arg.url.startsWith("data:text/markdown;charset=utf-8,")).toBe(true)
    expect(decodeURIComponent(arg.url.split(",")[1])).toBe("# Title")
  })

  it("sanitizes a path-laden filename before saving", async () => {
    await runSaveArtifact({ filename: "../secret/out.json", content: "{}" }, {})
    const arg = mocks.download.mock.calls[0][0] as {
      filename: string
      url: string
    }
    expect(arg.filename).toBe("out.json")
    expect(arg.url.startsWith("data:application/json")).toBe(true)
  })

  it("reports a canceled Save dialog as an error", async () => {
    mocks.download.mockResolvedValue(undefined)
    const result = await runSaveArtifact(
      { filename: "x.txt", content: "data" },
      {}
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain("canceled")
  })

  it("reports a download rejection as an error", async () => {
    mocks.download.mockRejectedValue(
      new Error("Download canceled by the user.")
    )
    const result = await runSaveArtifact(
      { filename: "x.txt", content: "data" },
      {}
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain("Could not save file")
  })
})
