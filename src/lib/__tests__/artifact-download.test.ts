import { beforeEach, describe, expect, it, vi } from "vitest"
import { artifactFileName, downloadArtifact } from "@/lib/artifact-download"
import type { ChatArtifact } from "@/lib/artifacts"

const download = vi.fn()
const hasPermission = vi.fn()
const requestPermission = vi.fn()
const downloadFile = vi.fn()

vi.mock("@/lib/browser-api", () => ({
  browser: {
    downloads: {
      download: (...args: unknown[]) => download(...args)
    }
  }
}))

vi.mock("@/lib/permissions", () => ({
  hasPermission: (...args: unknown[]) => hasPermission(...args),
  requestPermission: (...args: unknown[]) => requestPermission(...args)
}))

vi.mock("@/lib/exporters/utils", () => ({
  downloadFile: (...args: unknown[]) => downloadFile(...args)
}))

const makeArtifact = (over: Partial<ChatArtifact> = {}): ChatArtifact => ({
  id: "code-1",
  kind: "code",
  language: "ts",
  title: "TS artifact 1",
  content: "const a = 1",
  renderable: false,
  ...over
})

beforeEach(() => {
  vi.clearAllMocks()
  global.URL.createObjectURL = vi.fn(() => "blob:fake")
  global.URL.revokeObjectURL = vi.fn()
})

describe("artifactFileName", () => {
  it("uses the kind extension for renderable artifacts", () => {
    expect(
      artifactFileName(makeArtifact({ kind: "html", title: "HTML artifact 2" }))
    ).toBe("html-artifact-2.html")
    expect(
      artifactFileName(makeArtifact({ kind: "svg", title: "SVG artifact 1" }))
    ).toBe("svg-artifact-1.svg")
    expect(
      artifactFileName(
        makeArtifact({ kind: "mermaid", title: "Mermaid diagram 1" })
      )
    ).toBe("mermaid-diagram-1.mmd")
  })

  it("maps code language to its file extension, falling back to txt", () => {
    expect(artifactFileName(makeArtifact({ language: "ts" }))).toBe(
      "ts-artifact-1.ts"
    )
    expect(
      artifactFileName(makeArtifact({ language: "python", title: "script" }))
    ).toBe("script.py")
    expect(
      artifactFileName(makeArtifact({ language: "brainfuck", title: "weird" }))
    ).toBe("weird.txt")
  })

  it("sanitizes the title into a safe base name", () => {
    expect(
      artifactFileName(makeArtifact({ title: "../../etc/passwd!!" }))
    ).toBe("etc-passwd.ts")
    expect(artifactFileName(makeArtifact({ title: "   " }))).toBe("artifact.ts")
  })

  it("does not leave a trailing dash when the 64-char slice lands on one", () => {
    const name = artifactFileName(
      makeArtifact({ title: `${"a".repeat(63)} tail` })
    )
    expect(name).toBe(`${"a".repeat(63)}.ts`)
    expect(name).not.toContain("-.")
  })
})

describe("downloadArtifact", () => {
  it("uses the downloads API when the permission is already granted", async () => {
    hasPermission.mockResolvedValue(true)
    download.mockResolvedValue(1)

    await downloadArtifact(makeArtifact())

    expect(requestPermission).not.toHaveBeenCalled()
    expect(download).toHaveBeenCalledWith({
      url: "blob:fake",
      filename: "ts-artifact-1.ts",
      saveAs: true
    })
    expect(downloadFile).not.toHaveBeenCalled()
  })

  it("requests the permission when it is not yet granted, then downloads", async () => {
    hasPermission.mockResolvedValue(false)
    requestPermission.mockResolvedValue(true)
    download.mockResolvedValue(1)

    await downloadArtifact(makeArtifact())

    expect(requestPermission).toHaveBeenCalledWith("downloads")
    expect(download).toHaveBeenCalledTimes(1)
    expect(downloadFile).not.toHaveBeenCalled()
  })

  it("falls back to anchor download when the permission is denied", async () => {
    hasPermission.mockResolvedValue(false)
    requestPermission.mockResolvedValue(false)

    await downloadArtifact(makeArtifact())

    expect(download).not.toHaveBeenCalled()
    expect(downloadFile).toHaveBeenCalledTimes(1)
    expect(downloadFile).toHaveBeenCalledWith(
      expect.any(Blob),
      "ts-artifact-1.ts"
    )
  })

  it("falls back to anchor download when the downloads API throws", async () => {
    hasPermission.mockResolvedValue(true)
    download.mockRejectedValue(new Error("disk full"))

    await downloadArtifact(makeArtifact())

    expect(downloadFile).toHaveBeenCalledTimes(1)
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake")
  })
})
