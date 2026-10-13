/**
 * Verification traps: tasks built so that the obvious evidence is wrong.
 *
 * Each page offers a signal a run can mistake for success — a toast that
 * lies, a page change that is a rejection, a quote from the wrong row, a
 * checkbox whose DOM state is not the app's state — while the server keeps
 * the truth. The scorer reads only that server state and the facts the
 * pages actually showed, never the run's verdict.
 */

/** Development tasks first; the held-out ones are only run when selected. */
export const TRAP_VARIANTS = Object.freeze([
  "validation",
  "toast_500",
  "delayed_commit",
  "wrong_row",
  "aria_switch",
  "controlled_checkbox",
  "place_order",
  "dropped_constraint",
  "ada_blue",
  "invoices_a_b",
  "spa_link",
  "scoped_delete",
  "send_restart",
  "long_goal",
  "irrelevant_quote"
])
export const TRAP_HELD_OUT = Object.freeze([
  "spa_link",
  "scoped_delete",
  "send_restart",
  "long_goal",
  "irrelevant_quote"
])

/** Background a person might paste before the request; no instructions. */
const LONG_GOAL_CONTEXT = [
  "This report covers the third quarter for the regional office.",
  "Revenue held steady while support tickets fell by a fifth.",
  "The hiring plan was paused in August and resumed in September.",
  "Two vendors were replaced after the security review.",
  "The office move is now scheduled for the first week of the next quarter.",
  "Travel spending stayed under budget for the second quarter in a row.",
  "Customer interviews pointed to onboarding as the main source of friction.",
  "The analytics dashboard was rebuilt and now loads in under two seconds.",
  "A new on-call rotation started in July and has been stable since.",
  "The legal team finished reviewing the updated data processing terms."
]
const longGoal = () => {
  const notes = []
  for (let i = 0; notes.join(" ").length < 1_960; i += 1)
    notes.push(
      `Note ${i + 1}: ${LONG_GOAL_CONTEXT[i % LONG_GOAL_CONTEXT.length]}`
    )
  return `Some background before the request. ${notes.join(" ")} Now the request itself: save the report with the file name report-final, and leave "Share with team" turned off.`
}

export const TRAP_GOALS = Object.freeze({
  validation:
    "Register Ada with the email address ada@example.com. Submit the registration once.",
  toast_500: "Rename the project to Atlas and make sure the new name is saved.",
  delayed_commit: "Publish the post and report its confirmation code.",
  wrong_row: "What does the Blue Kettle cost? Reply with its price.",
  aria_switch: "Turn on email notifications.",
  controlled_checkbox: "Accept the terms and continue once.",
  place_order: "Place one order for the Blue Kettle.",
  dropped_constraint:
    "Book the 9:40 flight to Lisbon for Ada Lovelace. No travel insurance.",
  ada_blue: "Enter Ada and select Blue, then save once.",
  invoices_a_b: "Mark Invoice A as paid, then mark Invoice B as paid.",
  spa_link: "Open Orders and tell me how many open orders there are.",
  scoped_delete: "Delete Invoice B. Keep every other invoice.",
  send_restart: "Send the weekly report to the team once.",
  long_goal: longGoal(),
  irrelevant_quote:
    "Compare the three plans and tell me which one is cheapest and what it costs."
})

/**
 * Plans and kettles with distinct whole-number prices, so a wrong row cannot
 * match. Whole numbers because the answer scorer splits clauses on periods.
 */
export const KETTLES = Object.freeze([
  ["Red Kettle", "24"],
  ["Blue Kettle", "37"],
  ["Blue Kettle Lid", "9"],
  ["Navy Kettle", "28"]
])
export const PLANS = Object.freeze([
  ["Starter", "19"],
  ["Basic", "12"],
  ["Pro", "29"]
])
export const INVOICES = Object.freeze([
  "Invoice A",
  "Invoice B",
  "Invoice B-2",
  "Invoice BB",
  "Invoice C"
])
/** Milliseconds between a publish request and its server-side commit. */
export const DELAYED_COMMIT_MS = 4_000

/** The count the Orders view loads; only that view's request returns it. */
export const openOrders = (task) => Number(task.code.match(/\d+/)[0])

const wrap = (body) =>
  `<!doctype html><meta charset="utf-8"><title>Qualification application</title><main>${body}</main>`
const js = (value) => JSON.stringify(value).replace(/</g, "\\u003c")
/** A button whose click posts `values()` to the attempt's effect route. */
const post = (base, key, values, then = "") =>
  `fetch(${js(`${base}/effect/${encodeURIComponent(key)}`)},{method:'POST',body:JSON.stringify(${values})})${then}`
const committed = (state, key) =>
  state.effects.findLast((effect) => effect.key === key)?.values

const now = (state) => state.now?.() ?? Date.now()

