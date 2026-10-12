import { runAgentScenario } from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

const board = `<!doctype html><style>html,body{margin:0}canvas{display:block;background:rgb(0,200,0);width:300px;height:180px}</style><canvas id="board" width="300" height="180"></canvas><p role="status">Status: waiting</p><script>board.onclick=e=>{document.querySelector('p').textContent='Status: '+(e.isTrusted?'trusted ':'synthetic ')+(e.clientX<150?'left':'right');fetch('/effect')}</script>`
const framePage = (nested: boolean) =>
  `<!doctype html><style>body{margin:0}iframe{border:4px solid blue;position:absolute;left:100px;top:80px;width:400px;height:300px;transform:scale(1.2,.9);transform-origin:top left}</style><h1>Board</h1><iframe src="${nested ? "/outer" : "/board"}"></iframe>`

for (const nested of [false, true])
  runAgentScenario({
    name: `native visual click in ${nested ? "nested scaled srcdoc" : "same-origin"} frame`,
    goal: "Click the left half of the board and report the status.",
    plan: [{ text: "report the status", kind: "read" }],
    status: "completed",
    vision: true,
    allowRoutineActions: true,
    approvalScope: "run_origin",
    html: (path) =>
      path === "/board"
        ? board
        : path === "/outer"
          ? `<!doctype html><style>body{margin:0}iframe{margin:20px;border:2px solid red;width:300px;height:240px;transform:scale(.8);transform-origin:top left}</style><iframe srcdoc="${board.replaceAll('"', "&quot;")}"></iframe>`
          : framePage(nested),
    decide(observation, context) {
      if (observation.text.includes("Status: trusted left"))
        return {
          type: "complete",
          summary: "Status: trusted left",
          evidence: "Status: trusted left"
        }
      expect(context.images).toBe(1)
      expect(context.screenshot?.frames?.length).toBe(nested ? 2 : 1)
      const frame = context.screenshot?.frames?.at(-1)
      if (!frame) return { type: "fail", reason: "No frame picture." }
      return {
        type: "click_point",
        x: frame.region.x + frame.region.width * 0.2,
        y: frame.region.y + frame.region.height * 0.2
      }
    },
    async verify({ page, snapshot, effects }) {
      const target = nested
        ? page.frameLocator("iframe").frameLocator("iframe")
        : page.frameLocator("iframe")
      await expect(target.getByRole("status")).toHaveText(
        "Status: trusted left"
      )
      await expect.poll(effects).toBe(1)
      expect(
        snapshot?.steps
          .filter((step) => step.status === "verified")
          .map((step) => step.command?.type)
      ).toEqual(["click_point"])
    }
  })

runAgentScenario({
  name: "native visual click in an authorized OOPIF",
  goal: "Visit the embedded origin, return to the board, click its left half and report the status.",
  plan: [{ text: "report the status", kind: "read" }],
  status: "completed",
  vision: true,
  allowRoutineActions: true,
  approvalScope: "run_origin",
  html: (path) =>
    path === "/board"
      ? board
      : path === "/authorized-site"
        ? "<!doctype html><h1>Authorized origin</h1>"
        : `<!doctype html><style>iframe{position:absolute;left:100px;top:80px;width:400px;height:300px;border:4px solid blue;transform:scale(1.2,.9);transform-origin:top left}</style><h1>Board</h1><iframe id="embedded"></iframe><script>embedded.src='http://localhost:'+location.port+'/board'</script>`,
  decide(observation, context) {
    const url = new URL(observation.url)
    if (url.pathname === "/")
      return {
        type: "navigate",
        url: `http://localhost:${url.port}/authorized-site`
      }
    if (url.pathname === "/authorized-site")
      return { type: "navigate", url: `http://127.0.0.1:${url.port}/return` }
    if (observation.text.includes("Status: trusted left"))
      return {
        type: "complete",
        summary: "Status: trusted left",
        evidence: "Status: trusted left"
      }
    expect(context.screenshot?.frames).toHaveLength(1)
    const frame = context.screenshot?.frames?.[0]
    if (!frame) return { type: "fail", reason: "No authorized OOPIF picture." }
    return {
      type: "click_point",
      x: frame.region.x + frame.region.width * 0.2,
      y: frame.region.y + frame.region.height * 0.2
    }
  },
  async verify({ page, effects, snapshot }) {
    const controlled = page
      .context()
      .pages()
      .find((candidate) => candidate.url().endsWith("/return"))
    expect(controlled).toBeDefined()
    if (!controlled) throw new Error("The run's return tab is missing")
    await expect(
      controlled.frameLocator("iframe").getByRole("status")
    ).toHaveText("Status: trusted left")
    await expect.poll(effects).toBe(1)
    expect(snapshot?.run?.allowedOrigins).toHaveLength(2)
  }
})

