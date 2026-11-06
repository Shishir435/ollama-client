# MCP Bridge

Chrome extensions cannot spawn processes, so stdio-only MCP servers (like WordCraft's `wordcraft-cli.exe mcp`) need a small HTTP front door. This script is that front door: it spawns your server on stdio and answers Ollama Client's streamable-HTTP requests over one persistent session.

## Why one session

WordCraft keeps its open documents in memory. If every browser-chat call opened a fresh process, the document you opened in turn 1 would be gone by turn 2. The bridge routes **all** HTTP requests through a single stdio session, so document state survives across calls. When the child dies it restarts after 1 second and pending requests fail fast.

## Usage

```powershell
# PowerShell (or Git Bash)
node "C:\path\to\ollama-client\tools\mcp-bridge\index.mjs" `
  --command "C:\Programs\WordCraft\wordcraft-cli.exe" mcp --port 9000
```

Everything after the last flag is passed to your server as child arguments, in order. Quote paths with spaces in your shell.

Then in Ollama Client: **Settings → Models → MCP Servers → Add** with `http://localhost:9000/mcp`. Click Test; when it says Connected, the server's tools appear on the next chat turn (prefixed with the server slug, e.g. `wordcraft_open_document`).

## MailCraft example

```powershell
node index.mjs --command "C:\Program Files\MailCraft\mailcraft-cli.exe" mcp --file "C:\Users\tacit\AppData\Roaming\MailCraft\mailbox.mailcraft" --allow send --port 9001
```

## Notes

- Listens on `127.0.0.1` only — nothing is exposed to the network.
- Responses are plain JSON bodies (valid streamable HTTP). The client also accepts SSE if a server prefers it; this bridge does not emit SSE.
- Request timeout is 120 seconds per call, matching the extension's default.
- Press Ctrl+C to stop the bridge and its child process.