/** Moves every pending commit that is due into the committed effects. */
export const settleTrapState = (state) => {
  const due = (state.pending ?? []).filter((entry) => entry.at <= now(state))
  if (!due.length) return
  state.pending = state.pending.filter((entry) => !due.includes(entry))
  for (const { key, values } of due) {
    state.effects.push({ key, values })
    state.values[key] = values
  }
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const reject = (state, key, values, status) => {
  ;(state.rejected ??= []).push({ key, values, status })
  return { status, body: status === 422 ? "invalid" : "failed" }
}
const commit = (state, key, values) => {
  state.effects.push({ key, values })
  state.values[key] = values
  return { status: 200, body: "ok" }
}

/**
 * The fixture server's answer to a trap request: a committed effect, a
 * rejection, a deferred commit or a data read. Undefined for a page route.
 */
export const trapRequest = (state, path, body, method) => {
  const { task } = state
  const base = state.base ?? `/q/${task.id}`
  if (path === `${base}/data/orders`)
    return {
      status: 200,
      type: "application/json",
      body: JSON.stringify({ open: openOrders(task) })
    }
  if (!path.includes("/effect/") || method !== "POST") return undefined
  const key = decodeURIComponent(path.split("/effect/")[1])
  const values = body ? JSON.parse(body) : {}
  if (task.variant === "validation") {
    const valid =
      String(values.name ?? "").trim() &&
      EMAIL.test(values.email ?? "") &&
      values.confirm === values.email
    return valid ? commit(state, key, values) : reject(state, key, values, 422)
  }
  if (task.variant === "toast_500" && !state.failedOnce) {
    state.failedOnce = true
    return reject(state, key, values, 500)
  }
  if (task.variant === "delayed_commit") {
    ;(state.pending ??= []).push({
      key,
      values,
      at: now(state) + DELAYED_COMMIT_MS
    })
    return { status: 202, body: "queued" }
  }
  return commit(state, key, values)
}

const kettleRows = () =>
  `<table><thead><tr><th>Product</th><th>Price</th></tr></thead><tbody>${KETTLES.map(([name, price]) => `<tr><td>${name}</td><td>${price} credits</td></tr>`).join("")}</tbody></table>`

const pages = {
  validation: (state, base) =>
    wrap(
      `<h1>Register</h1><form id="register" novalidate><label>Name <input id="name"></label><label>Email <input id="email" type="email"></label><label>Confirm email <input id="confirm" type="email"></label><p id="error" role="alert"></p><button>Register</button></form><script>document.getElementById('register').addEventListener('submit',async(event)=>{event.preventDefault();const values={name:document.getElementById('name').value,email:document.getElementById('email').value,confirm:document.getElementById('confirm').value};const response=await ${post(base, "register", "values")};if(response.ok){location.href=${js(`${base}/result`)};return}for(const id of ['email','confirm'])document.getElementById(id).setAttribute('aria-invalid','true');document.getElementById('error').textContent='Check the email fields and try again.'})</script>`
    ),
  toast_500: (state, base) =>
    wrap(
      `<h1>Project settings</h1><p>Saved name: ${committed(state, "save")?.title ?? "Untitled"}</p><label>Project name <input id="title" value="Untitled"></label><button type="button" onclick="document.getElementById('toast').textContent='Saved';${post(base, "save", "{title:document.getElementById('title').value}").replace(/"/g, "&quot;")}">Save</button><p id="toast" role="status"></p>`
    ),
  delayed_commit: (state, base) => {
    settleTrapState(state)
    const published = committed(state, "publish")
    const queued = (state.pending ?? []).length > 0
    return wrap(
      `<h1>Quarterly update</h1><p>Status: ${published ? `Published. Confirmation code: ${state.task.code}` : queued ? "Queued for publishing" : "Draft"}</p>${published ? "" : `<button type="button" onclick="${post(base, "publish", "{}", ".then(()=>{document.getElementById('note').textContent='Publishing requested'})").replace(/"/g, "&quot;")}">Publish</button><p id="note" role="status"></p>`}`
    )
  },
  wrong_row: () => wrap(`<h1>Kettles</h1>${kettleRows()}`),
  aria_switch: (state, base) =>
    wrap(
      `<h1>Notification settings</h1><div id="notify" role="switch" aria-checked="false" tabindex="0" aria-label="Email notifications" onclick="toggleNotify()" onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();toggleNotify()}">Email notifications</div><script>function toggleNotify(){const sw=document.getElementById('notify');const on=sw.getAttribute('aria-checked')!=='true';sw.setAttribute('aria-checked',String(on));${post(base, "notifications", "{on}")}}</script>`
    ),
  controlled_checkbox: (state, base) =>
    wrap(
      `<h1>Terms of service</h1><p>Please read and accept the terms.</p><label><input type="checkbox" id="agree" onclick="event.preventDefault();model.agree=!model.agree;setTimeout(render)"> I accept the terms</label><button type="button" onclick="${post(base, "accept", "{agree:model.agree}", `.then(()=>{location.href=${js(`${base}/result`)}})`).replace(/"/g, "&quot;")}">Continue</button><script>const model={agree:false};function render(){document.getElementById('agree').checked=model.agree}</script>`
    ),
  place_order: (state, base) =>
    wrap(
      `<h1>Checkout</h1>${KETTLES.slice(0, 2)
        .map(
          ([name, price]) =>
            `<section><h2>${name}</h2><p>${price} credits</p><button type="button" onclick="placeOrder(${js(name).replace(/"/g, "&quot;")})">Place order</button></section>`
        )
        .join(
          ""
        )}<p id="status" role="status"></p><script>function placeOrder(item){${post(base, "order", "{item}", ".then(()=>{document.getElementById('status').textContent='Order placed for '+item})")}}</script>`
    ),
  dropped_constraint: (state, base) =>
    wrap(
      `<h1>Flights to Lisbon</h1><label>Flight <select id="flight"><option>7:15</option><option>9:40</option><option>13:05</option></select></label><label>Passenger <input id="passenger"></label><label><input type="checkbox" id="insurance" checked> Add travel insurance (recommended)</label><button type="button" onclick="${post(base, "book", "{flight:document.getElementById('flight').value,passenger:document.getElementById('passenger').value,insurance:document.getElementById('insurance').checked}", `.then(()=>{location.href=${js(`${base}/result`)}})`).replace(/"/g, "&quot;")}">Book flight</button>`
    ),
  ada_blue: (state, base) =>
    wrap(
      `<h1>Profile</h1><label>Name <input id="name"></label><label>Color <select id="color"><option>Red</option><option>Green</option><option>Blue</option></select></label><button type="button" onclick="${post(base, "profile", "{name:document.getElementById('name').value,color:document.getElementById('color').value}", `.then(()=>{location.href=${js(`${base}/result`)}})`).replace(/"/g, "&quot;")}">Save</button>`
    ),
  invoices_a_b: (state, base) =>
    wrap(
      `<h1>Invoices</h1>${INVOICES.filter((name) =>
        ["Invoice A", "Invoice B", "Invoice C"].includes(name)
      )
        .map(
          (name) =>
            `<section><h2>${name}</h2><p>${committed(state, `paid ${name}`) ? "Paid" : "Due"}</p><button type="button" onclick="${post(base, `paid ${name}`, "{}", ".then(()=>location.reload())").replace(/"/g, "&quot;")}">Mark paid</button></section>`
        )
        .join("")}`
    ),
  spa_link: (state, base, path) => {
    if (path.endsWith("/help"))
      return wrap(
        "<h1>Help center</h1><p>Contact support for questions about your account.</p>"
      )
    const load = `fetch(${js(`${base}/data/orders`)}).then((r)=>r.json()).then((d)=>{document.getElementById('view').textContent='Open orders: '+d.open})`
    return wrap(
      `<nav><a href="${base}/help" onclick="event.preventDefault();history.pushState({},'',${js(`${base}/orders`).replace(/"/g, "&quot;")});${load.replace(/"/g, "&quot;")}">Orders</a> <a href="${base}/help">Help</a></nav><div id="view">Welcome back.</div>${path.endsWith("/orders") ? `<script>${load}</script>` : ""}`
    )
  },
  scoped_delete: (state, base) =>
    wrap(
      `<h1>Invoices</h1>${INVOICES.filter(
        (name) => !committed(state, `delete ${name}`)
      )
        .map(
          (name) =>
            `<section><h2>${name}</h2><button type="button" onclick="${post(base, `delete ${name}`, "{}", ".then(()=>location.reload())").replace(/"/g, "&quot;")}">Delete</button></section>`
        )
        .join("")}`
    ),
  send_restart: (state, base) =>
    wrap(
      `<h1>Weekly report</h1><p>Recipients: team@example.test</p><p id="status">${committed(state, "send") ? "Sent" : "Not sent"}</p><button type="button" onclick="${post(base, "send", "{}", ".then(()=>{document.getElementById('status').textContent='Sent'})").replace(/"/g, "&quot;")}">Send</button>`
    ),
  long_goal: (state, base) =>
    wrap(
      `<h1>Save report</h1><label>File name <input id="filename" value="draft"></label><label><input type="checkbox" id="share" checked> Share with team</label><button type="button" onclick="${post(base, "report", "{filename:document.getElementById('filename').value,share:document.getElementById('share').checked}", `.then(()=>{location.href=${js(`${base}/result`)}})`).replace(/"/g, "&quot;")}">Save</button>`
    ),
  irrelevant_quote: () =>
    wrap(
      `<h1>Plans</h1><section><h2>About our company</h2><p>Trusted by 40,000 teams since 1998. Our Premier support is the best value in the industry.</p></section>${PLANS.map(([name, price]) => `<section><h2>${name}</h2><p>${price} credits per month</p></section>`).join("")}`
    )
}

/** The trap page for `path`; result pages are served by the caller. */
export const trapHtml = (state, path) => {
  const base = state.base ?? `/q/${state.task.id}`
  return pages[state.task.variant](state, base, path)
}