runAgentScenario({
  name: "masks sensitive and opaque frame pixels before provider disclosure",
  goal: "Report the status shown on the page.",
  plan: [{ text: "report the status", kind: "read" }],
  status: "completed",
  vision: true,
  html: (path) =>
    path === "/allowed"
      ? '<!doctype html><style>body{margin:0;background:rgb(0,200,0)}input{position:absolute;left:20px;top:100px;width:100px;height:30px}</style><input type="password" value="secret">'
      : path === "/rotated"
        ? "<!doctype html><body style='background:rgb(200,0,0)'>Unsupported rotation</body>"
        : '<!doctype html><style>body{margin:0}iframe{position:absolute;top:100px;width:300px;height:240px;border:0}#allowed{left:50px}#opaque{left:500px}#rotated{left:900px;transform:rotate(15deg)}</style><p>Status: ready</p><iframe id="allowed" src="/allowed"></iframe><iframe id="opaque" sandbox="allow-scripts" srcdoc="<body style=\'background:rgb(200,0,0)\'>Private</body>"></iframe><iframe id="rotated" src="/rotated"></iframe>',
  decide(observation, context) {
    expect(observation.text).not.toContain("Private")
    expect(context.screenshot?.frames).toHaveLength(1)
    expect(context.screenshot?.frameLimitations).toEqual([
      expect.objectContaining({ reason: "unmapped_or_unsupported_geometry" })
    ])
    return {
      type: "complete",
      summary: "Status: ready",
      evidence: "Status: ready"
    }
  },
  async verify({ page, wire }) {
    const request = wire[0]?.request as { messages: { images?: string[] }[] }
    const data = request.messages.at(-1)?.images?.[0]
    expect(data).toBeDefined()
    const pixels = await page.evaluate(async (data) => {
      const image = new Image()
      image.src = `data:image/jpeg;base64,${data}`
      await image.decode()
      const canvas = document.createElement("canvas")
      canvas.width = image.width
      canvas.height = image.height
      const ctx = canvas.getContext("2d")
      if (!ctx) throw new Error("No image context")
      ctx.drawImage(image, 0, 0)
      return [
        [80, 140],
        [100, 220],
        [600, 200],
        [1100, 200]
      ].map(([x, y]) =>
        Array.from(
          ctx.getImageData(
            Math.round((x * image.width) / innerWidth),
            Math.round((y * image.width) / innerWidth),
            1,
            1
          ).data
        ).slice(0, 3)
      )
    }, data)
    expect(pixels[0][1]).toBeGreaterThan(150)
    for (const pixel of pixels.slice(1))
      expect(Math.max(...pixel)).toBeLessThan(30)
  }
})

