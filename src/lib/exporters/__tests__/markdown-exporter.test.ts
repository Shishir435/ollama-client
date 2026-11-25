import type { TFunction } from "i18next"
import { describe, expect, it, vi } from "vitest"
import type { ChatMessage, ChatSession } from "@/types"

const stored = vi.hoisted(() => new Map<string, unknown>())
vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: vi.fn(async (key: string) => stored.get(key))
}))
vi.mock("../utils", () => ({ downloadFile: vi.fn() }))

import { STORAGE_KEYS } from "@/lib/constants"
import {
  markdownExporter,
  renderSessionMarkdown,
  sanitizeMarkdownForExport
} from "../markdown-exporter"
import { downloadFile } from "../utils"

const t = ((key: string) => key) as unknown as TFunction

const message = (overrides: Partial<ChatMessage>): ChatMessage =>
  ({
    id: 1,
    role: "user",
    content: "",
    timestamp: Date.UTC(2026, 10, 24, 10, 15, 0),
    done: true,
    ...overrides
  }) as ChatMessage

const session = (messages: ChatMessage[], extra: Partial<ChatSession> = {}) =>
  ({
    id: "s1",
    title: "Trip planning",
    modelId: "qwen3:8b",
    createdAt: Date.UTC(2026, 10, 24, 10, 0, 0),
    updatedAt: Date.UTC(2026, 10, 24, 11, 0, 0),
    messages,
    ...extra
  }) as ChatSession

describe("renderSessionMarkdown", () => {
  it("writes the title, model, timestamps, roles and message text", () => {
    const markdown = renderSessionMarkdown(
      session([
        message({ id: 1, content: "Where should we go?" }),
        message({
          id: 2,
          parentId: 1,
          role: "assistant",
          model: "qwen3:8b",
          content: "**Lisbon** is lovely in May.",
          timestamp: Date.UTC(2026, 10, 24, 10, 16, 0)
        })
      ]),
      t
    )

    expect(markdown).toContain("# Trip planning")
    expect(markdown).toContain("- **sessions.export.md_model:** qwen3:8b")
    expect(markdown).toContain("2026-11-24 10:00:00 UTC")
    expect(markdown).toContain("## sessions.export.role_user")
    expect(markdown).toContain("## sessions.export.role_assistant (qwen3:8b)")
    expect(markdown).toContain("*2026-11-24 10:16:00 UTC*")
    expect(markdown).toContain("Where should we go?")
    expect(markdown).toContain("**Lisbon** is lovely in May.")
  })

  it("lists sources from tool runs, citations and retrieved context without excerpts", () => {
    const markdown = renderSessionMarkdown(
      session([
        message({
          id: 2,
          role: "assistant",
          content: "See below.",
          metrics: {
            toolRuns: [
              {
                toolId: "web_search",
                status: "done",
                startedAt: 1,
                sources: [
                  { title: "Lisbon guide", url: "https://example.com/lisbon" },
                  { title: "Unused", url: "https://example.com/x", used: false }
                ]
              }
            ],
            webCitations: [
              { url: "https://example.com/lisbon", title: "Lisbon guide" }
            ],
            ragSources: [
              {
                id: 1,
                title: "notes.pdf",
                content: "SECRET EXCERPT TEXT",
                score: 1
              }
            ]
          } as never
        })
      ]),
      t
    )

    expect(markdown).toContain("**sessions.export.md_sources:**")
    expect(markdown).toContain("- [Lisbon guide](https://example.com/lisbon)")
    expect(markdown.match(/Lisbon guide/g)).toHaveLength(1)
    expect(markdown).toContain("- notes.pdf")
    expect(markdown).not.toContain("Unused")
    expect(markdown).not.toContain("SECRET EXCERPT TEXT")
  })

  it("never exports reasoning, replay blocks, tool or system rows, or permission notices", () => {
    const markdown = renderSessionMarkdown(
      session([
        message({ id: 1, content: "question" }),
        message({
          id: 2,
          role: "assistant",
          content: "visible answer",
          thinking: "PRIVATE CHAIN OF THOUGHT",
          replayArtifact: {
            provider: "anthropic",
            blocks: [{ type: "thinking", signature: "OPAQUE-SIGNATURE" }]
          } as never
        }),
        message({ id: 3, role: "tool", content: "TOOL OUTPUT" }),
        message({ id: 4, role: "system", content: "SYSTEM PROMPT" }),
        message({
          id: 5,
          role: "assistant",
          content: "permission wording",
          metrics: { permissionNotice: { capabilityId: "history" } } as never
        })
      ]),
      t
    )

    expect(markdown).toContain("visible answer")
    for (const hidden of [
      "PRIVATE CHAIN OF THOUGHT",
      "OPAQUE-SIGNATURE",
      "TOOL OUTPUT",
      "SYSTEM PROMPT",
      "permission wording"
    ]) {
      expect(markdown).not.toContain(hidden)
    }
  })

  it("follows the active branch rather than every edited version", () => {
    const markdown = renderSessionMarkdown(
      session(
        [
          message({ id: 1, content: "root question" }),
          message({
            id: 2,
            parentId: 1,
            role: "assistant",
            content: "old reply"
          }),
          message({
            id: 3,
            parentId: 1,
            role: "assistant",
            content: "new reply"
          })
        ],
        { currentLeafId: 3 }
      ),
      t
    )

    expect(markdown).toContain("new reply")
    expect(markdown).not.toContain("old reply")
  })

  it("names attachments by file name only", () => {
    const markdown = renderSessionMarkdown(
      session([
        message({
          attachments: [
            {
              fileId: "f1",
              fileName: "report.pdf",
              fileType: "application/pdf",
              fileSize: 10,
              processedAt: 1,
              data: new Uint8Array([1, 2, 3])
            }
          ] as never,
          content: "see attached"
        })
      ]),
      t
    )

    expect(markdown).toContain("**sessions.export.md_attachments:** report.pdf")
  })
})

