# Browser agent: observation

Detailed implementation contracts. Start with [AGENT_INTERNALS.md](../../AGENT_INTERNALS.md) and read only the sections relevant to the change. Repair history explains existing behavior; it is not evidence of live-model reliability.

## Perception: frames and identity

- **Identity is per frame.** `AgentSnapshotIdentity` names a tab, a frame, a
  document and a generation; every frame keeps its own reference store, and a
  child frame's references carry the frame in their prefix (`f7e2`), so `e1`
  is never the same control in two frames. The command names the root
  snapshot; the executor binds the effect to the target's own frame identity
  (`target.frame`) and re-reads that frame's document before acting. Never
  hardcode `frameId: 0` again — a literal zero is how a child-frame control
  gets resolved against the wrong document.
- **A frame is read only once the run may read it.** The registry lists the
  tab's frames, and each child passes the browser's limits, the user's
  exclusions and the run's origin allowlist before its port is opened. A frame
  that fails any of them is listed in `observation.frames` with its origin and
  the reason, never its URL, and contributes no elements; the model is told it
  exists so it can ask rather than conclude the control is missing.
  A `srcdoc` or script-written `about:blank` child — most in-page editors and
  embedded previews — has no origin in its address and is judged as the
  document that created it: the nearest addressed ancestor's URL for the
  user's exclusions (`frameAccessUrl`), its origin for the allowlist. It is
  read after every frame with an address of its own, at most three per
  observation (pages make `about:blank` frames for ads too), and only with a
  document id. Inside, the origin is `window.origin`: `location.origin` is
  derived from `about:srcdoc` and reads `"null"`. A sandbox without
  `allow-same-origin` really is opaque, reports `"null"`, and stays unread;
  a document reporting any origin other than the one it was authorized under
  is listed `unauthorized_origin`. No extra permission is involved:
  `scripting.executeScript` with `frameIds` already reaches these frames under
  `<all_urls>` — what kept them unread was this code.
- **Frames and elements are bounded together.** Root first, then children in
  frame-id order up to `MAX_AGENT_OBSERVED_FRAMES`; frames past the cap are
  counted in `omittedFrames`, never listed, so the list itself honours the
  contract. A child receives only the element budget the frames before it
  left, and a child that cannot fit or cannot be read is listed as such rather
  than truncated or retried.
- **Perception reads the composed tree, not the light DOM.** Candidate
  selection and both text walks descend into open shadow roots at their host,
  so a component's controls and text are observed like any other; every node
  tree is walked once, so a `<slot>` never double-counts the light child it
  projects. A closed shadow root reads as `null` and stays unread rather than
  guessed at. The walk is `nodeType`-based, not `instanceof Element` — the same
  observation runs against a child frame's own realm.
## Perception: reachability

- **A control the page marks but never names is listed, and flagged `inferred`.**
  Candidate selection is a CSS selector, and most custom cards and rows are a
  `div` with a handler, which no role-based selector reaches. An element with
  `tabindex` of 0 or more, or an `onclick` attribute, no role, no native tag,
  inside no listed control and holding none, is observed with `inferred: true`
  and the click affordance accepts it. The last two rules are what keep a
  scroll container or a focusable wrapper out. Deliberately not computed
  style (`cursor: pointer`): it would cost a style read per element against a
  500 ms pass and has no evidence behind it yet.
- **A control with no visible text is still named.** After text, a name comes
  from the face of a button-type input, the `alt` of the pictures inside it,
  then its `title`, ahead of a placeholder. An icon-only close button used to
  reach the model with no name to choose it by.
- **A read that runs out of budget says so; it does not fail the run.**
  `selectObservedCandidates` stops where the pass's time ran out and the
  observation carries `elementsPartial`. A partial list is a gap in what was
  read, never a fact about the page, so three things refuse to treat it as one:
  the model is told (prompt and projection) that an unlisted control may exist
  and should be found with `find`, `inspect` or a scroll; the effect verifier
  reads its after-observation in full or throws, because every verdict there
  reads elements and an unlisted control looks removed; and the completion
  judge refuses to confirm a change from it. A read-only answer quoting page
  text is not held to it. Nothing selected at all still throws — there is
  no overview to hand back.

- **Off the fold and out of reach are different answers.** `resolveVisibility`
  is a conjunction, so a below-fold row collapses into the same `false` as a
  `display:none` one; `isOffscreen` asks the question separately so the row
  keeps its name. What it must not do is answer it from layout alone — a
  control clipped to nothing by an ancestor that *cannot scroll*
  (`overflow: hidden`/`clip`, `contain: paint`: a closed accordion, a carousel
  track) is not a control a scroll brings into reach, and naming it as one
  sends the run scrolling for something that is not coming.
  `isUnreachablyClipped` walks the same ancestors as visibility with the
  scrollable ones deliberately skipped, because a row below the fold of a
  scroll pane is exactly what this is for.
