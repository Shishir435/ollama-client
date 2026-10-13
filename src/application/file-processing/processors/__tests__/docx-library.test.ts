import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const require = createRequire(import.meta.url)
const mammoth = require("mammoth") as typeof import("mammoth")
const JSZip = require("jszip") as typeof import("jszip")
const converterOptions = {
  encoding: "utf8",
  timeout: 4_000,
  killSignal: "SIGKILL"
} as const

const document = async () => {
  const zip = new JSZip()
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>`
  )
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`
  )
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body><w:p><w:r><w:t>Security update DOCX fixture</w:t></w:r></w:p></w:body>
    </w:document>`
  )
  return zip.generateAsync({ type: "nodebuffer" })
}

describe("Mammoth dependency compatibility", () => {
  it("bounds the blocking CLI call below Vitest's test deadline", () => {
    expect(converterOptions).toMatchObject({
      timeout: 4_000,
      killSignal: "SIGKILL"
    })
  })
  it("uses an argparse version without sprintf-js", () => {
    const fromMammoth = createRequire(require.resolve("mammoth"))
    const parser = fromMammoth("argparse/package.json")
    expect(parser.version).toBe("2.0.1")
    expect(parser.dependencies?.["sprintf-js"]).toBeUndefined()
  })

  it("extracts text and HTML using the real library, without mocks", async () => {
    const buffer = await document()
    expect((await mammoth.extractRawText({ buffer })).value).toBe(
      "Security update DOCX fixture\n\n"
    )
    expect((await mammoth.convertToHtml({ buffer })).value).toBe(
      "<p>Security update DOCX fixture</p>"
    )
  })

  it("preserves the command-line converter with argparse v2", async () => {
    const directory = mkdtempSync(join(tmpdir(), "olc-docx-"))
    try {
      const path = join(directory, "fixture.docx")
      writeFileSync(path, await document())
      const result = spawnSync(
        process.execPath,
        [require.resolve("mammoth/bin/mammoth"), path],
        converterOptions
      )
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout.trim()).toBe("<p>Security update DOCX fixture</p>")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