describe("sanitizeMarkdownForExport", () => {
  it("drops script, style and handler-bearing HTML but keeps allowed tags", () => {
    const out = sanitizeMarkdownForExport(
      'Hello <script>alert(1)</script><strong onclick="x()">bold</strong> <br> <iframe src="https://evil.test"></iframe>'
    )
    expect(out).not.toContain("script")
    expect(out).not.toContain("alert")
    expect(out).not.toContain("onclick")
    expect(out).not.toContain("iframe")
    expect(out).toContain("<strong>bold</strong>")
    expect(out).toContain("<br>")
  })

  it("removes javascript: links and images but keeps their text", () => {
    const out = sanitizeMarkdownForExport(
      "[click me](javascript:alert(1)) and ![diagram](javascript:alert(2)) and [safe](https://example.com)"
    )
    expect(out).toContain("click me")
    expect(out).not.toContain("javascript:")
    expect(out).toContain("[safe](https://example.com)")
  })

  it("catches entity-encoded schemes, reference definitions and reference images", () => {
    const out = sanitizeMarkdownForExport(
      "[a](javascript&#58;alert(1)) [b][x] ![c][y]\n\n[x]: javascript:alert(2)\n[y]: https://tracker.test/p.gif"
    )
    expect(out).not.toMatch(/javascript/)
    expect(out).toContain("[b][x] [c][y]")
    expect(out).toContain("[y]: https://tracker.test/p.gif")
  })

  it("blocks remote images unless the user opted in, and keeps data: images", () => {
    const text =
      "![pixel](https://tracker.test/p.gif) ![inline](data:image/png;base64,AAAA)"
    const blocked = sanitizeMarkdownForExport(text, {}, "Remote image blocked")
    expect(blocked).toContain("[Remote image blocked: tracker.test]")
    expect(blocked).not.toContain("https://tracker.test")
    expect(blocked).toContain("data:image/png;base64,AAAA")

    expect(
      sanitizeMarkdownForExport(text, { allowRemoteImages: true })
    ).toContain("![pixel](https://tracker.test/p.gif)")
  })

  it("leaves fenced code, indented code and inline code exactly as written", () => {
    const code = [
      "```html",
      "<script>alert(1)</script>",
      "![x](https://tracker.test/p.gif)",
      "```",
      "",
      "Inline `<script>x</script>` stays too.",
      "",
      "    <iframe src=a></iframe>"
    ].join("\n")
    expect(sanitizeMarkdownForExport(code)).toBe(code)
  })

  it("keeps Markdown autolinks and plain angle brackets in prose", () => {
    const out = sanitizeMarkdownForExport(
      "See <https://example.com> or <me@example.com>; 1 < 2 and 3 > 2. <javascript:alert(1)>"
    )
    expect(out).toContain("<https://example.com>")
    expect(out).toContain("<me@example.com>")
    expect(out).toContain("1 < 2 and 3 > 2.")
    expect(out).not.toContain("javascript:")
  })
})

describe("markdownExporter", () => {
  it("downloads a .md file and honours the remote-image opt-in setting", async () => {
    stored.set(STORAGE_KEYS.EXPORT.ALLOW_REMOTE_IMAGES, true)
    await markdownExporter.exportSession(
      session([message({ content: "![a](https://img.test/a.png)" })], {
        title: 'My: "chat"/1'
      }),
      t
    )

    const [blob, name] = vi.mocked(downloadFile).mock.calls[0]
    expect(name).toBe("My- -chat-1.md")
    expect(await blob.text()).toContain("![a](https://img.test/a.png)")
    stored.clear()
  })
})