- **A covered control is not a clickable one.** A laid-out, in-viewport element
  whose click points all hit-test to some unrelated element is marked
  `occluded`; it is still listed — the control exists — so the model dismisses
  the cover or scrolls rather than clicking a point the pointer cannot reach.
  An indeterminate hit test (no layout, or a `null` answer) reports no
  occlusion: a covered control wrongly shown is recoverable, a reachable one
  wrongly hidden is not.
## Projection and targeted reads

- **WebMCP is an optional page capability, never an authority.**
  `WXT_AGENT_WEBMCP=1` includes the experimental Chromium adapter; the runtime
  still feature-detects `document.modelContext` in each readable frame and
  ordinary DOM control remains the fallback. Tool names, descriptions,
  schemas, annotations and results are page-authored untrusted data.
  `readOnlyHint` never lowers policy and `consequentialHint` may only raise it.
  Until a trusted classifier exists, every page-tool call is conservatively
  classified as destructive and requires fresh critical approval.
- **A page-tool call is bound twice.** Discovery records the tab frame,
  browser document id and a digest of the advertised schema; execution
  re-discovers immediately before calling page code and refuses a changed
  digest. A rejected or aborted invocation is never replayed through DOM: once
  page code may have run, any lost acknowledgement stays an unresolved effect.

- **The window is resolved from the model, not written beside it.**
  `resolveAgentContextWindow` (`agent-context-window.ts`) takes the *smallest*
  figure the server's own allocation (`/api/show` `num_ctx`), the weights'
  metadata (`*.context_length`) and the catalog report, and falls back to what
  the agent has always reached when told nothing. A user setting overrides all
  of it in both directions. Resolved **once per run** — recomputing it per
  request made `num_ctx` drift step to step, and a local runner reloads the
  model when it moves.
- **The page is one budget claimant, not the whole prompt.** The context
  window is partitioned across instructions, tools, history, output and page
  content (`agent-model-port.ts`); the page gets the remainder and is projected
  to fit it. Every other claimant is bounded against the window too — the
  history keeps its newest entries, the answer allowance is sized by whether
  the page holds an editable text control at all. Bounding only the page held
  while the window was a literal at least as large as the others could grow;
  once it is resolved, an 8k model meets a twelve-step history and the page is
  trimmed to nothing while the request still overflows. A large application does not send every control — the overview
  keeps the focused control, the reachable ones and whatever fits in document
  order, and reports the rest in `omittedByGroup` so a control the budget
  dropped is discoverable, not silently absent. No budget preserves the whole
  projection.
- **A bounded overview is drilled into, not scrolled through.** Four read-only
  commands reveal what the overview summarised: `inspect` expands a region by
  its group, `find` surfaces controls matching a query, `extract` answers up to
  six queries in one walk of the document, `extract_text` returns the page's
  full text — the below-fold document the overview omits. None
  mutates the page, so all resolve as `read` and ask no approval. What to expand
  is derived from the previous step's own durable command
  (`currentAgentInspection`), so the next observation shows exactly what was
  asked and a worker restart rebuilds it — no separate run state. An expansion
  is still bounded by a hard ceiling (`pageContentMaxChars`, set from the
  context ceiling), so a two-thousand-control region or a maximal text extract
  cannot push the prompt past the window and truncate the system prompt.
- **A lookup is asked of every frame the run may read; a scope is not.**
  `extract` sends its questions to the root document and to each authorized
  child frame, and composition merges the answers into the group that asked
  for them, applying the per-question bound *after* the merge. It has to reach
  the frames: an empty group means "no such control", and a run told that
  about a control inside an authorized iframe stops looking for something that
  is there. A scope stays root-only because its answer is a count and a
  continuation offset, neither of which composes across documents. A frame
  answering a lookup is capped at one group per question rather than the whole
  remaining element budget, since a frame that matched nothing falls back to
  its overview — and that room is *reserved before the root is asked*, because
  the root falls back the same way and on a crowded page its consolation
  overview spent the whole budget before any frame was reached. A frame the
  budget still stopped marks every group `truncated`: the bound ended the
  search, not the page. A frame the run may not read does not, since the frame
  list already says so and an advertising frame would otherwise make the flag
  meaningless.
- **A read-only request that matched nothing says so.** A region is matched by
  the exact group name the observation publishes — `page` included, which is
  the name omissions outside any landmark are reported under and was for a
  while the one published region that could never match. A miss is reported as
  `unmatched`, with the regions the page does have, because the answer to a
  misnamed region is otherwise byte-identical to the answer to a real one and
  a model has no way to learn: one run spent twenty-one of its twenty-five
  observations asking for the same absent region.
