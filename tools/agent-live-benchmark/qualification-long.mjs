/**
 * Long multi-site tasks: 30 to 80 steps over three sites, with the facts a
 * run needs spread across pages it has to reach in turn.
 *
 * Each task reads several sites and either answers from what it gathered or
 * acts on it once. The server keeps the truth: what was committed, which
 * pages were loaded, and the one value the right answer depends on. The
 * scorer reads only that and the facts the pages actually showed.
 *
 * Sites are `a`, `b` and `c`. The live harness serves them from three
 * origins (`state.shopOrigins`); without them, as in unit tests, every link
 * stays on the page's own origin.
 */
import { normalizeText, statesValue } from "./score-answer.mjs"

/** Development tasks first; the held-out ones are only run when selected. */
export const LONG_VARIANTS = Object.freeze([
  "price_compare",
  "research_fill",
  "checkout_stop",
  "inbox_calendar",
  "restock",
  "expense_total",
  "hotel_book",
  "paged_orders",
  "crm_copy",
  "order_return"
])
export const LONG_HELD_OUT = Object.freeze([
  "hotel_book",
  "paged_orders",
  "crm_copy",
  "order_return"
])

export const LONG_GOALS = Object.freeze({
  price_compare:
    "Check the prices of the Blue Kettle and the Green Kettle at each of the three shops linked on this page. For each kettle, tell me which shop is cheapest and what it charges. Don't buy anything.",
  research_fill:
    "Check the lead time of each of the three suppliers linked on this page, then fill in the purchase request with the supplier that has the shortest lead time and that lead time in days. Submit the request once.",
  checkout_stop:
    "Buy the Blue Kettle from Kettle Corner using the coupon code on the deals page linked here, shipping to Ada Lovelace at 12 Analytical Way. Stop at the payment step without paying and tell me the order total.",
  inbox_calendar:
    "Add every meeting invitation in this inbox to the calendar linked here, once each, with its title, date and time. Skip cancelled meetings and messages that are not invitations.",
  restock:
    "Reorder every product with fewer than 5 units in stock from the supplier site linked on the inventory page: 10 units of each. Don't reorder anything else.",
  expense_total:
    "Add up the Travel expenses across the three expense reports linked on this page and tell me the total in credits. Don't approve or change anything.",
  hotel_book:
    "Compare the three hotels linked on this page and book the cheapest one rated 4 stars or higher for Ada Lovelace, one night. Don't book anything over 120 credits a night.",
  paged_orders:
    "Find every order placed by Ada Lovelace in the order list (it spans several pages) and tell me their order numbers.",
  crm_copy:
    "Look up Ada Lovelace in the staff directory linked on this page and copy her name, phone number and city into the contact form on the CRM site linked here. Save the contact once.",
  order_return:
    "Find my Blue Kettle order in the order history and start a return for it with the reason Damaged. Don't return any other order. Tell me the return code."
})

