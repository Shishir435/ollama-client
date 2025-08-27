import DOMPurify from "dompurify"
import html2pdf from "html2pdf.js"
import MarkdownIt from "markdown-it"
import container from "markdown-it-container"
import MarkdownItCopyCode from "markdown-it-copy-code"
import deflist from "markdown-it-deflist"
import { full as emoji } from "markdown-it-emoji"
import footnote from "markdown-it-footnote"
import markdownItMark from "markdown-it-mark"
import sub from "markdown-it-sub"
import sup from "markdown-it-sup"
import taskLists from "markdown-it-task-lists"

import { hljs } from "@/lib/hljs"
import type { ChatSession } from "@/types"

const createMarkdownParser = () => {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    highlight: (str, lang) => {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`
        } catch (__) {}
      }
      return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`
    }
  })

  md.use(taskLists, { enabled: true })
    .use(footnote)
    .use(container, "info")
    .use(container, "warning")
    .use(emoji)
    .use(MarkdownItCopyCode)
    .use(markdownItMark)
    .use(deflist)
    .use(sub)
    .use(sup)

  return md
}

const getPdfStyles = () => `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
  
  * {
    box-sizing: border-box;
  }
  
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    line-height: 1.6;
    color: #1f2937;
    background: #ffffff;
    margin: 0;
    padding: 20px;
    font-size: 14px;
  }
  
  .chat-container {
    max-width: 100%;
    margin: 0 auto;
  }
  
  .chat-title {
    font-size: 24px;
    font-weight: 700;
    color: #111827;
    margin-bottom: 30px;
    padding-bottom: 10px;
    border-bottom: 2px solid #e5e7eb;
  }
  
  .message {
    margin-bottom: 25px;
    page-break-inside: avoid;
  }
  
  .message-header {
    font-weight: 600;
    margin-bottom: 8px;
    font-size: 14px;
    color: #374151;
  }
  
  .user-message .message-header {
    color: #059669;
  }
  
  .ai-message .message-header {
    color: #7c3aed;
  }
  
  .message-content {
    padding: 15px;
    border-radius: 8px;
    background: #f9fafb;
    border-left: 4px solid #e5e7eb;
    font-size: 13px;
    line-height: 1.7;
  }
  
  .user-message .message-content {
    background: #ecfdf5;
    border-left-color: #059669;
  }
  
  .ai-message .message-content {
    background: #f5f3ff;
    border-left-color: #7c3aed;
  }
  
  /* Markdown content styles */
  .message-content h1,
  .message-content h2,
  .message-content h3,
  .message-content h4,
  .message-content h5,
  .message-content h6 {
    margin-top: 20px;
    margin-bottom: 10px;
    font-weight: 600;
    color: #111827;
    line-height: 1.4;
  }
  
  .message-content h1 { font-size: 20px; }
  .message-content h2 { font-size: 18px; }
  .message-content h3 { font-size: 16px; }
  .message-content h4 { font-size: 15px; }
  .message-content h5 { font-size: 14px; }
  .message-content h6 { font-size: 13px; }
  
  .message-content p {
    margin: 12px 0;
    line-height: 1.7;
  }
  
  .message-content ul,
  .message-content ol {
    margin: 12px 0;
    padding-left: 25px;
  }
  
  .message-content li {
    margin: 6px 0;
    line-height: 1.6;
  }
  
  .message-content blockquote {
    margin: 15px 0;
    padding: 10px 15px;
    border-left: 3px solid #d1d5db;
    background: #ffffff;
    font-style: italic;
    color: #6b7280;
  }
  
  .message-content code {
    font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
    background: #f3f4f6;
    padding: 2px 4px;
    border-radius: 3px;
    font-size: 12px;
    color: #dc2626;
  }
  
  .message-content pre {
    background: #1f2937;
    color: #f9fafb;
    padding: 15px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 15px 0;
    font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
    font-size: 11px;
    line-height: 1.5;
    page-break-inside: avoid;
  }
  
  .message-content pre code {
    background: none;
    color: inherit;
    padding: 0;
    font-size: inherit;
  }
  
  .message-content table {
    width: 100%;
    border-collapse: collapse;
    margin: 15px 0;
    font-size: 12px;
  }
  
  .message-content th,
  .message-content td {
    border: 1px solid #d1d5db;
    padding: 8px 12px;
    text-align: left;
  }
  
  .message-content th {
    background: #f3f4f6;
    font-weight: 600;
  }
  
  .message-content a {
    color: #2563eb;
    text-decoration: underline;
  }
  
  .message-content strong {
    font-weight: 600;
    color: #111827;
  }
  
  .message-content em {
    font-style: italic;
  }
  
  .message-content mark {
    background: #fef3c7;
    color: #92400e;
    padding: 1px 2px;
  }
  
  .message-content .task-list-item {
    list-style: none;
    margin-left: -20px;
  }
  
  .message-content .task-list-item input {
    margin-right: 8px;
  }
  
  .session-separator {
    margin: 40px 0;
    border: none;
    border-top: 2px solid #d1d5db;
    page-break-before: always;
  }
  
  /* Print optimizations */
  @media print {
    body {
      font-size: 12px;
      padding: 10px;
    }
    
    .message-content {
      page-break-inside: avoid;
    }
    
    .message-content pre {
      font-size: 10px;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
  }
</style>
`

