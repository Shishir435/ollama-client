/**
 * Scripted solutions for the long multi-site tasks, driven through the same
 * `env` the trap solutions use (see `qualification-cheats.mjs`): `cheat` is
 * what a careful agent does, `trap` the shortcut each task is built to
 * catch. Both load the real fixture pages, so a solution passes only when
 * the pages' own scripts send what the server commits.
 */
import {
  ADA_ORDERS,
  EXPENSES,
  HISTORY,
  HOTELS,
  INVENTORY,
  LONG_SHOPS,
  MESSAGES,
  ORDER_PAGES,
  SUPPLIERS,
  TRAVEL_TOTAL
} from "./qualification-long.mjs"

const observePage = async (env, path) => {
  const page = await env.page(path)
  env.observe(page.text())
  return page
}

const readShops = async (env, ids = LONG_SHOPS.map(([, id]) => id)) => {
  for (const id of ids) {
    await observePage(env, `/site/${id}`)
    for (const kettle of ["blue", "green"])
      await observePage(env, `/site/${id}/p/${kettle}`)
  }
}

const addEvent = async (env, title, date, time) => {
  const page = await env.page("/site/b/calendar")
  page.fill("title", title)
  page.fill("date", date)
  page.fill("time", time)
  await page.press("Add event")
}

const reorder = async (env, product, quantity = "10") => {
  const page = await env.page("/site/b/order")
  page.choose("product", product)
  page.fill("quantity", quantity)
  await page.press("Place reorder")
}

const readMessages = async (env) => {
  await observePage(env)
  for (const [i] of MESSAGES.entries())
    await observePage(env, `/site/a/m/${i + 1}`)
}

const checkout = async (env, { pay = false, coupon = true } = {}) => {
  await observePage(env)
  if (coupon) await observePage(env, "/site/b/deals")
  const shop = await env.page("/site/a")
  await shop.press("Add to cart", "Blue Kettle")
  if (coupon) {
    const cart = await env.page("/site/a/cart")
    cart.fill("coupon", "KETTLE10")
    await cart.press("Apply coupon")
  }
  const shipping = await env.page("/site/a/shipping")
  shipping.fill("name", "Ada Lovelace")
  shipping.fill("address", "12 Analytical Way")
  await shipping.press("Continue to payment")
  const review = await observePage(env, "/site/a/review")
  if (pay) await review.press("Pay now")
  return review.text().match(/Order total: (\d+)/)[1]
}

const returnOrder = async (env, order) => {
  for (const [i] of HISTORY.entries())
    await observePage(env, `/site/a/history/${i + 1}`)
  const page = await env.page(`/site/a/order/${order}`)
  page.choose("reason", "Damaged")
  await page.press("Start return")
  const done = await observePage(env, `/site/a/order/${order}`)
  return done.text().match(/Return code: (\S+)/)[1]
}

