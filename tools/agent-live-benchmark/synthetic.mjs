import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { chromium } from "playwright"
import {
  scoreSyntheticTask,
  scoreVerdict,
  statesActive
} from "./score-answer.mjs"

const model =
  process.env.AUDIT_MODEL ?? "opencode/muse-spark-1.3-contributor-free"
const out = resolve(
  "artifacts/agent-live-benchmark/synthetic/" +
    model.replace(/[^a-z0-9.-]+/gi, "_")
)
mkdirSync(out, { recursive: true })
const cases = [
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
  ]
]
let current,
  fixture,
  context,
  panel,
  wire = [],
  messages = [],
  logs = [],
  results = []
const html = (kind, path) => {
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
  if (kind === "read") return wrap("<h1>Release</h1><p>Version: 0.14.0</p>")
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
          headers: { "Content-Type": "application/json" },
          ...(body ? { body } : {})
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
await new Promise((r) => server.listen(0, "127.0.0.1", r))
const origin = `http://127.0.0.1:${server.address().port}`
const profile = mkdtempSync(join(tmpdir(), "ollama-agent-audit-"))
const build = join(profile, "extension")
cpSync("build/chrome-mv3-prod", build, { recursive: true })
const manifest = JSON.parse(readFileSync(join(build, "manifest.json")))
manifest.permissions.push("webNavigation")
manifest.optional_permissions = manifest.optional_permissions.filter(
  (x) => x !== "webNavigation"
)
writeFileSync(join(build, "manifest.json"), JSON.stringify(manifest))
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
      })
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
    if (m.snapshot?.pending?.kind === "approval")
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
await panel.getByRole("button", { name: /^Agent/ }).click()
try {
  for (const [kind, goal] of cases) {
    current = { kind, effects: 0, replaced: false }
    wire = []
    messages = []
    logs = []
    const started = Date.now()
    fixture = await context.newPage()
    await fixture.goto(`${origin}/${kind}`)
    await fixture.bringToFront()
    await panel
      .getByRole("textbox", { name: "What should Agent do?" })
      .fill(goal)
    await panel
      .getByRole("button", { name: "Start Agent", exact: true })
      .click()
    let final, reason
    while (Date.now() - started < 150000) {
      final = messages
        .filter((m) => m.snapshot?.run?.goal === goal)
        .at(-1)?.snapshot
      if (
        final &&
        ["completed", "failed", "paused", "awaiting_takeover"].includes(
          final.run.status
        )
      )
        break
      if (kind === "spaform" && new URL(fixture.url()).search) {
        reason = "submission_handler_bypassed"
        break
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
        focus: document.activeElement?.id
      }))
      .catch(() => ({}))
    const answer = final?.run?.result ?? ""
    const completed = final?.run?.status === "completed"
    const status = final?.run?.status ?? "harness_timeout"
    // The opener page never shows the status for open_tab; the new tab must.
    let openTabActive = false
    if (kind === "open_tab") {
      for (const p of context.pages()) {
        if (p === fixture) continue
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
    const scored = scoreSyntheticTask({
      kind,
      completed,
      answer,
      body,
      field,
      effects: current.effects,
      url: fixture.url(),
      pauseReason: final?.run?.pauseReason,
      openTabActive
    })
    const success = scored.success
    const predicate = scored.predicate
    const expectedPause = kind === "ambiguous"
    const verdict = scoreVerdict({ status, success })
    const calls = wire.filter((w) => w.path.endsWith("/chat/completions"))
    const row = {
      task: kind,
      goal,
      provider:
        "OLC OpenCode " +
        (process.env.AUDIT_UPSTREAM ?? "http://127.0.0.1:8084"),
      model,
      success,
      verdict,
      predicate,
      expectedPause,
      status: final?.run?.status ?? "harness_timeout",
      reason: reason ?? final?.run?.error ?? final?.run?.pauseReason,
      steps: final?.run?.stepCount,
      modelCalls: calls.length,
      latencyMs: Date.now() - started,
      effects: current.effects,
      answer,
      url: fixture.url(),
      field
    }
    results.push(row)
    const dir = join(out, kind)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, "evidence.json"),
      JSON.stringify({ row, messages, wire, logs, body }, null, 2)
    )
    await fixture.screenshot({ path: join(dir, "page.png") }).catch(() => {})
    writeFileSync(
      join(out, "benchmark-results.json"),
      JSON.stringify(results, null, 2)
    )
    console.log(JSON.stringify(row))
    if (
      final?.run &&
      !["completed", "failed", "cancelled"].includes(final.run.status)
    ) {
      await panel.evaluate(
        (id) => window.auditPort.postMessage({ type: "agent_stop", runId: id }),
        final.run.id
      )
      await new Promise((r) => setTimeout(r, 500))
    }
    await fixture.close()
  }
} finally {
  await context.close()
  server.closeAllConnections()
  server.close()
  console.log(`AUDIT_PROFILE ${profile}`)
}
