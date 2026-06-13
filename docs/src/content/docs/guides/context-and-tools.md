---
title: Context, Images, and Tools
description: How Ollama Client adds files, images, tabs, selected text, and local tool calls to a chat turn.
---

Ollama Client has two ways to add context to a chat turn.

- **Explicit context**: you attach files or images, select tabs, or capture selected text before sending.
- **Tool-called context**: a tool-capable model asks the extension for context while it is generating an answer.

Both paths run through the extension. What leaves the device depends on the provider endpoint you selected.

## Manual context

Manual context is best when you know exactly what the model should use.

| Context | How it is added | Notes |
|---|---|---|
| Files | Composer attachment button or drag/drop | Text is extracted, chunked, embedded, and available to RAG/file search. |
| Images | Composer attachment button, drag/drop, or paste | Enabled only for vision-capable models. PNG, JPEG, and WebP are supported. |
| Current tabs | Context menu in the composer | Selected tab text is injected into the prompt up to your configured context limit. |
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

Current internal tools:

| Tool | Reads |
|---|---|
| `current_tab` | The active tab's extracted text, including supported video transcripts. |
| `list_tabs` | Current readable tab ids, titles, and URLs. |
| `read_tab` | A specific readable tab by id or title/URL query. |
| `selected_text` | The latest selected text captured by the extension. |
| `file_search` | Uploaded/indexed files. |
| `rag_search` | Local chat memory and indexed conversation context. |

The tool loop is provider-agnostic. Ollama receives native tool definitions, while OpenAI-compatible providers receive OpenAI-style tool definitions.

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
- Browser tab access can be disabled from settings or the composer context controls.
- URL exclusions still apply to tab tools and manual tab context.

Tool calls do not create separate chat-history rows. The persisted conversation keeps the final answer and trace metadata.

## Model support

Tool calling and image input depend on the selected model and provider.

- If a provider reports model capabilities, Ollama Client uses that metadata.
- If it cannot, provider defaults are conservative.
- You can override a model's capabilities from the model menu.

For tool use, prefer models that reliably call tools when asked. If a model says it cannot access the browser instead of using tools, check that its tool capability is enabled and try a stronger tool-calling model.
