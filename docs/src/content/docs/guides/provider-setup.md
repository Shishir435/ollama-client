---
title: Provider Setup
description: Configure Ollama, LM Studio, llama.cpp, OpenAI, OpenRouter, Anthropic, Chinese frontier APIs, or compatible servers.
---

Verified built-ins are Ollama, LM Studio, and llama.cpp. Add vLLM, LocalAI, KoboldCPP, or another compatible endpoint through **Add provider**. The OpenRouter preset uses its OpenAI-compatible Chat Completions API. Anthropic uses the native Messages API, while the generic Anthropic-compatible option also supports keyless local or LAN endpoints.

Web search is configured separately in the Context tab. Use SearXNG for local/self-hosted search, or Brave Search/Tavily when you want an API-backed provider.

## 1. Install the extension

Install [Ollama Client](https://chromewebstore.google.com/detail/ollama-client-chat-with-l/bfaoaaogfcgomkjfbmfepbiijmciinjl) from the Chrome Web Store.

## 2. Pick a provider

| Provider | Default endpoint | Notes |
|---|---|---|
| Ollama | `http://localhost:11434` | Recommended baseline. Tool calling plus fullest model-management support. |
| LM Studio | `http://localhost:1234/v1` | OpenAI-compatible chat, embeddings, tool calling, and LM Studio model discovery. |
| llama.cpp server | `http://localhost:8000/v1` | OpenAI-compatible. Run with `llama-server`. |
| OpenAI-compatible | User configured | Add vLLM, LocalAI, KoboldCPP, or another compatible endpoint. |
| OpenAI | `https://api.openai.com/v1` | Hosted OpenAI API; API key required. Uses streamed usage and the modern completion-token field. |
| Anthropic | `https://api.anthropic.com/v1` | Remote Claude Messages API; API key required. |
| Anthropic-compatible | User configured | Native Messages wire; API key is optional for compatible self-hosted endpoints. |
| OpenRouter | `https://openrouter.ai/api/v1` | OpenAI-compatible hosted gateway; API key required. Model IDs keep their provider prefix. |

### Contract-tested hosted compatibility endpoints

The following hosted providers use **OpenAI-compatible** in the Add provider
dialog. The listed URLs are editable examples, not client-side restrictions;
regional endpoints, enterprise gateways, and reverse proxies are supported.
Their request and streaming-response shapes are covered by fixture-based
contract tests sourced from the vendors' current API documentation. These tests
do not spend API credits or assert that every model supports every capability;
they protect endpoint joining, Bearer authentication, model IDs, streamed text
and reasoning, usage, and standard function tool calls from client regressions.

| Provider | Base URL | Wire contract |
|---|---|---|
| DeepSeek | `https://api.deepseek.com` | OpenAI Chat Completions, including `reasoning_content` and tools. |
| Qwen / Alibaba Model Studio | `https://dashscope.aliyuncs.com/compatible-mode/v1` | DashScope's OpenAI-compatible Chat Completions endpoint. Use the endpoint for your account region when it differs. |
| Kimi / Moonshot | `https://api.moonshot.ai/v1` | OpenAI-compatible Chat Completions, including streamed tool-call fragments. |
| Z.AI / GLM | `https://api.z.ai/api/paas/v4` | OpenAI-compatible Chat Completions. China accounts may use the BigModel endpoint instead. |

The provider's own model documentation remains authoritative for vision,
reasoning, tools, context limits, and regional availability. A passing client
contract test means Ollama Client preserves the documented wire shape; it is
not a live service-health check.

## 3. Configure and start Ollama

Ollama Client does not require olc. Choose the automatic CLI setup or configure
Ollama's environment yourself.

### Option A: automatic setup with olc

Install Ollama from [ollama.com](https://ollama.com), then install the **olc CLI**:

```bash
# macOS / Linux
curl -fsSL https://ollamaclient.in/olc.sh | sh
```

```powershell
# Windows PowerShell
irm https://ollamaclient.in/olc.ps1 | iex
```

These installers pipe a remote script into your shell. To pin the release and verify it first, see [installing without piping to a shell](/developers/#install-without-piping-to-a-shell).

Start or reuse native Ollama with extension origins enabled:

```bash
olc
olc --check --json   # optional read-only verification
```

Use `olc --lan` only for trusted-network access; Ollama's native API has no
authentication. Use `olc --debug` for foreground diagnostics. The CLI is detached
by default and refuses to replace an unrelated listener. It never writes global,
user, app, or service environment: `OLLAMA_*` exists only on a standalone Ollama
process started by olc. Compatible managed servers are reused unchanged; stop or
manually configure an incompatible service. On macOS, olc can gracefully quit an
incompatible Ollama app and replace it with a process-scoped standalone server.
See [OLC installation and platform behavior](/developers/).

### Option B: manual setup without olc

Fully stop the existing Ollama app or server first so the restarted process
inherits the new environment.

For a macOS or Linux shell-run server:

```bash
OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*" \
OLLAMA_HOST="127.0.0.1:11434" \
ollama serve
```

For the macOS Ollama app, set its launch-session environment and restart it:

```bash
launchctl setenv OLLAMA_ORIGINS "chrome-extension://*,moz-extension://*"
osascript -e 'quit app "Ollama"'
open -a Ollama
```

The `launchctl` value lasts until logout. Remove it with
`launchctl unsetenv OLLAMA_ORIGINS`.

For a Linux systemd service:

```bash
sudo systemctl edit ollama
```

Add this override, then save the editor:

```ini
[Service]
Environment="OLLAMA_ORIGINS=chrome-extension://*,moz-extension://*"
```

```bash
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

For the current Windows PowerShell session:

```powershell
$env:OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*"
ollama serve
```

To persist it for the current Windows user, set the user variable and then
fully quit and reopen Ollama:

```powershell
[Environment]::SetEnvironmentVariable(
  "OLLAMA_ORIGINS",
  "chrome-extension://*,moz-extension://*",
  "User"
)
```

These examples keep Ollama on loopback port `11434`. For LAN access, set
`OLLAMA_HOST=0.0.0.0:11434` only on a trusted network; Ollama has no native API
authentication. See [CORS troubleshooting](/guides/troubleshooting/ollama-cors-error/)
for verification and platform details.

Pull at least one chat model:

```bash
ollama pull qwen2.5:3b
```

To use hosted `:cloud` models through the same local Ollama provider, see [Use Ollama Cloud models](/guides/ollama-cloud/). Recent Ollama versions let Ollama Client add recommended cloud models to the normal model menu automatically.

For tool calling and image input, choose a model that actually supports those capabilities. The extension detects reported capabilities where providers expose them, and lets you override them from the model menu when a provider cannot report them.

Pull one embeddings model for RAG:

```bash
ollama pull all-minilm:latest
```

You need at least one chat model and one embeddings model installed for the full experience.

:::note[Optional Bash helper]
From a repository clone, `tools/setup/ollama-env.sh` automates the same manual
environment setup for existing Bash workflows. You can use it without installing
olc. The olc path adds stricter process ownership checks and readiness reporting.
:::


## 4. Configure the extension

1. Open the extension's options page.
2. Go to the **Providers** tab.
3. Enable the providers you want.
4. Set the base URL and run a connection test.
5. Pick a model from the chat model menu.

### Endpoints that do not list models

Some hosted gateways implement `/chat/completions` and nothing else. The connection test reports those as reached but without a model list, and no model can be discovered from them.

Add the model IDs you want under **Model IDs** on the provider card (or in the Add provider dialog). Those IDs go into the chat model menu exactly like discovered ones, and they survive a failed or missing `/models` request — so a provider that publishes no catalog is still fully usable. Removing an ID only removes it from the menu; it never deletes anything on the server.

The answer is remembered per provider, so such an endpoint is asked once rather than on every refresh. It is re-checked after a day, whenever you change the base URL, wire, or preset, and whenever you press **Test**.

A wrong base URL answers the model-list request exactly the way a chat-only gateway does, so **Test** settles it by asking the chat endpoint to generate a single token with the first model ID you added. If that answers, the provider is reported as working; if nothing is there either, the test tells you to check the base URL — hosted providers usually need the version suffix, such as `/v1`. That one-token request is only sent when you press Test, never by the background connection check.

### Image-generation models

Generated images use the same chat history and preview UI regardless of provider. Ollama image models use the Ollama generation stream. OpenAI-compatible providers use their Images endpoint, with a fallback for compatible servers that return inline image parts from Chat Completions.

When a model catalog reports image output, the extension enables it automatically. For providers whose catalog does not report output modalities, open the model's capability sheet and enable **Image generation**. This flag is separate from **Vision**: vision accepts an image as input, while image generation produces an image as the assistant response.

Provider output is normalized to validated PNG, JPEG, or WebP data and saved with the assistant message. The extension requests base64 image data and does not follow provider-returned image URLs.

## 5. Verify endpoints

```bash
# Ollama
curl http://localhost:11434/api/tags

# LM Studio
curl http://localhost:1234/v1/models

# llama.cpp
curl http://localhost:8000/v1/models
```

## 6. Reality checks

- Chat generation is fully provider-agnostic.
- Image input is model-dependent. If the selected model is not vision-capable, the composer blocks image attach instead of sending unsupported input.
- Image output is provider- and model-dependent. It is routed through a shared generated-image stream rather than inferred from the provider's brand.
- Tool calling is model-dependent. Ollama and LM Studio both expose tool-calling APIs, but the selected model still needs tool-use support. Tool-capable models can inspect browser context through local extension tools; non-tool models keep the old plain chat path.
- Web search is off by default and model-visible only as `web_search`. Backend choice is a user setting, not a model prompt detail.
- Model-management actions depend on provider capabilities. Ollama has the fullest support; LM Studio adds pull/unload support.
- Embedding generation uses the configured provider when supported, then falls back through the shared embedding path and Ollama for reliability.

## 7. Optional local web search with SearXNG

The repo includes a local SearXNG compose stack for private web-search testing.

```bash
cd searxng
docker compose up -d
```

Then open Settings -> Context -> Web Search:

1. Enable web search.
2. Pick `SearXNG`.
3. Set endpoint to `http://localhost:8080`.
4. Run **Test search**.

SearXNG supports `pageno`, not an API-side result-count parameter. Ollama Client can fetch 1-3 pages, de-dupe URLs, then apply the configured result-count cap before returning results to the model.

## 8. Search provider API references

- [SearXNG Search API](https://docs.searxng.org/dev/search_api.html)
- [Brave Search API](https://api-dashboard.search.brave.com/app/documentation/web-search/responses)
- [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)

## 9. CORS and browser notes

Chrome-based browsers route extension requests through Declarative Net Request (DNR). Firefox uses a different extension API model.

:::caution[Firefox + Ollama]
On Firefox or strict environments, you may need to set `OLLAMA_ORIGINS` to allow the extension origin. Either run olc as shown above or use the manual environment instructions; both configure Ollama itself, and the extension works the same way afterward.
:::

## 10. Troubleshooting

- Confirm the provider process is actually running.
- Confirm the endpoint URL matches the runtime URL exactly (port, scheme, `/v1` suffix).
- Use the **Test connection** button in Providers settings before debugging model behavior.
- For web search, use **Test search** in Context settings and verify your SearXNG endpoint or API key.
- Check the background console (`chrome://extensions` → service worker) for streaming or provider errors.

## Related

- [Architecture](/concepts/architecture/)
- [Context, Images, and Tools](/guides/context-and-tools/)
- [Ollama Cloud models](/guides/ollama-cloud/)
- [Privacy policy](/legal/privacy-policy/)
- [GitHub repository](https://github.com/Shishir435/ollama-client)
