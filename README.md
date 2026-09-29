# Ollama Client

A browser side panel for chatting with local and self-hosted LLMs. Your chats, files and embeddings stay on your machine.

<p>
  <a href="https://chromewebstore.google.com/detail/ollama-client/bfaoaaogfcgomkjfbmfepbiijmciinjl">
    <img alt="Chrome Web Store" src="https://img.shields.io/chrome-web-store/v/bfaoaaogfcgomkjfbmfepbiijmciinjl?label=Chrome%20Web%20Store&style=for-the-badge&logo=googlechrome" />
  </a>
  <a href="https://addons.mozilla.org/en-US/firefox/addon/ollama-client/">
    <img alt="Firefox Add-on" src="https://img.shields.io/amo/v/ollama-client?label=Firefox%20Add-on&style=for-the-badge&logo=firefoxbrowser" />
  </a>
  <img alt="License" src="https://img.shields.io/badge/License-MIT-111827?style=for-the-badge" />
</p>

[Docs](https://www.ollamaclient.in/) · [Provider setup](https://www.ollamaclient.in/guides/provider-setup/) · [Privacy](https://www.ollamaclient.in/legal/privacy-policy/) · [Issues](https://github.com/Shishir435/ollama-client/issues)

## Get started

1. Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/ollama-client/bfaoaaogfcgomkjfbmfepbiijmciinjl) (Chrome, Edge, Brave) or [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/ollama-client/).
2. Start a model server — Ollama, LM Studio or llama.cpp. For Ollama, [`olc`](#olc-cli-optional) does the setup for you.
3. Open the side panel, pick a model, chat.

## Features

- **Streaming chat** in the side panel, with stop, edit-in-place, branching, tags, export, print and backup.
- **Providers:** Ollama, LM Studio and llama.cpp built in; vLLM, LocalAI, KoboldCPP or any OpenAI-compatible server, and Anthropic, as custom providers.
- **Local RAG** over your files: hybrid keyword + vector search, with offline embeddings bundled in the extension.
- **Browser context:** attach tabs, selected text, files or images; tool-capable models can read the current tab and open tabs themselves.
- **Web search** (optional) through SearXNG, Brave or Tavily.
- **Vision** for models that support images.
- **Selection button:** send highlighted text on any page straight to chat.
- **Browser agent** (experimental, off by default): the model can open sites, search, click and fill forms, asking you before anything consequential.
- **Privacy screen:** see everything stored, back it up, or wipe it. No telemetry.

## Browser support

| Feature | Chrome / Edge / Brave | Firefox |
| --- | :---: | :---: |
| Chat, providers, history | ✅ | ✅ |
| Local RAG and offline embeddings | ✅ | ✅ |
| Images, web search, tab tools | ✅ | ✅ |
| Selection button | ✅ | ✅ |
| Tab groups | ✅ | optional permission |
| Browser agent (experimental) | ✅ | ❌ |
| Minimum version | 116 | 114 |

The agent drives pages through Chrome's debugger API, which Firefox does not offer, so Firefox builds leave it out entirely.

## Providers

| Provider | Default endpoint |
| --- | --- |
| Ollama | `http://localhost:11434` |
| LM Studio | `http://localhost:1234/v1` |
| llama.cpp (`llama-server`) | `http://localhost:8000/v1` |
| OpenAI-compatible | your URL |
| Anthropic | `https://api.anthropic.com/v1` |

Models with no saved provider mapping route to Ollama. See the [capability matrix](https://www.ollamaclient.in/concepts/provider-matrix/).

## olc CLI (optional)

`olc` starts or reuses Ollama with extension access already configured, so you skip setting `OLLAMA_ORIGINS` by hand. It needs Node.js 22.12+.

```bash
curl -fsSL https://ollamaclient.in/olc.sh | sh     # macOS / Linux
```

```powershell
irm https://ollamaclient.in/olc.ps1 | iex          # Windows
```

These run the install script straight from the site without checking it first. To pin a release and verify its checksum before anything runs, use the [verified install](https://www.ollamaclient.in/developers/#install-without-piping-to-a-shell).

Then:

```bash
olc                # Ollama with extension access
olc --lan          # also reachable from your trusted network
olc -b codex       # Codex as an OpenAI-compatible provider on :8083
olc -b opencode    # OpenCode on :8084
olc -b fm          # Apple's on-device model on :8085 (macOS 27)
olc -b laya        # Laya decision API on 127.0.0.1:8086
olc -b searxng     # local web search on 127.0.0.1:8080
olc list           # running Docker services managed by olc
olc --help
```

Add the Codex, OpenCode or Apple endpoints in the extension as a custom OpenAI-compatible provider at `http://127.0.0.1:<port>/v1`.

<details><summary>Check the installed olc version</summary>Run <code>olc --version</code> and compare it with the release you expect.</details>

## Private web search

Run [SearXNG](https://docs.searxng.org/) through olc. Docker Desktop or Docker Engine with the Compose v2 plugin must be installed and running; olc creates the local config and starts SearXNG with Valkey without a repository clone or downloaded setup files:

```bash
olc -b searxng
olc -b searxng status
olc list
olc -b searxng stop            # pause; preserve containers and data
olc -b searxng rm              # remove containers; preserve config and data
olc -b searxng rm --purge-data # delete config and search data too
```

Set `http://localhost:8080` in Settings → Knowledge & web → Web search. If port 8080 is occupied, start it with `olc -b searxng --port 18080` and use `http://localhost:18080`. SearXNG listens on `127.0.0.1` only. `stop` pauses its containers; `rm` removes them while preserving config and data volumes. Add `--purge-data` to `rm` to delete those too. Fresh olc installs use a pinned SearXNG image; existing `.env` version selections are preserved. Search results depend on upstream engines, which may rate-limit or challenge requests. Laya runs locally at `http://127.0.0.1:8086/v1/systemone` (use `olc -b laya --port <port>` if needed). To change a Laya port, remove the container with `olc -b laya rm`, then start it with the new `--port`; the model cache is preserved. Brave and Tavily need only an API key.

## Privacy

Local providers keep everything on your machine. A remote provider sees what you send it, and a remote search provider sees your queries. Chat history, files and embeddings are stored locally. Diagnostics are content-free and never uploaded. Don't expose a model server to the internet without authentication.

## Development

```bash
git clone https://github.com/Shishir435/ollama-client.git
cd ollama-client
pnpm install
pnpm dev            # Chrome
pnpm dev:firefox    # Firefox
```

Run `pnpm verify` before a PR. See [CONTRIBUTING.md](./CONTRIBUTING.md), [AGENTS.md](./AGENTS.md) for architecture and conventions, and [tools/README.md](tools/README.md) for commands.

## License

[MIT](./LICENCE)
