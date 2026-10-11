# Local SearXNG

Local SearXNG instance for Ollama Client `web_search`.

## Start

From a clone of this repository, run it from the repo root:

```bash
cd searxng
docker compose up -d
```

Without a clone, download the two files into a new folder instead:

```bash
mkdir -p searxng/core-config && cd searxng
raw=https://raw.githubusercontent.com/Shishir435/ollama-client/main/searxng
curl -fsSL "$raw/docker-compose.yml" -o docker-compose.yml
curl -fsSL "$raw/core-config/settings.yml" -o core-config/settings.yml
touch .env
docker compose up -d
```

`.env` holds optional overrides: `SEARXNG_PORT`, `SEARXNG_HOST` and `SEARXNG_VERSION`, one `NAME=value` per line (see [`.env.example`](./.env.example)). In a clone, `cp .env.example .env` starts you from the defaults.

Open:

- UI: <http://localhost:8080>
- JSON API: <http://localhost:8080/search?q=test&format=json>

In Ollama Client settings, use:

```text
http://localhost:8080
```

## API docs

- [SearXNG Search API](https://docs.searxng.org/dev/search_api.html)
- [SearXNG settings.yml](https://docs.searxng.org/admin/settings/settings.html)

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