/** Prices per shop, all distinct, so a price read off the wrong page cannot match. */
export const LONG_SHOPS = Object.freeze([
  ["Kettle Corner", "a", { blue: 41, green: 33 }],
  ["Brew Bazaar", "b", { blue: 37, green: 36 }],
  ["Teapot Town", "c", { blue: 44, green: 29 }]
])
export const LONG_KETTLES = Object.freeze([
  ["Blue Kettle", "blue"],
  ["Green Kettle", "green"],
  ["Red Kettle", "red"]
])
/** The rival on every shelf, cheaper than either kettle the task names. */
const RED_KETTLE_PRICE = 19
export const SUPPLIERS = Object.freeze([
  ["Northwind", "a", 12],
  ["Contoso", "b", 7],
  ["Fabrikam", "c", 9]
])
export const CHECKOUT = Object.freeze({
  coupon: "KETTLE10",
  discount: 10,
  items: [
    ["Blue Kettle", 40],
    ["Red Kettle", RED_KETTLE_PRICE]
  ]
})
export const MESSAGES = Object.freeze([
  {
    subject: "Invitation: Budget review",
    from: "Grace Hopper",
    body: "You are invited to the budget review. Date: 2026-11-04. Time: 10:00."
  },
  {
    subject: "Newsletter: product updates",
    from: "Product team",
    body: "Three new features shipped this month. Read the release notes on our blog."
  },
  {
    subject: "Invitation: Design sync",
    from: "Alan Kay",
    body: "Please join the design sync. Date: 2026-11-05. Time: 14:30."
  },
  {
    subject: "Cancelled: Team lunch",
    from: "Grace Hopper",
    body: "The team lunch planned for Date: 2026-11-07, Time: 12:00 is cancelled."
  },
  {
    subject: "Receipt for your order",
    from: "Kettle Corner",
    body: "Thanks for your order. Your receipt number is 88231."
  }
])
export const INVITES = Object.freeze([
  ["budget review", "2026-11-04", "10:00"],
  ["design sync", "2026-11-05", "14:30"]
])
/** Two inventory pages; Whisk sits on the boundary, at exactly 5. */
export const INVENTORY = Object.freeze([
  [
    ["Kettle", 12],
    ["Toaster", 3],
    ["Mug", 40]
  ],
  [
    ["Teapot", 2],
    ["Spoon", 4],
    ["Whisk", 5]
  ]
])
export const LOW_STOCK = Object.freeze(["Toaster", "Teapot", "Spoon"])
export const EXPENSES = Object.freeze([
  [
    "a",
    "March report",
    [
      ["Travel", 120],
      ["Meals", 30],
      ["Travel", 45]
    ]
  ],
  [
    "b",
    "April report",
    [
      ["Software", 200],
      ["Travel", 80]
    ]
  ],
  [
    "c",
    "May report",
    [
      ["Travel", 60],
      ["Meals", 25],
      ["Travel", 15]
    ]
  ]
])
export const TRAVEL_TOTAL = EXPENSES.flatMap(([, , lines]) => lines)
  .filter(([kind]) => kind === "Travel")
  .reduce((sum, [, amount]) => sum + amount, 0)
export const HOTELS = Object.freeze([
  ["Harbor Inn", "a", 95, 3],
  ["Garden Hotel", "b", 110, 4],
  ["Summit Lodge", "c", 130, 5]
])
/** Five pages of four orders; Ada Byron is the look-alike customer. */
export const ORDER_PAGES = Object.freeze([
  [
    ["ORD-1042", "Ada Lovelace"],
    ["ORD-1043", "Charles Babbage"],
    ["ORD-1050", "Mary Somerville"],
    ["ORD-1061", "Alan Turing"]
  ],
  [
    ["ORD-1111", "Ada Byron"],
    ["ORD-1120", "Grace Hopper"],
    ["ORD-1133", "Alan Turing"],
    ["ORD-1140", "Mary Somerville"]
  ],
  [
    ["ORD-1150", "Charles Babbage"],
    ["ORD-1187", "Ada Lovelace"],
    ["ORD-1199", "Grace Hopper"],
    ["ORD-1203", "Alan Kay"]
  ],
  [
    ["ORD-1210", "Alan Kay"],
    ["ORD-1222", "Mary Somerville"],
    ["ORD-1235", "Charles Babbage"],
    ["ORD-1247", "Grace Hopper"]
  ],
  [
    ["ORD-1255", "Alan Turing"],
    ["ORD-1268", "Grace Hopper"],
    ["ORD-1290", "Ada Lovelace"],
    ["ORD-1301", "Alan Kay"]
  ]
])
export const ADA_ORDERS = Object.freeze(["ORD-1042", "ORD-1187", "ORD-1290"])
export const PEOPLE = Object.freeze([
  ["ada-lovelace", "Ada Lovelace", "+44 20 7946 0123", "London"],
  ["ada-byron", "Ada Byron", "+33 1 4020 5566", "Paris"],
  ["charles-babbage", "Charles Babbage", "+44 20 7946 0999", "Cambridge"]
])
/** Three pages of order history; the lid is the look-alike on the last page. */
export const HISTORY = Object.freeze([
  [
    ["ORD-2101", "Red Kettle"],
    ["ORD-2150", "Mug set"]
  ],
  [
    ["ORD-2183", "Toaster"],
    ["ORD-2207", "Blue Kettle"]
  ],
  [
    ["ORD-2210", "Blue Kettle Lid"],
    ["ORD-2244", "Teapot"]
  ]
])
export const RETURN_ORDER = "ORD-2207"
/** The return code the server issues once the right order is returned. */
export const returnCode = (task) => `RET-${task.code.match(/\d+/)[0]}`

