import type { TFunction } from "i18next"
import MarkdownIt from "markdown-it"
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

/** A `<` that opens a tag and is not escaped. */
const RAW_TAG = /(^|[^\\])<[a-z/!?]/i

describe("sanitizeMarkdownForExport", () => {
  it("escapes raw HTML to literal text, however its attributes are quoted", () => {
    const out = sanitizeMarkdownForExport(
      'Hello <script>alert(1)</script><strong onclick="x()">bold</strong> <img src=x onerror=alert(1) alt="<b>"> <a href="java&#x09;script:alert(1)">open</a>'
    )
    expect(out).not.toMatch(RAW_TAG)
    expect(out).toContain("\\<img src=x")
    expect(out).toContain("bold")
  })

  it("removes unsafe links and images but keeps their text", () => {
    const out = sanitizeMarkdownForExport(
      "[click <b>me</b>](javascript:alert(1)) and ![diagram](javascript:alert(2)) and [a](java&#x09;script:alert(3)) and [safe](https://example.com)"
    )
    expect(out).toContain("click \\<b>me\\</b>")
    expect(out).not.toMatch(/\]\(java/)
    expect(out).not.toMatch(RAW_TAG)
    expect(out).toContain("[safe](https://example.com)")
  })

  it("catches entity-encoded schemes and reference definitions", () => {
    const out = sanitizeMarkdownForExport(
      "[a](javascript&#58;alert(1)) [b][x]\n\n[x]: javascript:alert(2)\n[y]: <javascript:alert(3)>"
    )
    expect(out).not.toMatch(/javascript&#58;|\]: <?javascript/)
    expect(out).toContain("[b][x]")
  })

  it("blocks every form of remote image unless the user opted in", () => {
    const text = [
      "![a](//tracker.test/a.gif) ![b](https&#58;//tracker.test/b.gif)",
      "![c][r] ![d][] ![pixel]",
      "",
      "[r]: https://tracker.test/c.gif",
      "[pixel]: https://tracker.test/p.gif"
    ].join("\n")
    const blocked = sanitizeMarkdownForExport(text, {}, "Blocked")
    expect(blocked).toContain("[Blocked: tracker.test] [Blocked: tracker.test]")
    expect(blocked).toContain("\\![c][r] \\![d][] \\![pixel]")
    expect(sanitizeMarkdownForExport(text, { allowRemoteImages: true })).toBe(
      text
    )
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
      "Inline `<script>x</script>` and ``a ` <b>`` stay too.",
      "",
      "    <iframe src=a></iframe>"
    ].join("\n")
    expect(sanitizeMarkdownForExport(code)).toBe(code)
  })

  it("treats an unmatched backtick run as prose", () => {
    expect(
      sanitizeMarkdownForExport("``<img src=x onerror=alert(1)>`")
    ).not.toMatch(RAW_TAG)
  })

  it("keeps Markdown autolinks and plain angle brackets in prose", () => {
    const out = sanitizeMarkdownForExport(
      "See <https://example.com> or <me@example.com>; 1 < 2 and 3 > 2. <javascript:alert(1)>"
    )
    expect(out).toContain("<https://example.com>")
    expect(out).toContain("<me@example.com>")
    expect(out).toContain("1 < 2 and 3 > 2.")
    expect(out).toContain("\\<javascript:alert(1)>")
  })
})

describe("renderSessionMarkdown metadata", () => {
  it("escapes titles, names and sources, and keeps indented code indented", () => {
    const evil = "<img src=x onerror=alert(1)>"
    const markdown = renderSessionMarkdown(
      session(
        [
          message({
            role: "assistant",
            model: evil,
            content: "    <script>alert(1)</script>",
            attachments: [{ fileName: evil }] as never,
            metrics: {
              toolRuns: [
                {
                  toolId: "web_search",
                  status: "done",
                  startedAt: 1,
                  sources: [{ title: evil, url: "https://a.test/x)<b>" }]
                }
              ]
            } as never
          })
        ],
        { title: evil, modelId: evil }
      ),
      t
    )
    expect(markdown.replace("    <script>alert(1)</script>", "")).not.toMatch(
      RAW_TAG
    )
    expect(markdown).toContain("\n    <script>alert(1)</script>")
    expect(markdown).toContain("(https://a.test/x%29%3Cb%3E)")
  })
})

