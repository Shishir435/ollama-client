# Browser built-in chat

This opt-in provider uses the current `window.LanguageModel` Prompt API shape.
Ollama remains the default. Settings → Providers offers preparation only when
both the visible extension page and the existing Chromium persistence host expose
the API and the host reports a usable text configuration. Support detection never uses browser identity. There is no
legacy `window.ai` fallback, origin-trial permission, or required experimental flag.
Firefox builds report unavailable without opening an offscreen document.

The visible card calls `create()` directly inside the click handler to retain
user activation for a browser-managed download. It monitors download progress,
destroys the temporary session, then asks the background to enable the provider.
The background creates and destroys a session in the actual host before saving
that intent. A newer enable/disable command cancels an older preparation, and
cancellation is checked again inside the configuration persistence lock. Downloading is
never triggered by model discovery, health polling, recovery, or a chat request.
The browser controls model eligibility, download size, retention and languages.
The extension does not ship or fetch these weights itself.

Inference runs in the **existing** persistence offscreen document, registered
under its existing real-offscreen guard. No new offscreen document, database
handle or persistence writer is created. The private stream port accepts only
same-extension background traffic, validates requests/events, and disconnects on
cancellation or timeout. Closing a side panel does not own this port. Host disconnection fails the current invocation explicitly so the user can retry.
Worker loss leaves the durable turn for existing startup recovery, which rebuilds
a fresh session from persisted conversation context.
There is no attempt to serialize a browser session or replay tool actions.
Status and preparation waits include host startup, have separate short deadlines,
and never cancel the shared persistence startup. Inference is bounded to five
minutes, two concurrent sessions, and eight million output characters. Existing durable-turn cancellation
and assistant persistence remain in the background.

Only text chat is supported. The adapter rejects images, tool definitions,
required tool choice, and tool-call history. Embeddings and model lifecycle
operations are unsupported. Sampling, output-token limits and context management
remain browser-managed; server-style model settings are not forwarded. Empty
parameter size/context metadata is deliberate: the browser has not reported it.
The capability sheet is read-only for this adapter: neither a manual override
nor a probe can enable an operation the transport cannot perform.
A synthetic model ID is discovered only while enabled and ready. A stale selected
ID still routes to this adapter and fails explicitly, without falling back to Ollama.
Unavailable discovery is a failure, not a successful empty catalog or healthy
connection. The ordinary provider list never waits for the AI host.

System messages are consolidated into the initial policy; promptStreaming receives
only conversational input because the API forbids system roles there. Oversized
initial history and context-overflow events produce a specific non-retryable error
rather than silently dropping history. Empty output and unsupported stream payloads
fail explicitly. Download polling is single-flight and ignores stale responses
during local mutations. An evicted model can be downloaded again while enabled.

The agent's required structured tool-call protocol is unchanged. Prompt API JSON
constraints do not implement that protocol. Google's current WebMCP extension
sample still requires `chrome://flags/#prompt-api-tool-use`; this feature does
not enable that API, and does not qualify this model for agent execution.

References checked 2026-10-16:

- [Official Prompt API guide](https://developer.chrome.com/docs/ai/prompt-api):
  availability, initial prompts, streaming, AbortSignal and session destruction.
- [Built-in AI prerequisites](https://developer.chrome.com/docs/ai/get-started):
  downloadable/downloading/available states, activation, hardware and language limits.
- [Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen):
  one document per extension/profile and runtime-only extension API access.
- [Prompt API explainer](https://github.com/webmachinelearning/prompt-api):
  document/worker constraints; extension worker exposure may differ by browser.
- [Google WebMCP sample](https://github.com/GoogleChromeLabs/webmcp-extension):
  experimental tool-use flag requirement.

The public guide excludes web workers, while Google's extension guidance mentions
broader extension-context exposure. We deliberately use a document and runtime
detection, rather than relying on worker availability in any particular browser.
Static checks/builds do not establish live model execution or cross-browser
support. Manual acceptance on eligible hardware must still cover download,
streaming, Stop, panel closure, worker recovery, and absent/removed models.

The provider, model picker, selected model and chat footer use the same monochrome
icon. An explicit `Google Chrome` brand in `navigator.userAgentData.brands` selects
the Chrome glyph; missing hints or other brands retain the neutral browser glyph.
This display-only hint never enables the provider or names the underlying model.
