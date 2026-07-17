---
title: Privacy Policy
description: What Ollama Client processes, where data is stored, and when it leaves your device.
---

Ollama Client is designed as a local-first extension. This policy explains what data is processed, where it is stored, and when it leaves your device.

*Effective date: February 7, 2026.*

## Scope

This policy applies to the Ollama Client browser extension and the documentation pages on this site.

## Data we collect

The extension does **not** run first-party analytics, ad trackers, or telemetry pipelines. The data that exists on your device while using the extension is:

- Chat prompts and model responses generated during use.
- Session metadata (titles, timestamps, branch state).
- Optional uploaded file content for local retrieval workflows.
- Optional images attached to chat messages.
- Optional page content, tab titles/URLs, and selected text when you use browser-context features or when a tool-capable model calls a browser-context tool.
- Settings and provider configuration values.

## Where data is stored

- Local browser storage backed by SQL WASM (`sql.js`).
- Optional ZIP backups stored locally when you export.
- No default cloud sync from the extension itself.

## Network communication

The extension sends prompts to whichever provider endpoint you configure. Typical local endpoints:

- Ollama (`localhost:11434`)
- LM Studio (`localhost:1234`)
- llama.cpp server (`localhost:8000`)

LAN endpoints are supported when configured by the user. If you point the extension to a remote endpoint, your prompt data will be sent to that endpoint.

The OpenRouter preset sends two static application-attribution headers: the Ollama Client website and application name. It never substitutes the page you are viewing, a chat URL, or another user-specific value into those headers. Your API key remains device-local, but prompts and selected context are processed according to OpenRouter and its routed model provider's policies.

When browser-context tools or image input are used, the extracted context or image data becomes part of the provider request for that chat turn. Local providers receive it locally; remote providers receive it over the configured remote endpoint.

:::caution
Your privacy outcome depends on the provider endpoint you configure, not just the extension code. Review the privacy posture of any non-local endpoint before using it for sensitive prompts.
:::

## Permissions

The extension requests browser permissions for chat UX, optional page extraction, and provider connectivity:

- `storage` — settings and local state.
- `tabs` and content-extraction-related permissions.
- Network / host permissions to reach configured provider endpoints.

## Retention and user control

- You can delete chats and associated local artifacts from the UI.
- You can disable RAG and related indexing features.
- You can disable browser tab access from settings or the composer context controls.
- You can reset storage and configuration from the settings page.

## Security notes

- Do not expose provider APIs publicly without access controls.
- Treat LAN endpoints as sensitive infrastructure.
- Review provider privacy policies for any non-local endpoints.

## Policy changes

This policy may be updated as the architecture evolves. The latest version is always published at this URL.

## Contact

Questions: [shishirchaurasiya435@gmail.com](mailto:shishirchaurasiya435@gmail.com)

---

© 2026 Ollama Client. Local-first by design, with endpoint behavior controlled by the user.
