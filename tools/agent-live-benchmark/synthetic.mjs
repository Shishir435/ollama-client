import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { chromium } from "playwright"
import {
  agentObservedText,
  agentSawRenderedCanvas,
  approveChatTools,
  chatAnswered,
  chatAnswerFromWire,
  chatToolText,
  pagesOpenedDuringAttempt,
  readChatTurn,
  SETTLED_RUN_STATUSES,
  sendChatTask,
  startFreshChat,
  stopOpenRun,
  upstreamAuthorization,
  waitForChatState,
  withReasoningEffort
} from "./chat-turn.mjs"
import {
  endpointFingerprint,
  recordQualificationSettings
} from "./qualification-config.mjs"
import {
  QUALIFICATION_VERSION,
  selectQualificationTasks
} from "./qualification-corpus.mjs"
import { injectQualificationFault } from "./qualification-faults.mjs"
import {
  createQualificationState,
  qualificationHtml,
  recordQualificationRequest
} from "./qualification-fixtures.mjs"
import { qualificationDiagnostics } from "./qualification-report.mjs"
import { scoreQualification } from "./qualification-score.mjs"
import {
  baselineInputs,
  classifyAttempt,
  supervisionTelemetry,
  wireTelemetry,
  writeBaseline as writeCurrentBaseline
} from "./report.mjs"
import {
  isSiteChallenge,
  scoreSyntheticGoal,
  statesActive
} from "./score-answer.mjs"

/** Checked before any case runs, so a key bound for plain HTTP stops the run. */
const AUTHORIZATION = upstreamAuthorization(
  process.env.AUDIT_UPSTREAM ?? "http://127.0.0.1:8084",
  process.env.AUDIT_API_KEY
)

const qualification = process.env.AUDIT_SUITE === "qualification"
const suite = qualification ? "qualification" : "synthetic"
const model =
  process.env.AUDIT_MODEL ?? "opencode/muse-spark-1.3-contributor-free"
