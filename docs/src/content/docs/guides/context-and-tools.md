---
title: Context, Images, and Tools
description: How Ollama Client adds files, images, tabs, selected text, and local tool calls to a chat turn.
---

Ollama Client has two ways to add context to a chat turn.

- **Explicit context**: you attach files or images, select tabs, or capture selected text before sending.
- **Tool-called context**: a tool-capable model asks the extension for context or web results while it is generating an answer.

Both paths run through the extension. What leaves the device depends on the provider endpoint you selected.

## Manual context

Manual context is best when you know exactly what the model should use.

| Context | How it is added | Notes |
|---|---|---|
| Files | Composer attachment button or drag/drop | Text is extracted, chunked, embedded, and available to RAG/file search. |
| Images | Composer attachment button, drag/drop, or paste | Enabled only for vision-capable models. PNG, JPEG, and WebP are supported. |
| Current tabs | Context tray in the composer | Selected tab text is injected into the prompt up to your configured context limit. |
| Selected text | Selection overlay or browser selection capture | Useful for short page snippets that should stay visible in the prompt. |

Manual context remains useful even with tool calling. It gives the user direct control and works with models that do not support tools.

## Tool-called context

When the selected model supports tool calling, the background worker can offer a small set of local tools. The model can call them when the prompt asks about browser or local context.

Examples:

- "What is this page about?"
- "Summarize the YouTube video I am watching."
- "Compare the open docs tabs."
- "Find where we discussed embedding limits."
- "Answer from my uploaded files."
- "Search the web for the latest release notes."

Page selections use an explicit handoff: highlight text and choose **Ask Ollama Client about this** from the context menu to place it in the sidebar composer. The temporary handoff is cleared after insertion; it is not a model-callable tool or a history of page selections.

Current internal tools:

| Tool | Reads |
|---|---|
| `current_tab` | The active tab's extracted text, including supported video transcripts. |
| `list_tabs` | Current readable tab ids, titles, and URLs. |
| `read_tab` | A specific readable tab by id or title/URL query. |
| `file_search` | Uploaded/indexed files. |
| `rag_search` | Local chat memory and indexed conversation context. |
| `web_search` | Current web results through the configured search provider. |

The tool loop is provider-agnostic. Ollama receives native tool definitions, while OpenAI-compatible providers receive OpenAI-style tool definitions.

## Web search

When configured and active, tool-capable models see one tool: `web_search({ query, count? })`. The selected backend remains a settings/runtime concern, so adding or removing a provider does not change the model-visible interface.

Supported search providers:

| Provider | Endpoint | Limit behavior |
|---|---|---|
| SearXNG | User-configured self-hosted endpoint, usually `http://localhost:8080` | Uses `pageno`; the extension can fetch 1-3 pages, de-dupe URLs, then cap results before returning them to the model. |
| Brave Search | `https://api.search.brave.com/res/v1/web/search` | Uses Brave's `count` query parameter. |
| Tavily | `https://api.tavily.com/search` | Uses Tavily's `max_results` request field. |
| Keenable | `https://api.keenable.ai/v1/search` | Uses `max_results`, `safety_mode` and `published_after`; needs an API key. Keenable logs queries, IP address and user agent by default, with no fixed retention period ([data privacy](https://docs.keenable.ai/data-privacy)). |

Search provider API references:

- [SearXNG Search API](https://docs.searxng.org/dev/search_api.html)
- [Brave Search API](https://api-dashboard.search.brave.com/app/documentation/web-search/responses)
- [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)
- [Keenable Search API](https://docs.keenable.ai/api-reference/search)

The system guidance tells models to use web search for current/time-sensitive facts and cite returned URLs. Result titles and snippets are treated as untrusted text, capped, and shown in the reasoning trace.

## Connectors (MCP)

Connectors let a tool-capable model use tools from [Model Context Protocol](https://modelcontextprotocol.io) servers you run: files, notes, Git, GitHub, a browser and more. Nothing is integrated per server. MCP servers describe their own tools, so any server works. Add them in **Settings → Knowledge & web → Connectors**:

| Add from | What happens |
|---|---|
| **Popular** | Filesystem, Memory, Fetch, Git, Time, Sequential Thinking, Playwright and GitHub, with the commands from their official READMEs. Fill in a folder or token and add. |
| **Paste config** | Paste the `mcpServers` JSON from any server's README, or a Claude Desktop, Cursor or VS Code config. |
| **MCP Registry** | Search the official [MCP Registry](https://registry.modelcontextprotocol.io). Opt-in: your search text goes to the registry only when you press Search. Registry servers are published by their authors and not reviewed, so read a server's repository before running it. |
| **Server URL** | Any server that speaks Streamable HTTP, with an optional bearer token or custom header. |

Servers with a URL become connectors directly. Servers with a command run on your computer, and a browser extension cannot start programs, so they collect into one `mcp.json` for a local bridge:

1. Download the generated `mcp.json`.
2. Run `olc mcp -c mcp.json`. [Install olc](https://www.ollamaclient.in/developers/) if you haven't. It starts every server in the file, serves each at `http://127.0.0.1:8086/mcp/<name>`, and prints a token.
3. Under **Local bridge**, enter the bridge URL and the token and press **Connect bridge**. Every server in the file is added and its tools are discovered. Edit `mcp.json`, restart the bridge, and connect again to pick up changes.

Any other bridge works too: for example `npx -y supergateway --stdio "<command>" --host 127.0.0.1 --port 8808 --outputTransport streamableHttp` serves one server at `http://127.0.0.1:8808/mcp`; add that under **Server URL**. Keep `--host 127.0.0.1`: without it supergateway listens on every network interface with no authentication, so other machines could call the server. Ollama Client does not need `--cors`, and leaving it off keeps web pages from reaching the server.

What happens at chat time:

- **Discovery runs when you add, connect or refresh**, not on every chat. A server that is down never slows a turn.
- **Tool names carry the connector's name** (`memory_create_entities`), so a connector cannot shadow a built-in tool or another connector.
- **You choose which tools are offered and when each asks before running.** A tool its server marks read-only asks once per chat; anything else asks on every call. The **Connectors** group in Permissions → Model tools turns them all off, globally or per model.
- **Results are untrusted.** Connector output cannot approve anything, and an approval given before it arrived does not cover calls after it.
- **A call that may have run is never repeated automatically.** The model is told it may already have happened and to check with you.
- **Tokens stay on this device**, are never synced, never shown again after saving, and never written to logs. Tokens you type into a preset go only into your local `mcp.json`.
- Images and audio from tools are named in the result but not passed to the model.
- Small local models handle a few tools far better than dozens. Turn off the tools you don't need.

## What the user sees

Tool runs appear in the reasoning trace. The trace shows:

- which tool ran,
- whether it is running, done, or failed,
- the arguments the model passed,
- sources or a short output preview,
- whether a long result was trimmed before being sent back to the model.

Recovered errors stay in the expanded trace instead of being pinned as the active status. For example, if a model uses an old tab id, `read_tab` refreshes the tab list and can fall back to the currently active readable tab.

## Images

Image input is gated by the selected model's resolved `vision` capability.

- Vision-capable model: the composer accepts supported images and sends them with the chat message.
- Non-vision model: the composer blocks image attach and points to the model capability override.

Images are stored locally with the conversation so the message can be reopened with previews. Provider adapters translate the attachment into each provider's wire format:

- Ollama: base64 image payloads through the native image field.
- OpenAI-compatible providers: `image_url` content parts.

## Limits and privacy

Tool and image data are not sent anywhere until a chat turn is sent to a provider.

- With a local provider, context stays on your machine or local network.
- With a remote provider, prompts, extracted context, tool results, files snippets, and images included in that turn are sent to that endpoint.
- Tool results are trimmed before being returned to the model so a long page or transcript does not dominate the prompt.
- Web search provider config is device-local. API keys are masked in settings and should not appear in logs.
- Browser tab access can be disabled from settings or the composer context tray.
- Chat-memory indexing is off on new profiles until you explicitly enable it.
- URL exclusions still apply to tab tools and manual tab context.

Tool calls do not create separate chat-history rows. The persisted conversation keeps the final answer and trace metadata.

## Model support

Tool calling and image input depend on the selected model and provider.

- If a provider reports model capabilities, Ollama Client uses that metadata.
- If it cannot, provider defaults are conservative.
- You can override a model's capabilities from the model menu.

For tool use, prefer models that reliably call tools when asked. If a model says it cannot access the browser instead of using tools, check that its tool capability is enabled and try a stronger tool-calling model.