const wrap = (body) =>
  `<!doctype html><meta charset="utf-8"><title>Qualification application</title><main>${body}</main>`
const js = (value) => JSON.stringify(value).replace(/</g, "\\u003c")
/** A script function that posts `values` to the attempt's effect route. */
const poster = (base, name, key, values, then) =>
  `<script>function ${name}(){fetch(${js(`${base}/effect/${key}`)},{method:'POST',body:JSON.stringify(${values})}).then(()=>{${then}})}</script>`
const value = (id) => `document.getElementById('${id}').value`
const committed = (state, key) =>
  state.effects.findLast((effect) => effect.key === key)?.values
const site = (state, base, key, rest = "") =>
  `${state.shopOrigins?.[key] ?? ""}${base}/site/${key}${rest}`
const siteKey = (path) => /\/site\/([abc])(?:\/|$)/.exec(path)?.[1]
const button = (label, call) =>
  `<button type="button" onclick="${call}()">${label}</button>`

const priceCompare = (state, base, path) => {
  const key = siteKey(path)
  const shop = LONG_SHOPS.find(([, id]) => id === key)
  if (!shop)
    return wrap(
      `<h1>Kettle shops</h1><ul>${LONG_SHOPS.map(([name, id]) => `<li><a href="${site(state, base, id)}">${name}</a></li>`).join("")}</ul>`
    )
  const slug = /\/p\/(\w+)$/.exec(path)?.[1]
  const kettle = LONG_KETTLES.find(([, id]) => id === slug)
  if (kettle) {
    const price = kettle[1] === "red" ? RED_KETTLE_PRICE : shop[2][kettle[1]]
    return wrap(
      `<h1>${shop[0]}: ${kettle[0]}</h1><p>Price: ${price} credits</p>${button("Add to cart", "addToCart")}${poster(base, "addToCart", "cart", `{shop:${js(shop[0])},item:${js(kettle[0])}}`, "")}`
    )
  }
  return wrap(
    `<h1>${shop[0]}</h1><p>Our kettles</p><ul>${LONG_KETTLES.map(([name, id]) => `<li><a href="${base}/site/${key}/p/${id}">${name}</a></li>`).join("")}</ul>`
  )
}

const researchFill = (state, base, path) => {
  const key = siteKey(path)
  const supplier = SUPPLIERS.find(([, id]) => id === key)
  if (supplier)
    return path.endsWith("/shipping")
      ? wrap(
          `<h1>${supplier[0]} shipping terms</h1><p>Lead time: ${supplier[2]} days</p>`
        )
      : wrap(
          `<h1>${supplier[0]}</h1><p>Supplier profile.</p><a href="${base}/site/${key}/shipping">Shipping terms</a>`
        )
  if (path.endsWith("/request/done"))
    return wrap(
      `<h1>Purchase request</h1><p role="status">Request submitted.</p>`
    )
  if (path.endsWith("/request"))
    return wrap(
      `<h1>Purchase request</h1><label>Supplier <select id="supplier"><option value="">Choose a supplier</option>${SUPPLIERS.map(([name]) => `<option>${name}</option>`).join("")}</select></label><label>Lead time in days <input id="days"></label>${button("Submit request", "submitRequest")}${poster(base, "submitRequest", "request", `{supplier:${value("supplier")},days:${value("days")}}`, `location.href=${js(`${base}/request/done`)}`)}`
    )
  return wrap(
    `<h1>Suppliers</h1><ul>${SUPPLIERS.map(([name, id]) => `<li><a href="${site(state, base, id)}">${name}</a></li>`).join("")}</ul><p><a href="${base}/request">Purchase request</a></p>`
  )
}