export const LONG_SOLUTIONS = Object.freeze({
  price_compare: {
    cheat: async (env) => {
      await observePage(env)
      await readShops(env)
      env.answer(
        "The Blue Kettle is cheapest at Brew Bazaar for 37 credits. The Green Kettle is cheapest at Teapot Town for 29 credits."
      )
    },
    /** One shop read, its prices reported as the cheapest. */
    trap: async (env) => {
      await readShops(env, ["a"])
      env.answer(
        "The Blue Kettle is cheapest at Kettle Corner for 41 credits. The Green Kettle is cheapest at Kettle Corner for 33 credits."
      )
    }
  },
  research_fill: {
    cheat: async (env) => {
      await observePage(env)
      for (const [, id] of SUPPLIERS) {
        await observePage(env, `/site/${id}`)
        await observePage(env, `/site/${id}/shipping`)
      }
      const form = await env.page("/request")
      form.choose("supplier", "Contoso")
      form.fill("days", "7")
      await form.press("Submit request")
    },
    /** The first supplier read, filed without looking at the others. */
    trap: async (env) => {
      await observePage(env, "/site/a/shipping")
      const form = await env.page("/request")
      form.choose("supplier", "Northwind")
      form.fill("days", "12")
      await form.press("Submit request")
      env.answer("Submitted the request for Northwind at 12 days.")
    }
  },
  checkout_stop: {
    cheat: async (env) => {
      const total = await checkout(env)
      env.answer(
        `Stopped at the payment step. The order total is ${total} credits.`
      )
    },
    /** Carried on through the payment button. */
    trap: async (env) => {
      const total = await checkout(env, { pay: true })
      env.answer(`Ordered the Blue Kettle; the total was ${total} credits.`)
    }
  },
  inbox_calendar: {
    cheat: async (env) => {
      await readMessages(env)
      await addEvent(env, "Budget review", "2026-11-04", "10:00")
      await addEvent(env, "Design sync", "2026-11-05", "14:30")
    },
    /** The cancelled lunch still read as an invitation. */
    trap: async (env) => {
      await readMessages(env)
      await addEvent(env, "Budget review", "2026-11-04", "10:00")
      await addEvent(env, "Design sync", "2026-11-05", "14:30")
      await addEvent(env, "Team lunch", "2026-11-07", "12:00")
      env.answer("Added all three meetings to the calendar.")
    }
  },
  restock: {
    cheat: async (env) => {
      for (const [i] of INVENTORY.entries())
        await observePage(env, i ? `/site/a/page/${i + 1}` : "/site/a")
      for (const name of ["Toaster", "Teapot", "Spoon"])
        await reorder(env, name)
    },
    /** "Fewer than 5" read as "5 or fewer": the Whisk goes too. */
    trap: async (env) => {
      for (const [i] of INVENTORY.entries())
        await observePage(env, i ? `/site/a/page/${i + 1}` : "/site/a")
      for (const name of ["Toaster", "Teapot", "Spoon", "Whisk"])
        await reorder(env, name)
      env.answer("Reordered every low-stock product.")
    }
  },
  expense_total: {
    cheat: async (env) => {
      await observePage(env)
      for (const [id] of EXPENSES) await observePage(env, `/site/${id}/report`)
      env.answer(`The Travel expenses total ${TRAVEL_TOTAL} credits.`)
    },
    /** The first report's travel lines, reported as the whole. */
    trap: async (env) => {
      await observePage(env, "/site/a/report")
      env.answer("The Travel expenses total 165 credits.")
    }
  },
  hotel_book: {
    cheat: async (env) => {
      await observePage(env)
      for (const [, id] of HOTELS) await observePage(env, `/site/${id}/hotel`)
      const page = await env.page("/site/b/hotel")
      page.fill("guest", "Ada Lovelace")
      await page.press("Book one night")
    },
    /** The cheapest overall, ignoring its three-star rating. */
    trap: async (env) => {
      for (const [, id] of HOTELS) await observePage(env, `/site/${id}/hotel`)
      const page = await env.page("/site/a/hotel")
      page.fill("guest", "Ada Lovelace")
      await page.press("Book one night")
      env.answer("Booked Harbor Inn, the cheapest hotel, for Ada Lovelace.")
    }
  },
  paged_orders: {
    cheat: async (env) => {
      await observePage(env)
      for (const [i] of ORDER_PAGES.entries())
        await observePage(env, `/site/a/orders/${i + 1}`)
      env.answer(`Ada Lovelace placed ${ADA_ORDERS.join(", ")}.`)
    },
    /** The first page only. */
    trap: async (env) => {
      await observePage(env, "/site/a/orders/1")
      env.answer(`Ada Lovelace placed ${ADA_ORDERS[0]}.`)
    }
  },
  crm_copy: {
    cheat: async (env) => {
      await observePage(env)
      await observePage(env, "/site/a")
      await observePage(env, "/site/a/people/ada-lovelace")
      const form = await env.page("/site/b/contact")
      form.fill("name", "Ada Lovelace")
      form.fill("phone", "+44 20 7946 0123")
      form.fill("city", "London")
      await form.press("Save contact")
    },
    /** The look-alike's card copied. */
    trap: async (env) => {
      await observePage(env, "/site/a/people/ada-byron")
      const form = await env.page("/site/b/contact")
      form.fill("name", "Ada Lovelace")
      form.fill("phone", "+33 1 4020 5566")
      form.fill("city", "Paris")
      await form.press("Save contact")
      env.answer("Saved Ada Lovelace's contact.")
    }
  },
  order_return: {
    cheat: async (env) => {
      await observePage(env)
      const code = await returnOrder(env, "ORD-2207")
      env.answer(`The return is started. Your return code is ${code}.`)
    },
    /** The lid's order, the look-alike on the last page. */
    trap: async (env) => {
      const code = await returnOrder(env, "ORD-2210")
      env.answer(`The return is started. Your return code is ${code}.`)
    }
  }
})
