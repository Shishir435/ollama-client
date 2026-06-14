# Local SearXNG

Local SearXNG instance for Ollama Client `web_search`.

## Start

```bash
cd searxng
docker compose up -d
```

Open:

- UI: <http://localhost:8080>
- JSON API: <http://localhost:8080/search?q=test&format=json>

In Ollama Client settings, use:

```text
http://localhost:8080
```

## Stop

```bash
cd searxng
docker compose down
```

## Update

```bash
cd searxng
docker compose pull
docker compose up -d
```

