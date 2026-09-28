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

Then:

```bash
olc                # Ollama with extension access
olc --lan          # also reachable from your trusted network
olc -b codex       # Codex as an OpenAI-compatible provider on :8083
olc -b opencode    # OpenCode on :8084
olc -b fm          # Apple's on-device model on :8085 (macOS 27)
olc --help
```

Add the Codex, OpenCode or Apple endpoints in the extension as a custom OpenAI-compatible provider at `http://127.0.0.1:<port>/v1`.

Want to pin a release and verify its checksum first? The [developer guide](https://www.ollamaclient.in/developers/) has the verified install.

## Private web search

Run your own [SearXNG](https://docs.searxng.org/) with Docker. No clone needed. This downloads the two config files into a new `searxng` folder and starts it:

```bash
mkdir -p searxng/core-config && cd searxng
raw=https://raw.githubusercontent.com/Shishir435/ollama-client/main/searxng
curl -fsSL "$raw/docker-compose.yml" -o docker-compose.yml
curl -fsSL "$raw/core-config/settings.yml" -o core-config/settings.yml
docker compose up -d
```

Then set `http://localhost:8080` in Settings → Knowledge & web → Web search. It listens on `127.0.0.1` only. Stop it with `docker compose down` from the same folder. Brave and Tavily need only an API key.

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