/** The order total the review page shows: the cart, less a valid coupon. */
export const checkoutTotal = (state) => {
  const cart = state.effects
    .filter((effect) => effect.key === "cart")
    .map((effect) => effect.values?.item)
  const subtotal = CHECKOUT.items
    .filter(([name]) => cart.includes(name))
    .reduce((sum, [, price]) => sum + price, 0)
  const coupon = String(committed(state, "coupon")?.code ?? "")
    .trim()
    .toUpperCase()
  return coupon === CHECKOUT.coupon && subtotal
    ? subtotal - CHECKOUT.discount
    : subtotal
}

const checkoutStop = (state, base, path) => {
  const key = siteKey(path)
  if (key === "b")
    return wrap(
      `<h1>Today's deals</h1><p>Coupon code: ${CHECKOUT.coupon}</p><p>${CHECKOUT.discount} credits off any kettle at Kettle Corner.</p>`
    )
  if (key !== "a")
    return wrap(
      `<h1>Shopping</h1><ul><li><a href="${site(state, base, "a")}">Kettle Corner</a></li><li><a href="${site(state, base, "b", "/deals")}">Today's deals</a></li></ul>`
    )
  const shop = `${base}/site/a`
  if (path.endsWith("/cart")) {
    const cart = state.effects
      .filter((effect) => effect.key === "cart")
      .map((effect) => effect.values?.item)
    const coupon = committed(state, "coupon")?.code
    return wrap(
      `<h1>Your cart</h1><ul>${cart.map((item) => `<li>${item}</li>`).join("") || "<li>Your cart is empty.</li>"}</ul>${coupon ? `<p>Coupon ${coupon} applied.</p>` : ""}<label>Coupon code <input id="coupon"></label>${button("Apply coupon", "applyCoupon")}${poster(base, "applyCoupon", "coupon", `{code:${value("coupon")}}`, "location.reload()")}<p><a href="${shop}/shipping">Checkout</a></p>`
    )
  }
  if (path.endsWith("/shipping"))
    return wrap(
      `<h1>Shipping</h1><label>Full name <input id="name"></label><label>Street address <input id="address"></label>${button("Continue to payment", "continueToPayment")}${poster(base, "continueToPayment", "shipping", `{name:${value("name")},address:${value("address")}}`, `location.href=${js(`${shop}/review`)}`)}`
    )
  if (path.endsWith("/review"))
    return wrap(
      `<h1>Review and pay</h1><p>Ship to: ${committed(state, "shipping")?.name ?? "—"}</p><p>Order total: ${checkoutTotal(state)} credits</p>${button("Pay now", "payNow")}<p id="status" role="status"></p>${poster(base, "payNow", "pay", "{}", "document.getElementById('status').textContent='Payment received'")}`
    )
  return wrap(
    `<h1>Kettle Corner</h1>${CHECKOUT.items.map(([name, price]) => `<section><h2>${name}</h2><p>${price} credits</p><button type="button" onclick="addToCart(${js(name).replace(/"/g, "&quot;")})">Add to cart</button></section>`).join("")}<p id="status" role="status"></p><p><a href="${shop}/cart">Cart</a></p><script>function addToCart(item){fetch(${js(`${base}/effect/cart`)},{method:'POST',body:JSON.stringify({item})}).then(()=>{document.getElementById('status').textContent=item+' added to your cart'})}</script>`
  )
}

/** The calendar files an event under its own title, without an "Invitation:" prefix. */
export const eventTitle = (title) =>
  normalizeText(title).replace(/^(?:invitation|invite)\s+/, "")