const downloadFile = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const parseMessageContent = (content: string, md: MarkdownIt): string => {
  try {
    const rawHtml = md.render(content)
    const safeHtml = DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: [
        "p",
        "br",
        "strong",
        "em",
        "u",
        "strike",
        "code",
        "pre",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "ul",
        "ol",
        "li",
        "blockquote",
        "a",
        "img",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
        "div",
        "span",
        "mark",
        "sub",
        "sup",
        "del",
        "ins"
      ],
      ALLOWED_ATTR: [
        "href",
        "src",
        "alt",
        "title",
        "class",
        "id",
        "checked",
        "type"
      ]
    })
    return safeHtml
  } catch (error) {
    console.error("Error parsing markdown:", error)
    return md.utils.escapeHtml(content)
  }
}

export const useChatExport = () => {
  const md = createMarkdownParser()

  const exportSessionAsJson = (session: ChatSession) => {
    const blob = new Blob([JSON.stringify(session, null, 2)], {
      type: "application/json"
    })
    downloadFile(blob, `${session.title || "chat-session"}.json`)
  }

  const exportAllSessionsAsJson = (sessions: ChatSession[]) => {
    const blob = new Blob([JSON.stringify(sessions, null, 2)], {
      type: "application/json"
    })
    downloadFile(blob, "all-chat-sessions.json")
  }

  const exportSessionAsPdf = (session: ChatSession) => {
    const element = document.createElement("div")
    element.innerHTML = `
      ${getPdfStyles()}
      <div class="chat-container">
        <h1 class="chat-title">${session.title || "Chat Session"}</h1>
        ${session.messages
          .map(
            (msg) => `
            <div class="message ${msg.role === "user" ? "user-message" : "ai-message"}">
              <div class="message-header">${msg.role === "user" ? "You" : "AI Assistant"}</div>
              <div class="message-content">
                ${parseMessageContent(msg.content, md)}
              </div>
            </div>
            `
          )
          .join("")}
      </div>
    `

    html2pdf()
      .from(element)
      .set({
        margin: [15, 15, 15, 15],
        filename: `${session.title || "chat-session"}.pdf`,
        html2canvas: {
          scale: 2,
          useCORS: true,
          letterRendering: true,
          allowTaint: false
        },
        jsPDF: {
          unit: "mm",
          format: "a4",
          orientation: "portrait",
          compress: true
        },
        pagebreak: {
          mode: ["avoid-all", "css", "legacy"]
        }
      })
      .save()
  }

  const exportAllSessionsAsPdf = (sessions: ChatSession[]) => {
    const element = document.createElement("div")
    element.innerHTML = `
      ${getPdfStyles()}
      <div class="chat-container">
        <h1 class="chat-title">All Chat Sessions</h1>
        ${sessions
          .map(
            (session, index) => `
            ${index > 0 ? '<hr class="session-separator" />' : ""}
            <h2 class="chat-title">${session.title || `Chat Session ${index + 1}`}</h2>
            ${session.messages
              .map(
                (msg) => `
                <div class="message ${msg.role === "user" ? "user-message" : "ai-message"}">
                  <div class="message-header">${msg.role === "user" ? "You" : "AI Assistant"}</div>
                  <div class="message-content">
                    ${parseMessageContent(msg.content, md)}
                  </div>
                </div>
                `
              )
              .join("")}
            `
          )
          .join("")}
      </div>
    `

    html2pdf()
      .from(element)
      .set({
        margin: [15, 15, 15, 15],
        filename: "all-chat-sessions.pdf",
        html2canvas: {
          scale: 2,
          useCORS: true,
          letterRendering: true,
          allowTaint: false
        },
        jsPDF: {
          unit: "mm",
          format: "a4",
          orientation: "portrait",
          compress: true
        },
        pagebreak: {
          mode: ["avoid-all", "css", "legacy"]
        }
      })
      .save()
  }

  return {
    exportSessionAsJson,
    exportAllSessionsAsJson,
    exportSessionAsPdf,
    exportAllSessionsAsPdf
  }
}