## Screenshots

- **A screenshot is an observation's companion, never a record.** The
  controller pictures the tab (`AgentScreenshotPort`) only after the DOM
  observation is in hand and only for a model whose `vision` the model port
  resolved from the same evidence chain as tool calling; text-only models are
  offered no `look`/`click_point`/`zoom` and cost the page no capture. The picture
  carries the observation's snapshot identity and scroll, travels as the user
  message's image attachment, and is held for that decision and the resolution
  that follows — never persisted, logged, traced or shown. A capture that
  fails leaves the decision to the DOM; it never fails the run.
- **`auto` is the default, and it is a question about the step.** A capture
  costs an encode, a masking pass and — far the largest — an image prefill in
  the model's own window, and most steps decide from text and never look at
  it. `agentPictureWarranted` (`vision.ts`) takes one on an explicit `zoom` or
  `look`, on the first step of the run, after a step that did not confirm, on the
  first step on a **page the run has not seen** (compared against the last
  recorded step's source URL, so a query or fragment moving buys nothing), and
  on a page the DOM can barely describe — four controls or fewer with a
  document half again taller than its viewport. The new-page rule is what
  keeps recovery reachable: `zoom` and `click_point` are offered only where a
  screenshot exists, so a run that navigated to a canvas application and was
  refused a picture for having five buttons had no way left to ask to see it.
  `always` and `never` remain the user's to choose.
- **Asking to see is not the same as having a picture.** `look` requests a
  fresh capture of the viewport for the next step and is offered whenever the
  run *may* picture the page, picture or not; `zoom` and `click_point` name
  pixels and stay offered only alongside one. Without `look`, a same-URL
  canvas whose state is drawn rather than listed was visible only on whichever
  step the rules above happened to picture. Each step's model input carries
  `visual` — available, or the true reason it is not, in fact order: model
  text-only, no capture path, notice not acknowledged
  (`screenshotsPermitted`, a controller dependency rather than a `vision`
  wrapper, so a cleared model is never reported as blind), pictures turned
  off, a dialog held — and the prompt states that reason. A `look` whose
  capture comes back empty withdraws `look` for that document
  (`capture_failed`) until a new document or a later capture lands, so a page
  that cannot be masked does not eat the budget being asked again; the
  policy's own captures still try. `look` resolves and verifies as a pure read.
- **A picture can answer a read, and says it did.** A value drawn into a
  canvas is in no page text, so no quotation can ground it. When a
  `complete` arrives with a screenshot bound to its own observation, a met
  *read* outcome whose evidence nothing textual grounds is recorded as a
  `visual_observation`: the picture's snapshot identity and origin plus the
  model's own reading, never the image. The judge accepts that read only
  against a current record, quoted exactly, and lists it in
  `outcome.visual`; the card says "seen only in a screenshot" and the chat
  handoff carries `seen_in_screenshot_only`. It never settles a change, the
  reviewer does not count it as support, and text grounding wins whenever
  both support the same answer. Itemized reads retain each met item's own
  evidence, never the unchecked parent quotation; any accepted item that
  relies only on the picture marks its requirement in `outcome.visual`.
- **A changing picture is progress for a visual read.** The no-progress
  hash ignores pictures, so `look` after `look` on a live chart looked like a
  repeat. For `look` and `zoom` only, a hash of the picture the decision was
  shown is folded in, in memory; any other command ignores it, or a
  repainting video would pass a loop off as progress.
- **The run's page outline is hidden from every capture.** The viewport
  outline and the pressed-control highlight (`agent-page-indicator.ts`) are
  the debugger's `Overlay` domain, not page DOM, so observation, hit tests and
  forms never see them. A real Chromium does draw the overlay into
  `Page.captureScreenshot` — measured, not assumed — so a capture suspends it
  and nothing may redraw it until the capture has returned. The suspend flag
  is read again immediately before every draw, and a suspend waits for draws
  already sent to land before it hides the overlay, so a show started by a
  navigation or the post-click timer cannot finish inside a capture.
- **Nothing leaves unmasked.** `screenshot-capture.ts` asks the page for
  every region a picture must cover (`agent_sensitive_regions`): each sensitive
  control in the *whole composed tree* — never the bounded observation, which
  stops at its element budget — and every child frame. `frame-vision.ts` removes an owner mask only
  for an authorized, observed document whose exact CDP owner quad matches one
  unique measured frame region. It maps that document’s sensitive controls and
  still-masked children into root coordinates. Opaque, unauthorized, unmapped
  and geometrically unsupported frames remain masked whole. Regions are read at the observation's scroll
  position, then read again after the capture; any difference means the page
  moved under the picture and the step gets none. Masks are painted black in
  image pixels with a one-pixel margin and the long edge is bounded to
  `MAX_AGENT_SCREENSHOT_EDGE_PX`. The editor is the worker's `OffscreenCanvas`;
  without one there are no screenshots.
- **The fallback capture is the active tab's or nobody's.**
  `tabs.captureVisibleTab` pictures whichever tab is active in a window, so the
  debugger-less path (`visibleTabCaptureSource`) requires the controlled tab to
  be that tab immediately before and after the capture and returns nothing
  otherwise — a neighbouring tab stamped with this tab's identity would be
  masked for the wrong page.
- **Screenshots need their own acknowledgement, and the runtime enforces it.**
  `AGENT_REMOTE_SCREENSHOT_ACKNOWLEDGED` is separate from the observation
  acknowledgement. The panel shows the screenshot variant of the remote notice
  whenever pictures *may* travel — vision true or not yet determined — and
  `buildAgentController` refuses to picture a remote provider's run until the
  setting is set, whatever the panel showed at start. A local endpoint needs
  no acknowledgement; nothing leaves the device.
- **Coordinates convert through the picture's own geometry.** A screenshot
  records the CSS `region` it shows and its `scale` (image px per CSS px);
  `screenshot-geometry.ts` converts a model's image pixel to the root layout
  viewport point and back, which is how device scale, browser zoom, pinch zoom
  (`cssVisualViewport`) and a `zoom` crop all reduce to two numbers. `zoom` is
  read-only inspection: the next capture is a clip magnified to the zoom and
  edge caps, converted by the capture port from the geometry it remembered in
  memory — a restart forgets it and captures the whole viewport again.
- **A visual click is a click on the control under the point.** `click_point`
  resolves by asking the page what lies under the converted CSS point
  (`agent_hit_test`): the nearest listed control that contains the hit, else
  the hit element newly referenced into the live snapshot and observed like
  any other. Every click rule then applies — sensitive input, links,
  submitters, checkboxes — and only "not an activatable control" is waived,
  because a canvas is what a point exists to reach. A point inside a child
  frame descends only through the capture’s authorized frame manifest, checking
  the topmost iframe owner in each parent and resolving the child’s own ref. A stale picture
  cannot authorize a click: the screenshot must carry the command's snapshot
  and generation and the observation's scroll, and the executor re-hit-tests
  the point before anything is sent, refusing a control that moved.
- **Frame vision supports positive axis-aligned 2D scale and translation.**
  The session manager reads owner content/border quads in the owning CDP
  session and composes OOPIF session offsets and scales into root coordinates.
  Each revealed document retains its own snapshot, browser document id, scroll
  and owner geometry. Before resolution and dispatch, every binding in the
  clicked owner chain must still match; navigation, replacement, child scroll
  or owner movement invalidates it. Same-URL ambiguous siblings are never
  guessed. Rotation, skew, reflection, perspective and pixel-spilling filters
  stay masked with an explicit geometry limitation. A filter on a frame or
  its composed ancestors masks the whole containing viewport, since its
  pixels can spill beyond the owner rectangle. Older captures with no
  frame manifest authorize only root input. Debugger-less Firefox continues
  masking frames, while its existing DOM refs remain usable. Screenshot bytes
  never enter durable state; a resolved visual target holds only geometry.

  What a visual click does **not** answer to is our own reachability
  reconstruction. `elementFromPoint` is the browser saying what a pointer at
  that coordinate lands on; `visible` is `resolveVisibility` rebuilding the
  same fact from client rects, the viewport and every ancestor's overflow.
  When they disagree the reconstruction is wrong, so `hidden_target` is waived
  alongside `not_clickable`, and occlusion needs no waiver because a hit test
  returns the topmost element. Everything about what the click would *do* —
  sensitive fields, links, submitters, checkboxes, a disabled control — still
  governs. Overruling the browser here refused four different points across
  ChatGPT's composer as "not visible" until the run's budget was gone.

  The waiver reaches execution too. `assertUnchangedMutationTarget` re-read
  `visible` for every command, so a visual click was refused one layer later
  by exactly the reconstruction resolution had just waived: a run asked to
  open a video spent seventeen of its steps having approved clicks on a
  thumbnail refused as `target_changed`, and never touched the page. The
  executor re-hit-tests the point before it sends anything, so the browser
  keeps the last word; everything about what the click would *do* is still
  compared, and a ref click still refuses a control that left the page.
- Disclosure says whether pictures travel: `AgentProviderDisclosure.screenshots`
  is resolved from model vision, memoized per model, shown as unknown when it
  could not be determined, and switches the remote-provider notice to the
  variant that names screenshots.