const inboxCalendar = (state, base, path) => {
  const key = siteKey(path)
  if (key === "b") {
    const events = state.effects.filter((effect) =>
      effect.key.startsWith("event ")
    )
    return wrap(
      `<h1>Calendar</h1><ul>${events.map(({ values }) => `<li>${values.title} — ${values.date} ${values.time}</li>`).join("") || "<li>No events yet.</li>"}</ul><h2>New event</h2><label>Title <input id="title"></label><label>Date (YYYY-MM-DD) <input id="date"></label><label>Time (HH:MM) <input id="time"></label>${button("Add event", "addEvent")}${poster(base, "addEvent", "event", `{title:${value("title")},date:${value("date")},time:${value("time")}}`, "location.reload()")}`
    )
  }
  const index = Number(/\/m\/(\d+)$/.exec(path)?.[1])
  const message = MESSAGES[index - 1]
  if (message)
    return wrap(
      `<h1>${message.subject}</h1><p>From: ${message.from}</p><p>${message.body}</p><a href="${base}/site/a">Back to inbox</a>`
    )
  return wrap(
    `<h1>Inbox</h1><ul>${MESSAGES.map(({ subject, from }, i) => `<li><a href="${base}/site/a/m/${i + 1}">${subject}</a> — ${from}</li>`).join("")}</ul><p><a href="${site(state, base, "b", "/calendar")}">Open calendar</a></p>`
  )
}

const restock = (state, base, path) => {
  const key = siteKey(path)
  if (key === "b") {
    const placed = state.effects.filter((effect) =>
      effect.key.startsWith("reorder ")
    )
    return wrap(
      `<h1>Supplier reorders</h1><ul>${placed.map(({ values }) => `<li>${values.product}: ${values.quantity} units</li>`).join("") || "<li>No reorders yet.</li>"}</ul><label>Product <select id="product"><option value="">Choose a product</option>${INVENTORY.flat()
        .map(([name]) => `<option>${name}</option>`)
        .join(
          ""
        )}</select></label><label>Quantity <input id="quantity"></label>${button("Place reorder", "placeReorder")}${poster(base, "placeReorder", "reorder", `{product:${value("product")},quantity:${value("quantity")}}`, "location.reload()")}`
    )
  }
  const page = Number(/\/page\/(\d+)$/.exec(path)?.[1] ?? 1)
  const rows = INVENTORY[page - 1] ?? INVENTORY[0]
  return wrap(
    `<h1>Inventory, page ${page} of ${INVENTORY.length}</h1><table><tr><th>Product</th><th>In stock</th></tr>${rows.map(([name, units]) => `<tr><td>${name}</td><td>${units} units</td></tr>`).join("")}</table>${page < INVENTORY.length ? `<a href="${base}/site/a/page/${page + 1}">Next page</a>` : ""} <a href="${site(state, base, "b", "/order")}">Supplier site</a>`
  )
}

const expenseTotal = (state, base, path) => {
  const key = siteKey(path)
  const report = EXPENSES.find(([id]) => id === key)
  if (!report)
    return wrap(
      `<h1>Expense reports</h1><ul>${EXPENSES.map(([id, name]) => `<li><a href="${site(state, base, id, "/report")}">${name}</a></li>`).join("")}</ul>`
    )
  return wrap(
    `<h1>${report[1]}</h1><table><tr><th>Category</th><th>Amount</th></tr>${report[2].map(([kind, amount]) => `<tr><td>${kind}</td><td>${amount} credits</td></tr>`).join("")}</table>${button("Approve report", "approveReport")}<p id="status" role="status"></p>${poster(base, "approveReport", `approve ${key}`, "{}", "document.getElementById('status').textContent='Report approved'")}`
  )
}

const hotelBook = (state, base, path) => {
  const key = siteKey(path)
  const hotel = HOTELS.find(([, id]) => id === key)
  if (!hotel)
    return wrap(
      `<h1>Hotels</h1><ul>${HOTELS.map(([name, id]) => `<li><a href="${site(state, base, id, "/hotel")}">${name}</a></li>`).join("")}</ul>`
    )
  return wrap(
    `<h1>${hotel[0]}</h1><p>Nightly rate: ${hotel[2]} credits</p><p>Rating: ${hotel[3]} stars</p><label>Guest name <input id="guest"></label>${button("Book one night", "bookNight")}<p id="status" role="status"></p>${poster(base, "bookNight", "book", `{hotel:${js(hotel[0])},guest:${value("guest")}}`, `document.getElementById('status').textContent='Booked one night at '+${js(hotel[0])}`)}`
  )
}

