# AGENTS.md — packages/olc

Rules for the `olc` CLI and its agent proxies. This is a standalone Node
package: nothing in the extension's `src/` knows it exists, and no rule here
applies to extension code. `packages/olc/README.md` has the user-facing
options, endpoints, build outputs and known limits.

`packages/olc` is a Node CLI, not extension code. Bare `olc` manages native Ollama
through `src/ollama/` on port 11434; it never wraps Ollama in the proxy.
`-b` / `--backend codex|opencode` explicitly selects the agent proxies on ports 8083 (Codex) and 8084 (OpenCode).
All CLI backends detach by default; `--debug` or `--foreground` stays attached.
Proxy readiness crosses a private IPC handoff before the launcher exits.
Foreground native sessions stop only the standalone child they create, never an adopted service.
Native lifecycle tests mock OS effects; never restart a developer's Ollama during validation.
Native olc never persists environment or configuration: no `launchctl setenv`,
systemd drop-ins, registry/user variables, or shell-profile edits. Pass
`OLLAMA_*` only to a standalone child; reuse compatible managed servers and
refuse changes that require their owner. The macOS app may be gracefully quit
and replaced by a standalone child, without relaunching or reconfiguring it.
In agent mode it serves a local agent runtime over `/v1/chat/completions`, so that runtime's models reach the extension through the ordinary OpenAI-compatible custom-provider flow.

- **Nothing in `src/` knows it exists.** Do not add proxy-aware branches to the extension: provider-shaped behaviour belongs behind the provider's own wire format, not behind a base-URL check in a handler.
- **An image is a part, not text.** An `image_url` content part carries no `text`, so flattening a message to a string drops it silently and leaves the model answering about pictures it never saw. `buildPromptParts` emits image parts as OpenCode file parts alongside the text, in message order.
- **Capabilities travel in the catalog.** `/v1/models` reports the runtime's own tool-calling, reasoning and modality flags as `capabilities`, `supported_parameters`, `input_modalities` and `output_modalities` — exactly what `openai-compatible.ts` already reads. A provider-level image tool is a dedicated image-output model, not an output flag on every text model.
- **An empty catalog is not an answer, and is never cached.** A backend that
  is up has not necessarily finished discovering its providers, so
  `config.providers()` can answer with nothing for a moment. Storing that for
  the cache's thirty seconds turned one unlucky read into half a minute of the
  proxy reporting that its runtime has no models — served from memory, so
  nothing asked again — and a missing catalog is a normal answer rather than a
  failure, so the extension's model menu simply showed a provider that lists
  nothing until something else spent the window. It is the rule the extension
  already keeps for provider metadata, applied to the proxy's own cache.
  Nothing retries and nothing waits: the empty answer is returned as it
  stands, and the next caller asks again.
- **Every route starts the backend it reads from.** `/v1/models` and
  `/v1/models/:id` call `ensureReady` first, as the chat and image routes do.
  The proxy begins listening before startup has resolved — deliberately, since
  startup is shared infrastructure rather than one request's work — so a
  catalog read arriving in that window used to ask a runtime that was not up
  and answer `502`.
- **Generated images are bytes, not links.** `/v1/images/generations` accepts the OpenAI-compatible `b64_json` shape and returns only validated base64 from the selected backend. A missing runtime image operation is `501`, never a text fallback disguised as image generation.
- **Tool calls round-trip through the wire format.** The runtime does not forward a caller's tool definitions to its model, so the proxy registers them, parks a call mid-turn, emits it as an OpenAI `tool_calls` delta with `finish_reason: "tool_calls"`, and resumes the same turn when the next request carries matching `tool_call_id`s. The extension's native tool loop drives it unchanged, and its approval and permission gates still apply because the tools still execute in the extension.
- Inside the proxy, `src/core/` is runtime-agnostic and every runtime detail sits behind the `AgentBackend` port (`src/backends/types.ts`), with OpenCode as the first adapter. A new runtime is an adapter plus a registry entry, never a change in `core/`.
- **A decision is isolated; the session behind it is not free.** Every chat
  request that carries no trailing tool results starts a new backend turn, so
  the extension's agent — which sends one full conversation per step and never
  returns a tool result for the decision it parsed — gets an isolated session
  per decision. Nothing in the wire says a client will not resume, and it must
  not be inferred: a client may legitimately start fresh work while still
  computing a result for a turn it left parked, so discarding on that basis
  throws away work it is about to hand back. What is not defensible is
  unbounded, so `MAX_PARKED_TURNS` caps how many turns may sit parked and a
  fresh request discards the oldest above it, never one with a resume hold.
  Before that, only each turn's own ten-minute TTL ended one, and a
  twenty-five-step run held twenty-five live sessions at once.
- **Every terminal path settles the session and the slot.** A response that
  stopped is not a session that ended: a parked turn is a live runtime session
  and a parked call is a promise something awaits. `ChatRoutes.inspect()`
  reports what is still held so a test can tell the two apart, and shutdown
  disposes the turns it fails rather than leaving them to a timer nobody will
  see. It settles the union of parked turns, resume holds and whatever the
  call registry still names — a resuming turn is deliberately taken *out* of
  the parked map while its deadlines are suspended, so walking that map alone
  left a live session whose calls had no timer left to settle them.
- **A tool result belongs to one turn, or to none.** The parked-call registry is process-wide, so a follow-up releases only the calls the turn it resumes actually owns. A follow-up whose results name no live turn is refused with `400 StaleToolResults`; starting a fresh turn instead drops the result the client just produced and lets the model redo the work behind its back. The correlation is resolved twice — once to answer fast, once inside the queue slot — because a request can wait there for as long as another turn may run, and **both** of the turn's deadlines — the turn-level one and the shorter per-call one in the registry — are suspended for as long as its own resume is waiting. They ask the same question, so a fix that suspends one and not the other only moves which timer loses the result.
- **One turn at a time is an invariant, not a hint — until holding it costs
  more than breaking it.** A request past its deadline is cancelled through an
  `AbortSignal` and the queue keeps holding the slot: a task still running has
  not left the single-flight boundary, whatever its caller was told. After
  `CANCEL_GRACE_MS` it will not stop, so the queue refuses requests with `503`
  and names it rather than starting a second turn beside it. After
  `FORCE_RELEASE_MS` the slot is released anyway and the task is written off
  as orphaned — a task that ignores its abort (an SDK call with no
  cancellation, a poll loop on a session that is gone) used to wedge the proxy
  for the life of the process. Three things keep that a trade rather than a
  hole, and a caller of this queue owes all three: the runtime work is torn
  down on cancellation rather than merely unawaited (the chat route aborts and
  disposes its turn the moment the signal fires, bounded well under the cancel
  grace, a full minute before the slot is given away); a turn owns its own
  backend session, so an orphan and its replacement share a runtime but never
  session state; and an unsettled orphan is counted in `inspect().orphaned`
  and marks the proxy degraded on `/health`, because a run of them means the
  runtime is ignoring abort *and* dispose and the answer is a restart an
  operator can only reach for if the proxy says so. Shortening the window
  trades a wedged proxy for overlapping turns and lengthening it trades the
  other way; neither is free.
- **A browser origin is refused unless it is allowed.** The proxy listens on loopback and runs an agent, so a wildcard `Access-Control-Allow-Origin` would let any page spend a turn — a missing response header does not stop a simple request. `ALLOWED_ORIGINS` defaults to the extension schemes; a request with no `Origin` is not a page and is left alone.
- `packages/olc/README.md` has the options, endpoints, build outputs and known limits.
