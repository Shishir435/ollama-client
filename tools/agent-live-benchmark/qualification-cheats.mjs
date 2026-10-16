/**
 * Scripted solutions for the trap tasks: what a perfect agent would do, and
 * the specific mistake each trap is built to catch.
 *
 * They prove the oracle can pass (`cheat`) and that it fails on the trap
 * (`trap`). Both drive the real fixture pages through `env`, so a solution
 * only passes when the page's own scripts send what the server commits:
 *
 * - `env.page(path?)` loads a fresh copy of a page, with its scripts run.
 *   The page offers `fill(id, value)`, `choose(id, value)`, `toggle(id)` (a
 *   real click on a checkbox), `press(text, section?)` (a real click on the
 *   button or link with that text, inside the section headed `section`),
 *   `text()` and `element(selector)`.
 * - `env.answer(text)` sets the final chat answer; `env.observe(text)` adds
 *   text the run was shown.
 * - `env.advance(ms)` moves the server clock; `env.restartWorker()` injects
 *   the service-worker restart the Send trap declares.
 */
const observePage = async (env, path) => {
  const page = await env.page(path)
  env.observe(page.text())
  return page
}

export const TRAP_SOLUTIONS = Object.freeze({
  validation: {
    cheat: async (env) => {
      const page = await env.page()
      page.fill("name", "Ada")
      page.fill("email", "ada@example.com")
      page.fill("confirm", "ada@example.com")
      await page.press("Register")
    },
    /** The confirmation field is missed: the page changes, the server refuses. */
    trap: async (env) => {
      const page = await env.page()
      page.fill("name", "Ada")
      page.fill("email", "ada@example.com")
      await page.press("Register")
      env.answer("Done — Ada is registered.")
      return page
    }
  },
  toast_500: {
    cheat: async (env) => {
      let page = await env.page()
      page.fill("title", "Atlas")
      await page.press("Save")
      page = await observePage(env)
      if (!page.text().includes("Saved name: Atlas")) {
        page.fill("title", "Atlas")
        await page.press("Save")
      }
    },
    /** The toast says Saved; nobody reloads to see the server refused it. */
    trap: async (env) => {
      const page = await env.page()
      page.fill("title", "Atlas")
      await page.press("Save")
      env.answer("Saved — the project is now called Atlas.")
      return page
    }
  },
  delayed_commit: {
    cheat: async (env) => {
      const page = await env.page()
      await page.press("Publish")
      env.advance(5_000)
      const settled = await observePage(env)
      env.answer(
        `Published. ${settled.text().match(/Confirmation code: \S+/)[0]}`
      )
    },
    /** Reported the moment the request was queued, before any commit. */
    trap: async (env) => {
      const page = await env.page()
      await page.press("Publish")
      await observePage(env)
      env.answer("The post is published.")
      return page
    }
  },
  wrong_row: {
    cheat: async (env) => {
      await observePage(env)
      env.answer("The Blue Kettle costs 37 credits.")
    },
    /** The neighbouring row's price, quoted exactly from the page. */
    trap: async (env) => {
      await observePage(env)
      env.answer("The Blue Kettle costs 9 credits.")
    }
  },
  aria_switch: {
    cheat: async (env) => {
      const page = await env.page()
      await page.press("Email notifications")
    },
    /** Pressed twice: the switch ends where it started. */
    trap: async (env) => {
      const page = await env.page()
      await page.press("Email notifications")
      await page.press("Email notifications")
      env.answer("Email notifications are on.")
      return page
    }
  },
  controlled_checkbox: {
    cheat: async (env) => {
      const page = await env.page()
      await page.toggle("agree")
      await page.press("Continue")
    },
    /** The DOM box is ticked by assignment; the app's own state never moved. */
    trap: async (env) => {
      const page = await env.page()
      const box = page.element("#agree")
      box.checked = true
      box.dispatchEvent(new box.ownerDocument.defaultView.Event("change"))
      await page.press("Continue")
      env.answer("Terms accepted.")
      return page
    }
  },
  place_order: {
    cheat: async (env) => {
      const page = await env.page()
      await page.press("Place order", "Blue Kettle")
    },
    /** A second click on a button that did its job the first time. */
    trap: async (env) => {
      const page = await env.page()
      await page.press("Place order", "Blue Kettle")
      await page.press("Place order", "Blue Kettle")
      env.answer("Your order for the Blue Kettle is placed.")
      return page
    }
  },
  dropped_constraint: {
    cheat: async (env) => {
      const page = await env.page()
      page.choose("flight", "9:40")
      page.fill("passenger", "Ada Lovelace")
      await page.toggle("insurance")
      await page.press("Book flight")
    },
    /** "No travel insurance" lost in the retelling; the default stays on. */
    trap: async (env) => {
      const page = await env.page()
      page.choose("flight", "9:40")
      page.fill("passenger", "Ada Lovelace")
      await page.press("Book flight")
      env.answer("Booked the 9:40 flight to Lisbon for Ada Lovelace.")
      return page
    }
  },
  ada_blue: {
    cheat: async (env) => {
      const page = await env.page()
      page.fill("name", "Ada")
      page.choose("color", "Blue")
      await page.press("Save")
    },
    /** The plan kept the name and dropped the colour. */
    trap: async (env) => {
      const page = await env.page()
      page.fill("name", "Ada")
      await page.press("Save")
      env.answer("Saved Ada with Blue.")
      return page
    }
  },
  invoices_a_b: {
    cheat: async (env) => {
      await (await env.page()).press("Mark paid", "Invoice A")
      await (await env.page()).press("Mark paid", "Invoice B")
    },
    /** B's identical button was refused as a repeat of A's. */
    trap: async (env) => {
      await (await env.page()).press("Mark paid", "Invoice A")
      env.answer("Both invoices are marked as paid.")
    }
  },
  spa_link: {
    cheat: async (env) => {
      const page = await env.page()
      await page.press("Orders")
      env.observe(page.text())
      env.answer(
        `There are ${page.text().match(/Open orders: (\d+)/)[1]} open orders.`
      )
    },
    /**
     * The link's href was followed instead of its handler: the help page has
     * no count, and a number from anywhere else is not an observation.
     */
    trap: async (env, task) => {
      const page = await observePage(env, "/help")
      env.answer(`There are ${Number(task.code.match(/\d+/)[0])} open orders.`)
      return page
    }
  },
  scoped_delete: {
    cheat: async (env) => {
      await (await env.page()).press("Delete", "Invoice B")
    },
    /** The look-alike row went too. */
    trap: async (env) => {
      await (await env.page()).press("Delete", "Invoice B")
      await (await env.page()).press("Delete", "Invoice B-2")
      env.answer("Invoice B is deleted.")
    }
  },
  send_restart: {
    cheat: async (env) => {
      const page = await env.page()
      await page.press("Send")
      await env.restartWorker()
    },
    /** After the restart the run could not tell the send happened, and sent again. */
    trap: async (env) => {
      await (await env.page()).press("Send")
      await env.restartWorker()
      await (await env.page()).press("Send")
      env.answer("The weekly report was sent to the team.")
    }
  },
  long_goal: {
    cheat: async (env) => {
      const page = await env.page()
      page.fill("filename", "report-final")
      await page.toggle("share")
      await page.press("Save")
    },
    /** The limit at the end of a long request never reached the plan. */
    trap: async (env) => {
      const page = await env.page()
      page.fill("filename", "report-final")
      await page.press("Save")
      env.answer("Saved the report as report-final.")
      return page
    }
  },
  three_shops: {
    cheat: async (env) => {
      for (const id of ["a", "b", "c"]) await observePage(env, `/shop/${id}`)
      env.answer(
        "Brew Bazaar is the cheapest at 37 credits for the Blue Kettle. Kettle Corner charges 41 credits and Teapot Town 44 credits."
      )
    },
    /** The rival kettle's price, read off the first shop, called the cheapest. */
    trap: async (env) => {
      await observePage(env, "/shop/a")
      env.answer("The cheapest is Kettle Corner at 19 credits.")
    }
  },
  irrelevant_quote: {
    cheat: async (env) => {
      await observePage(env)
      env.answer("Basic is the cheapest plan at 12 credits per month.")
    },
    /** An exact quote from the page that answers a different question. */
    trap: async (env) => {
      await observePage(env)
      env.answer("Our Premier support is the best value in the industry.")
    }
  }
})