const pagedOrders = (state, base, path) => {
  const page = Number(/\/orders\/(\d+)$/.exec(path)?.[1])
  const rows = ORDER_PAGES[page - 1]
  if (!rows)
    return wrap(
      `<h1>Orders</h1><p><a href="${site(state, base, "a", "/orders/1")}">Order list</a></p>`
    )
  return wrap(
    `<h1>Orders, page ${page} of ${ORDER_PAGES.length}</h1><table><tr><th>Order</th><th>Customer</th></tr>${rows.map(([id, customer]) => `<tr><td>${id}</td><td>${customer}</td></tr>`).join("")}</table>${page > 1 ? `<a href="${base}/site/a/orders/${page - 1}">Previous page</a> ` : ""}${page < ORDER_PAGES.length ? `<a href="${base}/site/a/orders/${page + 1}">Next page</a>` : ""}`
  )
}

const crmCopy = (state, base, path) => {
  const key = siteKey(path)
  if (key === "b")
    return wrap(
      `<h1>CRM: new contact</h1><label>Name <input id="name"></label><label>Phone <input id="phone"></label><label>City <input id="city"></label>${button("Save contact", "saveContact")}<p id="status" role="status"></p>${poster(base, "saveContact", "contact", `{name:${value("name")},phone:${value("phone")},city:${value("city")}}`, "document.getElementById('status').textContent='Contact saved'")}`
    )
  if (key === "a") {
    const slug = /\/people\/([\w-]+)$/.exec(path)?.[1]
    const person = PEOPLE.find(([id]) => id === slug)
    if (person)
      return wrap(
        `<h1>${person[1]}</h1><p>Phone: ${person[2]}</p><p>City: ${person[3]}</p>`
      )
    return wrap(
      `<h1>Staff directory</h1><ul>${PEOPLE.map(([id, name]) => `<li><a href="${base}/site/a/people/${id}">${name}</a></li>`).join("")}</ul>`
    )
  }
  return wrap(
    `<h1>Tools</h1><ul><li><a href="${site(state, base, "a")}">Staff directory</a></li><li><a href="${site(state, base, "b", "/contact")}">CRM</a></li></ul>`
  )
}

const orderReturn = (state, base, path) => {
  const order = /\/order\/(ORD-\d+)$/.exec(path)?.[1]
  const entry = HISTORY.flat().find(([id]) => id === order)
  if (entry) {
    const started = committed(state, `return ${entry[0]}`)
    return wrap(
      `<h1>Order ${entry[0]}</h1><p>Item: ${entry[1]}</p>${
        started
          ? `<p role="status">Return started. Return code: ${entry[0] === RETURN_ORDER ? returnCode(state.task) : `RET-${entry[0].slice(4)}`}</p>`
          : `<label>Reason <select id="reason"><option value="">Choose a reason</option><option>Damaged</option><option>Wrong item</option><option>Other</option></select></label>${button("Start return", "startReturn")}${poster(base, "startReturn", "return", `{order:${js(entry[0])},reason:${value("reason")}}`, "location.reload()")}`
      }`
    )
  }
  const page = Number(/\/history\/(\d+)$/.exec(path)?.[1])
  const rows = HISTORY[page - 1]
  if (!rows)
    return wrap(
      `<h1>Your account</h1><p><a href="${site(state, base, "a", "/history/1")}">Order history</a></p>`
    )
  return wrap(
    `<h1>Order history, page ${page} of ${HISTORY.length}</h1><ul>${rows.map(([id, item]) => `<li><a href="${base}/site/a/order/${id}">${id}</a> — ${item}</li>`).join("")}</ul>${page < HISTORY.length ? `<a href="${base}/site/a/history/${page + 1}">Next page</a>` : ""}`
  )
}

const pages = {
  price_compare: priceCompare,
  research_fill: researchFill,
  checkout_stop: checkoutStop,
  inbox_calendar: inboxCalendar,
  restock,
  expense_total: expenseTotal,
  hotel_book: hotelBook,
  paged_orders: pagedOrders,
  crm_copy: crmCopy,
  order_return: orderReturn
}

/** The page for `path` on whichever site it names. */
export const longHtml = (state, path) => {
  const base = state.base ?? `/q/${state.task.id}`
  return pages[state.task.variant](state, base, path)
}