const out = resolve(
  `artifacts/agent-live-benchmark/${suite}/` +
    model.replace(/[^a-z0-9.-]+/gi, "_") +
    "/" +
    new Date().toISOString().replace(/[:.]/g, "-")
)
mkdirSync(out, { recursive: true })
const syntheticCases = [
  ["click", "Click Continue and report the status."],
  ["form", "Enter Alice in Name, continue, and tell me the status."],
  ["details", "Open Details and tell me the status."],
  ["read", "Find the version displayed on this page."],
  ["select", "Select Blue from Color. Finish when Blue is selected."],
  ["checkbox", "Check Agree. Finish when checked."],
  ["uncheck", "Uncheck Agree. Finish when unchecked."],
  ["scroll", "Scroll down to find the status and report it."],
  ["menu", "Open Menu, click Details, and report the status."],
  ["modal", "Open dialog and report its status."],
  ["delayed", "Click Continue, wait for the status, and report it."],
  ["stale", "Click Continue and report the status."],
  ["ambiguous", "Click Continue once and report the status."],
  ["spaform", "Enter Alice in Name, continue, and tell me the status."],
  [
    "keypress",
    "Move keyboard focus from First to Second using Tab. Finish once Second has focus."
  ],
  ["redirect", "Open Details and report the status."],
  ["open_tab", "Open Details in a new tab and tell me the status."],
  [
    "memory",
    "Remember the reference code shown here, open Details, and report both the reference code and the status code."
  ],
  ["canvas", "Click Render, then tell me the code drawn on the canvas."],
  /**
   * Recovery cases, declared before PR 9 was measured: a banner covering the
   * control until it is accepted, and a link whose page has moved, so the
   * first route fails and another one on the page succeeds.
   */
  ["overlay", "Click Continue and report the status."],
  ["wrongpath", "Open the status page and report the status."]
]
const only = (process.env.AUDIT_ONLY ?? "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean)
const qualificationTasks = qualification
  ? selectQualificationTasks(process.env.AUDIT_SPLIT ?? "development", only)
  : []
const cases = qualification
  ? qualificationTasks.map((task) => [task.id, task.goal])
  : syntheticCases
const attemptCount = Number(process.env.AUDIT_ATTEMPTS ?? "3")
if (!Number.isSafeInteger(attemptCount) || attemptCount < 1)
  throw new Error("AUDIT_ATTEMPTS must be a positive integer")
if (only.some((name) => !cases.some((c) => c[0] === name)))
  throw new Error("Unknown AUDIT_ONLY task")
const declared = cases
  .filter((c) => !only.length || only.includes(c[0]))
  .flatMap((c) =>
    Array.from({ length: attemptCount }, (_, i) => ({
      fields: c,
      attempt: i + 1
    }))
  )
const inputs = baselineInputs({
  buildDirectory: "build/chrome-mv3-prod",
  corpusFiles: [
    "tools/agent-live-benchmark/synthetic.mjs",
    "tools/agent-live-benchmark/score-answer.mjs",
    "tools/agent-live-benchmark/chat-turn.mjs",
    "tools/agent-live-benchmark/report.mjs",
    ...(qualification
      ? [
          "tools/agent-live-benchmark/qualification-corpus.mjs",
          "tools/agent-live-benchmark/qualification-fixtures.mjs",
          "tools/agent-live-benchmark/qualification-score.mjs",
          "tools/agent-live-benchmark/qualification-faults.mjs",
          "tools/agent-live-benchmark/qualification-report.mjs",
          "tools/agent-live-benchmark/qualification-config.mjs"
        ]
      : [])
  ],
  provider: process.env.AUDIT_PROVIDER_ID ?? "openai-compatible",
  model,
  reasoningEffort: process.env.AUDIT_REASONING_EFFORT,
  visionMode: "capability_resolved",
  budgets: {
    attempts: attemptCount,
    taskTimeoutMs: 150000,
    answerTimeoutMs: 45000
  },
  policy: {
    agentEnabled: true,
    permissionMode: "allow_routine",
    approvals: "automatic",
    interventions: "none",
    rawDebugEvidence: process.env.AUDIT_DEBUG_EVIDENCE === "1"
  }
})
if (qualification) {
  inputs.corpusVersion = QUALIFICATION_VERSION
  inputs.executionKind = "live_model"
  inputs.qualification = {
    version: QUALIFICATION_VERSION,
    split: process.env.AUDIT_SPLIT ?? "development",
    taskIds: qualificationTasks.map((task) => task.id),
    harness: "ollama-client",
    endpointFingerprint: endpointFingerprint(
      process.env.AUDIT_UPSTREAM ?? "http://127.0.0.1:8084"
    ),
    modelSettings: {
      temperature: "extension_default",
      reasoningEffort: inputs.reasoningEffort
    },
    capabilities: [
      ...new Set(qualificationTasks.flatMap((task) => task.capabilities))
    ],
    disclosureChecks: "text_canary_and_external_egress",
    screenshotDisclosure: "requires_separate_frame_vision_regressions"
  }
}
const writeBaseline = (directory, pinned, rows) => {
  const report = writeCurrentBaseline(directory, pinned, rows)
  if (!qualification) return report
  const qualified = qualificationDiagnostics(report)
  writeFileSync(
    join(directory, "qualification.json"),
    JSON.stringify(qualified, null, 2)
  )
  return qualified
}
let externalOrigin
let profile,
  current,
  fixture,
  context,
  panel,
  wire = [],
  messages = [],
  logs = [],
  chatApprovals = 0,
  results = declared.map(({ fields, attempt }) => ({
    task: fields[0],
    ...(qualification
      ? {
          family: qualificationTasks.find((task) => task.id === fields[0])
            .family,
          split: qualificationTasks.find((task) => task.id === fields[0]).split
        }
      : {}),
    attempt,
    status: "not_attempted",
    verdict: "infrastructure_failure",
    failureCode: "harness_not_reached"
  }))
writeBaseline(out, inputs, results)
/** Start pages that are fixed markup, with no per-task wiring. */
const STATIC_PAGES = {
  read: "<h1>Release</h1><p>Version: 0.14.0</p>",
  /**
   * Six controls, so `auto` vision skips the picture after the first step,
   * and a code drawn only into the canvas by Render: the URL and the control
   * list stay the same, so the only way to read it is to ask for a picture.
   * The status line is what lets the click verify — a click whose only effect
   * is pixels is an unresolved effect, and the run rightly pauses on it — and
   * it never carries the code. It starts empty: a line reading "Not
   * rendered." contains "rendered", so quoting "Rendered." was refused as
   * text the page already showed.
   */
  canvas:
    ["Pen", "Eraser", "Undo", "Redo", "Clear"]
      .map((label) => `<button type="button">${label}</button>`)
      .join("") +
    "<button type=\"button\" onclick=\"fetch('/effect');const c=document.querySelector('canvas').getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,480,160);c.fillStyle='#000';c.font='bold 56px sans-serif';c.fillText('KV-305',90,100);document.getElementById('state').textContent='Rendered.'\">Render</button>" +
    '<p id="state"></p>' +
    '<canvas width="480" height="160" style="display:block;border:1px solid #888"></canvas>'
}
/**
 * The recovery cases' pages, or undefined for any other case. A covering
 * banner that only Accept removes, and a status link whose page has moved
 * while Reports still lists it.
 */
const recoveryPage = (kind, path, wrap, effect) => {
  if (kind === "wrongpath" && path.includes("/old"))
    return '<!doctype html><title>Moved</title><main><p>This page has moved.</p><a href="/">Home</a></main>'
  if (kind === "wrongpath" && !path.includes("/details"))
    return wrap(
      '<a href="/wrongpath/old">Status page</a><p>Older pages are listed under <a href="/wrongpath/details">Reports</a>.</p>'
    )
  if (kind === "overlay")
    return wrap(
      '<div id="banner" style="position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;justify-content:center"><div style="background:#fff;padding:16px">We use cookies. <button type="button" onclick="document.getElementById(\'banner\').remove()">Accept</button></div></div><button type="button" onclick="' +
        effect +
        '">Continue</button>'
    )
  return undefined
}
const basePage = (kind, path) => {
  if (path.includes("/details"))
    return (
      "<!doctype html><title>Details</title><main>Status: Active" +
      (kind === "memory" ? "<p>Status code: ZX-482</p>" : "") +
      "</main>"
    )
  const wrap = (s) =>
    `<!doctype html><title>Audit ${kind}</title><main>${s}</main>`
  const effect =
    "fetch('/effect');document.querySelector('main').innerHTML='<p>Status: Active</p>'"
  if (Object.hasOwn(STATIC_PAGES, kind)) return wrap(STATIC_PAGES[kind])
  if (kind === "select")
    return wrap(
      '<label>Color <select><option value="red">Red</option><option value="blue">Blue</option></select></label>'
    )
  if (kind === "checkbox" || kind === "uncheck")
    return wrap(
      '<label><input type="checkbox" ' +
        (kind === "uncheck" ? "checked" : "") +
        ">Agree</label>"
    )
  if (kind === "scroll")
    return wrap(
      '<h1>Report</h1><div style="height:1600px">Scroll down</div><p>Status: Active</p>'
    )
  if (kind === "keypress")
    return wrap(
      '<label>First<input id="first" autofocus></label><label>Second<input id="second"></label>'
    )
  if (kind === "menu")
    return wrap(
      '<button onclick="document.querySelector(\'nav\').hidden=false">Menu</button><nav hidden><a href="/' +
        kind +
        '/details">Details</a></nav>'
    )
  if (kind === "modal")
    return wrap(
      "<button onclick=\"document.querySelector('dialog').showModal()\">Open dialog</button><dialog><p>Status: Active</p><button onclick=\"this.closest('dialog').close()\">Close</button></dialog>"
    )
  if (["details", "open_tab", "redirect", "memory"].includes(kind))
    return wrap(
      (kind === "memory" ? "<p>Reference code: QP-719</p>" : "") +
        '<a href="/' +
        kind +
        "/" +
        (kind === "redirect" ? "redirect" : "details") +
        '">Details</a>'
    )
  if (kind === "form" || kind === "spaform")
    return wrap(
      "<form " +
        (kind === "form"
          ? 'action="/form/details"'
          : "onsubmit=\"event.preventDefault();fetch('/effect');document.querySelector('main').innerHTML='<p>Status: Active</p>'\"") +
        '><label for="name">Name</label><input id="name" name="name"><button>Continue</button></form>'
    )
  return wrap(
    '<button type="button" onclick="' +
      (kind === "ambiguous"
        ? "fetch('/effect')"
        : kind === "delayed"
          ? "fetch('/effect');setTimeout(()=>document.querySelector('main').innerHTML='<p>Status: Active</p>',1200)"
          : effect) +
      '">Continue</button>'
  )
}
const html = (kind, path) =>
  recoveryPage(
    kind,
    path,
    (s) => `<!doctype html><title>Audit ${kind}</title><main>${s}</main>`,
    "fetch('/effect');document.querySelector('main').innerHTML='<p>Status: Active</p>'"
  ) ?? basePage(kind, path)
const serveQualification = (path, body, res, method) => {
  if (
    !qualification ||
    !current?.qualification ||
    (path !== current.qualification.base &&
      !path.startsWith(`${current.qualification.base}/`))
  )
    return false
  {
    const state = current.qualification
    recordQualificationRequest(state, path, body, false, method)
    if (path.includes("/effect/")) {
      res.end("ok")
      return true
    }
    if (path.endsWith("/redirect")) {
      res.writeHead(302, {
        Location: `${externalOrigin}${current.qualification.base}/private`
      })
      res.end()
      return true
    }
    res.setHeader("Content-Type", "text/html")
    res.end(qualificationHtml(state, path, externalOrigin))
    return true
  }
}
const server = createServer(async (req, res) => {
  try {
    const path = req.url ?? "/"
    let body = ""
    for await (const c of req) body += c
    if (path.startsWith("/v1/")) {
      const rec = {
        path,
        started: Date.now(),
        request: body ? JSON.parse(body) : undefined
      }
      wire.push(rec)
      if (qualification)
        recordQualificationSettings(
          inputs,
          rec.request,
          process.env.AUDIT_REASONING_EFFORT
        )
      if (
        qualification &&
        current?.qualification &&
        (await injectQualificationFault(
          current.qualification,
          fixture,
          rec.request
        ))
      ) {
        rec.status = 503
        rec.response = JSON.stringify({
          error: { message: "Controlled transient failure" }
        })
        rec.elapsedMs = Date.now() - rec.started
        res.writeHead(503, {
          "Content-Type": "application/json",
          "Retry-After": "0"
        })
        res.end(rec.response)
        return
      }
      if (
        path.endsWith("/chat/completions") &&
        current.kind === "stale" &&
        !current.replaced
      ) {
        current.replaced = true
        await fixture.evaluate(() => {
          const e = document.querySelector("button")
          e.replaceWith(e.cloneNode(true))
        })
      }
      const upstream = await fetch(
        (process.env.AUDIT_UPSTREAM ?? "http://127.0.0.1:8084") + path,
        {
          method: req.method,
          headers: {
            "Content-Type": "application/json",
            ...AUTHORIZATION
          },
          ...(body ? { body: withReasoningEffort(path, body) } : {})
        }
      )
      res.writeHead(upstream.status, {
        "Content-Type":
          upstream.headers.get("content-type") ?? "application/json"
      })
      rec.status = upstream.status
      rec.response = ""
      for await (const chunk of upstream.body) {
        const text = Buffer.from(chunk).toString()
        rec.response += text
        res.write(chunk)
      }
      rec.elapsedMs = Date.now() - rec.started
      res.end()
      return
    }
    if (serveQualification(path, body, res, req.method)) return
    if (path === "/effect") {
      current.effects++
      res.end("ok")
      return
    }
    if (path.endsWith("/redirect")) {
      res.writeHead(302, { Location: "/redirect/details" })
      res.end()
      return
    }
    res.setHeader("Content-Type", "text/html")
    res.end(html(current?.kind ?? "click", path))
  } catch (e) {
    res.statusCode = 502
    res.end(JSON.stringify({ error: { message: String(e) } }))
  }
})
const externalServer = createServer(async (req, res) => {
  let body = ""
  for await (const chunk of req) body += chunk
  if (!current?.qualification) {
    res.writeHead(404)
    res.end()
    return
  }
  recordQualificationRequest(
    current.qualification,
    req.url ?? "/",
    body,
    true,
    req.method
  )
  if ((req.url ?? "").includes("/effect/")) {
    res.end("ok")
    return
  }
  res.setHeader("Content-Type", "text/html")
  res.end(
    qualificationHtml(current.qualification, req.url ?? "/", externalOrigin)
  )
})
try {
  if (qualification) {
    await new Promise((r, reject) =>
      externalServer.once("error", reject).listen(0, "127.0.0.1", r)
    )
    externalOrigin = `http://127.0.0.1:${externalServer.address().port}`
  }
  await new Promise((r, reject) =>
    server.once("error", reject).listen(0, "127.0.0.1", r)
  )
  const origin = `http://127.0.0.1:${server.address().port}`
  profile = mkdtempSync(join(tmpdir(), "ollama-agent-audit-"))
  const build = join(profile, "extension")
  cpSync("build/chrome-mv3-prod", build, { recursive: true })
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 720 },
    args: [`--disable-extensions-except=${build}`, `--load-extension=${build}`]
  })
  const worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
  const ext = new URL(worker.url()).host
  await worker.evaluate(() => (globalThis.__OLLAMA_CLIENT_AGENT_TRACE__ = true))
  worker.on("console", async (m) => {
    try {
      logs.push({
        at: Date.now(),
        args: await Promise.all(m.args().map((x) => x.jsonValue()))
      })
    } catch {}
  })
  panel = await context.newPage()
  await panel.goto(`chrome-extension://${ext}/sidepanel.html`)
  await panel.evaluate(
    async ({ origin, model }) => {
      await chrome.storage.sync.set({
        llm_providers_config_v1: JSON.stringify([
          {
            id: "custom:openai:agent-audit",
            type: "openai",
            name: "OLC audit",
            enabled: true,
            baseUrl: `${origin}/v1`
          }
        ]),
        "provider-selected-model-ref": JSON.stringify({
          providerId: "custom:openai:agent-audit",
          modelId: model
        }),
        /** Seen, so the one-time notice cannot cover the panel mid-task. */
        "agent-announcement-dismissed-v1": JSON.stringify(true)
      })
      /**
       * The agent is opt-in and device-local; off, `browser_task` is never
       * offered and every task would measure the "agent is off" card.
       */
      await chrome.storage.local.set({
        "agent-enabled-v1": JSON.stringify(true),
        "agent-permission-mode-v1": JSON.stringify("allow_routine")
      })
    },
    { origin, model }
  )
  await panel.reload()
  await panel.exposeFunction("auditMessage", (m) =>
    messages.push({ at: Date.now(), ...m })
  )
  await panel.evaluate(() => {
    const p = chrome.runtime.connect({ name: "agent-run-port" })
    window.auditPort = p
    p.onMessage.addListener((m) => {
      window.auditMessage(m)
      if (
        m.snapshot?.pending?.kind === "approval" &&
        (!window.auditAllowedOrigins ||
          [
            m.snapshot.pending.request.origin,
            m.snapshot.pending.request.routineOrigin
          ]
            .filter(Boolean)
            .every((origin) => window.auditAllowedOrigins.includes(origin)))
      )
        p.postMessage({
          type: "agent_approve",
          runId: m.snapshot.run.id,
          requestId: m.snapshot.pending.request.id
        })
    })
  })
  await panel
    .getByRole("button", { name: "Skip for now", exact: true })
    .click({ timeout: 3000 })
    .catch(() => {})
  await panel
    .getByRole("button", { name: "Start Chatting" })
    .click({ timeout: 3000 })
    .catch(() => {})
  /**
   * A task is an ordinary chat message: the chat model delegates it through
   * `browser_task`, whose start is asked about the first time on each site. The
   * previous task's turn has to finish before the composer sends again.
   */
  class FreshChatFailed extends Error {}

  const sendTask = async (goal) => {
    /**
     * A case that could not get a chat of its own is not run: sent into the
     * previous chat, an earlier task's context could answer it. The reset
     * happens once the previous turn is over, inside the send.
     */
    let fresh = true
    const sent = await sendChatTask(panel, goal, {
      prepare: () =>
        startFreshChat(panel).catch((error) => {
          fresh = false
          console.warn(
            `[benchmark] could not start a fresh chat: ${error.message}`
          )
          throw new FreshChatFailed()
        })
    }).catch((error) => {
      if (error instanceof FreshChatFailed)
        return { started: false, invalid: "fresh_chat_failed" }
      throw error
    })
    if (!fresh) return sent
    if (!sent.started) return sent
    return sent
  }
  for (const [index, declaration] of declared.entries()) {
    const [kind, goal] = declaration.fields
    const attempt = declaration.attempt
    const attemptStarted = Date.now()
    const pagesBeforeAttempt = new Set(context.pages())
    try {
      const task = qualificationTasks.find((entry) => entry.id === kind)
      current = {
        kind,
        effects: 0,
        replaced: false,
        ...(task ? { qualification: createQualificationState(task) } : {})
      }
      if (task) current.qualification.base = `/q/${kind}/a${attempt}`
      await panel.evaluate(
        (allowed) => {
          window.auditAllowedOrigins = allowed
        },
        qualification
          ? [
              origin,
              ...(task.family === "widgets" && task.variant === "cross_origin"
                ? [externalOrigin]
                : [])
            ]
          : undefined
      )
      wire = []
      messages = []
      logs = []
      chatApprovals = 0
      const started = Date.now()
      fixture = await context.newPage()
      await fixture.goto(
        qualification
          ? `${origin}${current.qualification.base}`
          : `${origin}/${kind}`
      )
      await fixture.bringToFront()
      const sent = await sendTask(goal)
      /**
       * The case's clock starts once the task is sent. Waiting out the previous
       * turn is the harness's time, and charging it to this case scored a task
       * that took 26s as 146s.
       */
      const sentAt = Date.now()
      /**
       * A task the composer never accepted is scored as not started: calling
       * it a timeout charged the model for a case it was never given.
       */
      let final
      let reason = sent.started
        ? undefined
        : (sent.invalid ?? "turn_not_started")
      /**
       * The chat model may answer a reading task itself, from the page, without
       * delegating a run. No run will ever appear, so an idle chat turn with no
       * run is the end of the case rather than a wait for the deadline.
       */
      let idleSince
      while (sent.started && Date.now() - sentAt < 150000) {
        final = messages
          .filter((m) => (m.snapshot?.run?.createdAt ?? 0) >= started)
          .at(-1)?.snapshot
        if (
          final &&
          [
            "completed",
            "partial",
            "failed",
            "paused",
            "awaiting_takeover"
          ].includes(final.run.status)
        )
          break
        if (
          !fixture.isClosed() &&
          kind === "spaform" &&
          new URL(fixture.url()).search
        ) {
          reason = "submission_handler_bypassed"
          break
        }
        /**
         * The chat model may call several tools before \`browser_task\` — the
         * tab, a screenshot — and each asks once. Approving only the first
         * left the delegation itself waiting on a card nobody clicked.
         */
        if (await approveChatTools(panel)) chatApprovals++
        if (!final) {
          const chat = await readChatTurn(panel, goal).catch(() => undefined)
          if (chat && !chat.busy && chat.sendReady && chatAnswered(wire)) {
            idleSince ??= Date.now()
            if (Date.now() - idleSince >= 3000) break
          } else {
            idleSince = undefined
          }
        }
        await new Promise((r) => setTimeout(r, 250))
      }
      const body = await fixture
        .locator("body")
        .innerText()
        .catch(() => "")
      const field = await fixture
        .evaluate(() => ({
          value: document.querySelector("select")?.value,
          checked: document.querySelector("[type=checkbox]")?.checked,
          focus: document.activeElement?.id,
          name: document.querySelector("#name")?.value,
          color: document.querySelector("#color")?.value,
          agree: document.querySelector("#agree")?.checked
        }))
        .catch(() => ({}))
      await stopOpenRun(panel, final)
      const delegated = Boolean(final)
      /**
       * What the user is told is the chat's reply, not the run's result: the
       * chat may read part of the task itself and delegate the rest, then
       * answer with both. Scoring the run alone failed a case whose reply
       * carried everything asked for, so a settled run waits for that reply.
       */
      if (delegated && ["completed", "failed"].includes(final.run.status)) {
        await waitForChatState(
          () => readChatTurn(panel, goal),
          (chat) => !chat.busy && chatAnswered(wire),
          { stableMs: 1000, timeoutMs: 45_000 }
        )
      }
      const chatAnswer = chatAnswerFromWire(wire)
      const answer = chatAnswer || final?.run?.result || ""
      const completed =
        final?.run?.status === "completed" ||
        (!delegated && chatAnswered(wire) && Boolean(chatAnswer))
      const status =
        final?.run?.status ??
        (!sent.started
          ? sent.invalid
            ? "harness_invalid"
            : "turn_not_started"
          : chatAnswered(wire) && chatAnswer
            ? "answered_in_chat"
            : "harness_timeout")
      // The opener page never shows the status for open_tab; the new tab must.
      let openTabActive = false
      if (kind === "open_tab") {
        for (const p of pagesOpenedDuringAttempt(
          context.pages(),
          pagesBeforeAttempt,
          fixture
        )) {
          if (!/\/details(\/|$)/.test(p.url())) continue
          const text = await p
            .locator("body")
            .innerText()
            .catch(() => "")
          if (statesActive(text)) {
            openTabActive = true
            break
          }
        }
      }
      const renderedCanvasScreenshot = agentSawRenderedCanvas(wire, origin)
      const qualificationPages = []
      if (qualification)
        for (const page of context.pages()) {
          if (page === panel || page.isClosed()) continue
          const pageUrl = new URL(page.url())
          if (![origin, externalOrigin].includes(pageUrl.origin)) continue
          const widgetSaved = await page
            .locator("iframe")
            .evaluateAll((frames) =>
              frames.some((frame) => {
                try {
                  return frame.contentDocument?.body.textContent.includes(
                    "Saved"
                  )
                } catch {
                  return false
                }
              })
            )
            .catch(() => false)
          const childSaved = await Promise.all(
            page
              .frames()
              .filter((frame) => frame !== page.mainFrame())
              .map((frame) =>
                frame
                  .locator("body")
                  .innerText()
                  .then(
                    (text) => text.includes("Saved"),
                    () => false
                  )
              )
          )
          qualificationPages.push({
            path: pageUrl.pathname,
            widgetSaved: widgetSaved || childSaved.some(Boolean)
          })
        }
      const scored = qualification
        ? scoreQualification({
            state: current.qualification,
            answer,
            body,
            field,
            pages: qualificationPages,
            path: new URL(fixture.url()).pathname,
            status,
            pauseReason: final?.run?.pauseReason,
            wire,
            observedText: [
              chatToolText(wire),
              agentObservedText(wire, origin)
            ].join("\n"),
            renderedCanvasScreenshot
          })
        : scoreSyntheticGoal({
            kind,
            completed,
            answer,
            body,
            field,
            effects: current.effects,
            url: fixture.url(),
            pauseReason: final?.run?.pauseReason,
            openTabActive,
            readText: chatToolText(wire),
            observedText: agentObservedText(wire, origin),
            renderedCanvasScreenshot,
            delegated: delegated && final.run.status === "completed"
          })
      const success = scored.success
      const predicate = scored.predicate
      const expectedPause = qualification
        ? current.qualification.task.expectedPause
        : kind === "ambiguous"
      const verdict = classifyAttempt({
        status,
        success,
        expectedPause,
        pauseReason: final?.run?.pauseReason,
        errorCode: final?.run?.error?.code,
        infrastructureFailure: status === "harness_invalid",
        admissionFailure:
          status === "turn_not_started" ||
          (!final &&
            wireTelemetry(wire).executionStages.includes(
              "browser_task_admission"
            )),
        providerFailure: wire.some((w) => w.status >= 400),
        siteBlocked: isSiteChallenge(body)
      })
      const row = {
        task: kind,
        ...(qualification
          ? {
              family: current.qualification.task.family,
              split: current.qualification.task.split,
              duplicateEffects: scored.duplicateEffects,
              unauthorizedDisclosures: scored.unauthorizedDisclosures,
              adjudication: scored.adjudication,
              faultInjected: scored.faultInjected
            }
          : {}),
        attempt,
        goal,
        provider:
          "OLC OpenCode " +
          (process.env.AUDIT_UPSTREAM ?? "http://127.0.0.1:8084"),
        model,
        success,
        verdict,
        predicate,
        ...(kind === "canvas" ? { renderedCanvasScreenshot } : {}),
        /** Decisions that asked for a fresh picture; see the canvas task. */
        lookCalls: logs.filter((entry) =>
          /"phase":"decision".*"action":"look"/.test(JSON.stringify(entry.args))
        ).length,
        expectedPause,
        status,
        delegated,
        reason: reason ?? final?.run?.error ?? final?.run?.pauseReason,
        steps: final?.run?.stepCount,
        ...wireTelemetry(wire),
        ...supervisionTelemetry(messages, sentAt, Date.now()),
        approvalsGranted: (final?.run?.grants?.length ?? 0) + chatApprovals,
        observations: final?.run?.observationCount ?? 0,
        /** Recovery strategies the run spent, from its own durable count. */
        recoveries: final?.run?.recovery?.attempts ?? 0,
        errorCode: final?.run?.error?.code,
        pauseReason: final?.run?.pauseReason,
        latencyMs: Date.now() - sentAt,
        effects: qualification
          ? current.qualification.effects.length
          : current.effects,
        answer,
        url: fixture.url(),
        field
      }
      results[index] = row
      if (process.env.AUDIT_DEBUG_EVIDENCE === "1") {
        const dir = join(out, `${kind}-${attempt}`, "local-debug")
        mkdirSync(dir, { recursive: true, mode: 0o700 })
        writeFileSync(
          join(dir, "evidence.json"),
          JSON.stringify(
            { row, messages, wire, logs, body },
            (key, value) =>
              [
                "image_url",
                "image",
                "images",
                "screenshot",
                "authorization",
                "apiKey"
              ].includes(key)
                ? "[REDACTED]"
                : value,
            2
          ),
          { mode: 0o600 }
        )
      }
      const report = writeBaseline(out, inputs, results)
      console.log(JSON.stringify(report.attempts[index]))
      if (final?.run && !SETTLED_RUN_STATUSES.includes(final.run.status)) {
        await panel.evaluate(
          (id) =>
            window.auditPort.postMessage({ type: "agent_stop", runId: id }),
          final.run.id
        )
        await new Promise((r) => setTimeout(r, 500))
      }
      await Promise.all(
        pagesOpenedDuringAttempt(
          context.pages(),
          pagesBeforeAttempt,
          fixture
        ).map((page) => page.close().catch(() => {}))
      )
      await fixture.close()
    } catch {
      results[index] = {
        task: declaration.fields[0],
        ...(qualification && current?.qualification
          ? scoreQualification({
              state: current.qualification,
              status: "harness_exception",
              body: "",
              answer: "",
              observedText: "",
              wire
            })
          : {}),
        ...(qualification
          ? {
              family: current?.qualification?.task.family,
              split: current?.qualification?.task.split
            }
          : {}),
        attempt,
        status: "harness_exception",
        verdict: "infrastructure_failure",
        failureCode: "harness_exception",
        wallMs: Date.now() - attemptStarted,
        ...wireTelemetry(wire)
      }
      writeBaseline(out, inputs, results)
      await stopOpenRun(panel, messages.at(-1)?.snapshot).catch(() => {})
      await Promise.all(
        pagesOpenedDuringAttempt(
          context?.pages() ?? [],
          pagesBeforeAttempt,
          fixture
        ).map((page) => page.close().catch(() => {}))
      )
      await fixture?.close().catch(() => {})
    }
  }
} catch {
  console.error(
    "Benchmark setup failed; declared attempts retained as infrastructure failures"
  )
  process.exitCode = 1
} finally {
  if (results.some((row) => row.verdict === "infrastructure_failure"))
    process.exitCode = 1
  writeBaseline(out, inputs, results)
  await context?.close()
  externalServer.closeAllConnections()
  externalServer.close()
  server.closeAllConnections()
  server.close()
  if (profile) console.log(`AUDIT_PROFILE ${profile}`)
}