describe("renderSessionMarkdown second reading", () => {
  const render = (...contents: string[]) =>
    renderSessionMarkdown(
      session(contents.map((content, i) => message({ id: i + 1, content }))),
      t
    )
  /** What a CommonMark viewer would act on: HTML, script links, remote images. */
  const reader = new MarkdownIt({ html: true })
  reader.validateLink = () => true
  const active = (markdown: string) =>
    reader
      .parse(markdown, {})
      .flatMap((token) => [token, ...(token.children ?? [])])
      .filter(
        (token) =>
          token.type.startsWith("html") ||
          (token.type === "image" &&
            /tracker/.test(token.attrGet("src") ?? "")) ||
          /javascript/.test(token.attrGet("href") ?? "")
      )

  it.each([
    ["an escaped backtick", '\\`<img src="https://tracker.test/p">`'],
    ["an http image without slashes", "![p](https:tracker.test/p.gif)"],
    ["a nested link label", "[open [details]](javascript:alert(1))"],
    [
      "a reference destination on the next line",
      "[open][r]\n\n[r]:\n javascript:alert(1)"
    ]
  ])("leaves nothing active for %s", (_, content) => {
    expect(active(render(content))).toEqual([])
  })

  it("keeps data: and blob: links inactive, and data: images only", () => {
    const markdown = render(
      "[x](data:text/html;base64,PHNjcmlwdD4=) <data:text/html,hi> [y](blob:https://a/b) ![d](data:image/png;base64,AA)"
    )
    const hrefs = reader
      .parse(markdown, {})
      .flatMap((token) => token.children ?? [])
      .map((token) => token.attrGet("href") ?? token.attrGet("src"))
      .filter(Boolean)
    expect(hrefs).toEqual(["data:image/png;base64,AA"])
  })

  it("keeps one message's reference definition from linking another's text", () => {
    const markdown = render("[x]: https://evil.example/", "see [x] here")
    expect(
      reader
        .parse(markdown, {})
        .flatMap((token) => token.children ?? [])
        .some((token) => token.type === "link_open")
    ).toBe(false)
  })

  it("keeps a safe reference link that its own message defines", () => {
    const content = "Read [docs][r] and **this**.\n\n[r]: https://example.com"
    const markdown = render(content, "another answer")
    expect(markdown).toContain(content)
    expect(markdown).not.toContain("```")
    expect(
      reader
        .parse(markdown, {})
        .flatMap((token) => token.children ?? [])
        .filter((token) => token.type === "link_open")
        .map((token) => token.attrGet("href"))
    ).toEqual(["https://example.com"])
  })

  it("keeps a message literal when another message defines its label, not the definer", () => {
    const content = "[x][r]\n\n[r]: https://ok.example/"
    const markdown = render(content, "[y][r]")
    expect(markdown).toContain(`*\n\n${content}\n`)
    expect(markdown).toContain("```text\n[y][r]\n```")
  })

  it("escapes a tag that only looks like an email autolink", () => {
    expect(active(render("<img/src=x@b/onerror=alert(1)>"))).toEqual([])
    expect(render("<img/src=x@b/onerror=alert(1)>")).toContain("\\<img")
  })

  it("keeps an unclosed fence from swallowing the next message", () => {
    const markdown = render(
      "~~~\nexample",
      "~~~\n<img src=x onerror=alert(1)>\n~~~"
    )
    expect(active(markdown)).toEqual([])
    expect(markdown).toContain("<img src=x onerror=alert(1)>")
  })

  it("keeps ordinary Markdown as written", () => {
    const content =
      "**bold** [a](https://example.com) `<b>` and\n\n```\n<i>\n```"
    expect(render(content)).toContain(content)
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