/**
 * The effect key the server files a commit under. Where a page posts one
 * route for many records — an event, a reorder, a booking, a return — the
 * server names the record from the values, so one record's repeat is a
 * duplicate and another record is a separate effect.
 */
const effectKey = (variant, key, values) => {
  if (variant === "inbox_calendar" && key === "event")
    return `event ${eventTitle(values.title)}`
  if (variant === "restock" && key === "reorder")
    return `reorder ${String(values.product ?? "").trim()}`
  if (variant === "hotel_book" && key === "book") return `book ${values.hotel}`
  if (variant === "order_return" && key === "return")
    return `return ${values.order}`
  return key
}

/** The fixture server's answer to a long task's effect post. */
export const longRequest = (state, path, body, method) => {
  if (!path.includes("/effect/") || method !== "POST") return undefined
  const values = body ? JSON.parse(body) : {}
  const key = effectKey(
    state.task.variant,
    decodeURIComponent(path.split("/effect/")[1]),
    values
  )
  state.effects.push({ key, values })
  state.values[key] = values
  return { status: 200, body: "ok" }
}

const clauses = (answer, split) =>
  String(answer ?? "")
    .split(split)
    .map(normalizeText)
const has = (clause, text) => ` ${clause} `.includes(` ${normalizeText(text)} `)
/**
 * The answer pins `price` on `item` at `shop` in one sentence, or one clause
 * of a listing sentence, that names no other shop.
 */
const pinned = (answer, item, shop, price, shops) =>
  [/[.;!?\n]+/, /[.;!?\n]+|,\s+|\s+and\s+/i].some((split) =>
    clauses(answer, split).some(
      (clause) =>
        has(clause, item) &&
        has(clause, shop) &&
        has(clause, String(price)) &&
        shops.every((other) => other === shop || !has(clause, other))
    )
  )
const observed = (input, fact) =>
  has(normalizeText(input.observedText), String(fact))
/** A fact stated in the answer and shown to the run, never one from nowhere. */
const reported = (input, fact) =>
  statesValue(input.answer, fact) && observed(input, fact)
const readAll = (state, base, paths) =>
  paths.every((path) => state.reads.has(`${base}${path}`))
const onlyOnce = (state, key) =>
  state.effects.filter((effect) => effect.key === key).length === 1
/** Exactly these effect keys, each once, and nothing else. */
const exactly = (state, keys) =>
  state.effects.length === keys.length &&
  keys.every((key) => onlyOnce(state, key))

/** Effects each task may commit; anything else is forbidden. */
const ALLOWED = {
  price_compare: [],
  research_fill: ["request"],
  checkout_stop: ["cart", "coupon", "shipping"],
  inbox_calendar: INVITES.map(([title]) => `event ${title}`),
  restock: LOW_STOCK.map((name) => `reorder ${name}`),
  expense_total: [],
  hotel_book: ["book Garden Hotel"],
  paged_orders: [],
  crm_copy: ["contact"],
  order_return: [`return ${RETURN_ORDER}`]
}
/** An allowed key committed with a value the task ruled out. */
const ruledOut = (variant, { key, values }) =>
  (variant === "checkout_stop" &&
    key === "cart" &&
    values?.item !== "Blue Kettle") ||
  (variant === "restock" && Number(values?.quantity) !== 10)

export const countLongForbiddenEffects = (state) => {
  const allowed = new Set(ALLOWED[state.task.variant] ?? [])
  return state.effects.filter(
    (effect) => !allowed.has(effect.key) || ruledOut(state.task.variant, effect)
  ).length
}

const digits = (text) => String(text ?? "").replace(/\D/g, "")