runAgentScenario({
  name: "masks frame filter pixels beyond the owner's bounds",
  goal: "Report the status shown on the page.",
  plan: [{ text: "report the status", kind: "read" }],
  status: "completed",
  vision: true,
  html: (path) =>
    path === "/filtered"
      ? "<!doctype html><body style='background:rgb(200,0,0)'>Filtered frame</body>"
      : '<!doctype html><p>Status: ready</p><iframe src="/filtered" style="position:absolute;left:100px;top:100px;width:300px;height:240px;filter:blur(20px)"></iframe>',
  decide(_observation, context) {
    expect(context.screenshot?.frames ?? []).toHaveLength(0)
    expect(context.screenshot?.frameLimitations).toEqual([
      expect.objectContaining({ reason: "unmapped_or_unsupported_geometry" })
    ])
    return {
      type: "complete",
      summary: "Status: ready",
      evidence: "Status: ready"
    }
  },
  async verify({ page, wire }) {
    const request = wire[0]?.request as { messages: { images?: string[] }[] }
    const data = request.messages.at(-1)?.images?.[0]
    expect(data).toBeDefined()
    const pixel = await page.evaluate(async (data) => {
      const image = new Image()
      image.src = `data:image/jpeg;base64,${data}`
      await image.decode()
      const canvas = document.createElement("canvas")
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext("2d")
      if (!context) throw new Error("No image context")
      context.drawImage(image, 0, 0)
      return Array.from(context.getImageData(90, 160, 1, 1).data).slice(0, 3)
    }, data)
    expect(Math.max(...pixel)).toBeLessThan(30)
  }
})

runAgentScenario({
  name: "invalidates frame coordinates after child scrolling, then recovers on a fresh picture",
  goal: "Click the left half of the board and report the status.",
  plan: [{ text: "report the status", kind: "read" }],
  status: "completed",
  vision: true,
  allowRoutineActions: true,
  html: (path) =>
    path === "/board"
      ? board.replace("</style>", "body{height:1500px}</style>")
      : framePage(false),
  async decide(observation, context) {
    if (observation.text.includes("Status: trusted left"))
      return {
        type: "complete",
        summary: "Status: trusted left",
        evidence: "Status: trusted left"
      }
    const frame = context.screenshot?.frames?.[0]
    expect(frame).toBeDefined()
    /** The child scrolls after the picture, so these coordinates go stale. */
    if (context.step === 1)
      await context.page
        .frameLocator("iframe")
        .locator("body")
        .evaluate(() => scrollTo(0, 20))
    if (!frame) return { type: "fail", reason: "Missing frame picture" }
    return {
      type: "click_point",
      x: frame.region.x + frame.region.width * 0.2,
      y: frame.region.y + frame.region.height * 0.2
    }
  },
  async verify({ page, snapshot, effects }) {
    await expect(page.frameLocator("iframe").getByRole("status")).toHaveText(
      "Status: trusted left"
    )
    /** The stale click never landed; the one on fresh coordinates did, once. */
    await expect.poll(effects).toBe(1)
    expect(
      snapshot?.steps
        .filter((step) => step.status === "verified")
        .map((step) => step.command?.type)
    ).toEqual(["click_point"])
    expect(snapshot?.run?.recovery?.attempts).toBe(1)
  }
})

runAgentScenario({
  name: "does not guess between visually identical sibling frame documents",
  goal: "Report the status shown on the page.",
  plan: [{ text: "report the status", kind: "read" }],
  status: "completed",
  vision: true,
  html: (path) =>
    path === "/board"
      ? board
      : '<!doctype html><p>Status: ready</p><iframe src="/board" width="300" height="240"></iframe><iframe src="/board" width="300" height="240"></iframe>',
  decide(_observation, context) {
    expect(context.screenshot?.frames ?? []).toHaveLength(0)
    expect(context.screenshot?.frameLimitations).toHaveLength(2)
    return {
      type: "complete",
      summary: "Status: ready",
      evidence: "Status: ready"
    }
  },
  async verify({ page, effects }) {
    await expect.poll(effects).toBe(0)
    await expect(
      page.frameLocator("iframe").first().getByRole("status")
    ).toHaveText("Status: waiting")
    await expect(
      page.frameLocator("iframe").last().getByRole("status")
    ).toHaveText("Status: waiting")
  }
})
