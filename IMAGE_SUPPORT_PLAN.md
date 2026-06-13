# Ollama Client — Image / Vision Input Plan (Roadmap Milestone 2)

## Summary

Add the ability to attach images to a chat message and send them to
vision-capable local models. Built on the 0.9 capability foundation: image
attach is gated on the selected model's resolved `vision` capability.

Non-goals (v1): no OCR, no image indexing/RAG, no image generation, no image
embeddings. Images are message-scoped only.

## Provider API formats

Two adapters cover all providers (the five OpenAI-compatible providers share
one path):

- **Ollama** `/api/chat` — raw base64 (no `data:` prefix) on the message:
  `{ role, content, images: ["<base64>"] }`
- **OpenAI-compatible** `/v1/chat/completions` — `content` becomes a parts
  array: `[{ type: "text", text }, { type: "image_url", image_url: { url: "data:<mime>;base64,<b64>" } }]`

## Data model & transport

- New `ImageAttachment` type, separate from RAG `FileAttachment`:
  `{ imageId, fileName, mimeType, size, base64, width?, height? }`.
- `ChatMessage.images?: ImageAttachment[]` (kept distinct from `attachments`).
- Transport is **base64 strings**, not bytes — Chrome runtime port messages are
  JSON-serialized, so `Uint8Array` would corrupt. Base64 is safe end-to-end and
  is what both provider formats consume.
- **No schema migration.** Reuse the existing `files` table (`data BLOB`,
  `fileType`, `fileName`, `fileSize`, `messageId`). Images persist there with
  `fileType` = mime; on load, rows are split by `fileType.startsWith("image/")`
  into `message.images`, everything else stays `message.attachments`. Base64 is
  stored as bytes in the BLOB and re-encoded on read.

## Capability gating

- `useSelectedModelCapabilities()` resolves the selected model's `vision` via the
  0.9 capability layer (override → metadata → provider default).
- Composer enables image attach only when `vision === true`; otherwise a clear
  blocked state points the user at the model-menu capability override.

## Configuration

- Max image size defaults to 10MB, **configurable on the options page**
  (per-image cap). Stored as a sync-safe setting; the composer reads it for
  validation.

## Phases

1. **Types + persistence** — `ImageAttachment`, `ChatMessage.images`, files-table
   split on write/read, base64⇄bytes helpers, round-trip tests. No behavior change.
2. **Provider adapters** — Ollama `images`, OpenAI-compatible content parts,
   request-body unit tests. Backward compatible when no images.
3. **Composer** — accept images when vision-capable, base64 + validate
   (type allowlist, configurable size cap), image preview rail (separate from
   file chips), clipboard paste, wire into message assembly.
4. **Rendering** — `ImageAttachmentDisplay` thumbnails in sent messages, enlarge
   in a Sheet, reopen-from-storage.
5. **Options + polish** — configurable max-size setting UI, attach-disabled
   tooltip, optional downscale, i18n, docs, CHANGELOG.

## Testing

- Provider request-body unit tests (Ollama `images`, OpenAI parts).
- Persistence round-trip (image in → files table → reload → `message.images`).
- Capability gate (vision → enabled; non-vision → blocked).
- Composer validation (reject wrong type / oversize).

## Acceptance (from roadmap)

- Image attach works only for the selected vision-capable model.
- Non-vision model shows a clear blocked state.
- Stored chats preserve image metadata and preview/reopen behavior.
- Streaming text response still works with images attached.