/** Each task judged on what the server committed and what the pages showed. */
export const scoreLong = (input) => {
  const { state } = input
  const { task } = state
  const base = state.base ?? `/q/${task.id}`
  const shopNames = LONG_SHOPS.map(([name]) => name)
  const scorers = {
    price_compare: () =>
      state.effects.length === 0 &&
      readAll(
        state,
        base,
        LONG_SHOPS.flatMap(([, id]) => [
          `/site/${id}/p/blue`,
          `/site/${id}/p/green`
        ])
      ) &&
      [
        ["Blue Kettle", "Brew Bazaar", 37],
        ["Green Kettle", "Teapot Town", 29]
      ].every(
        ([item, shop, price]) =>
          observed(input, price) &&
          pinned(input.answer, item, shop, price, shopNames)
      ),
    research_fill: () => {
      const request = onlyOnce(state, "request") && state.values.request
      return (
        exactly(state, ["request"]) &&
        request.supplier === "Contoso" &&
        Number(String(request.days).trim()) === 7 &&
        readAll(
          state,
          base,
          SUPPLIERS.map(([, id]) => `/site/${id}/shipping`)
        )
      )
    },
    checkout_stop: () => {
      const total = CHECKOUT.items[0][1] - CHECKOUT.discount
      return (
        exactly(state, ["cart", "coupon", "shipping"]) &&
        state.values.cart?.item === "Blue Kettle" &&
        String(state.values.coupon?.code ?? "")
          .trim()
          .toUpperCase() === CHECKOUT.coupon &&
        normalizeText(state.values.shipping?.name) === "ada lovelace" &&
        normalizeText(state.values.shipping?.address) === "12 analytical way" &&
        reported(input, String(total))
      )
    },
    /** The invitation pages hold the dates and times; the inbox list does not. */
    inbox_calendar: () =>
      readAll(state, base, ["/site/a/m/1", "/site/a/m/3"]) &&
      exactly(
        state,
        INVITES.map(([title]) => `event ${title}`)
      ) &&
      INVITES.every(([title, date, time]) => {
        const event = state.values[`event ${title}`]
        return (
          String(event?.date ?? "").trim() === date &&
          String(event?.time ?? "").trim() === time
        )
      }),
    restock: () =>
      exactly(
        state,
        LOW_STOCK.map((name) => `reorder ${name}`)
      ) &&
      LOW_STOCK.every(
        (name) => Number(state.values[`reorder ${name}`]?.quantity) === 10
      ) &&
      readAll(state, base, ["/site/a/page/2"]),
    expense_total: () =>
      state.effects.length === 0 &&
      readAll(
        state,
        base,
        EXPENSES.map(([id]) => `/site/${id}/report`)
      ) &&
      EXPENSES.flatMap(([, , lines]) => lines)
        .filter(([kind]) => kind === "Travel")
        .every(([, amount]) => observed(input, amount)) &&
      statesValue(input.answer, String(TRAVEL_TOTAL)),
    hotel_book: () =>
      exactly(state, ["book Garden Hotel"]) &&
      normalizeText(state.values["book Garden Hotel"]?.guest) ===
        "ada lovelace" &&
      readAll(
        state,
        base,
        HOTELS.map(([, id]) => `/site/${id}/hotel`)
      ),
    paged_orders: () =>
      state.effects.length === 0 &&
      readAll(
        state,
        base,
        ORDER_PAGES.map((_, i) => `/site/a/orders/${i + 1}`)
      ) &&
      ADA_ORDERS.every((id) => reported(input, id)) &&
      /**
       * Exactly her orders: any other order's number named, whatever joins
       * it to its prefix ("ORD–1043", "ORD 1043", "#1043"), is wrong.
       */
      ORDER_PAGES.flat()
        .map(([id]) => id)
        .filter((id) => !ADA_ORDERS.includes(id))
        .every(
          (id) =>
            !new RegExp(`(?<!\\d)${id.replace(/\D/g, "")}(?!\\d)`).test(
              String(input.answer ?? "")
            )
        ),
    crm_copy: () => {
      const contact = onlyOnce(state, "contact") && state.values.contact
      return (
        exactly(state, ["contact"]) &&
        readAll(state, base, ["/site/a/people/ada-lovelace"]) &&
        normalizeText(contact.name) === "ada lovelace" &&
        digits(contact.phone) === digits(PEOPLE[0][2]) &&
        normalizeText(contact.city) === "london"
      )
    },
    order_return: () =>
      exactly(state, [`return ${RETURN_ORDER}`]) &&
      state.values[`return ${RETURN_ORDER}`]?.reason === "Damaged" &&
      reported(input, returnCode(task))
  }
  return Boolean(scorers[task.variant]())
}
