import { beforeEach, describe, expect, it } from "vitest"

import { consumePrintJob, printJobKey, purgeStalePrintJobs } from "../print-job"

const putJob = (jobId: string, payload: unknown) => {
  localStorage.setItem(printJobKey(jobId), JSON.stringify(payload))
}

describe("print job handoff", () => {
  beforeEach(() => localStorage.clear())

  it("consumes a job exactly once", () => {
    putJob("a", {
      html: "<p>hi</p>",
      filename: "chat.pdf",
      allowRemoteImages: false,
      createdAt: 123
    })

    const job = consumePrintJob("a")
    expect(job).toMatchObject({ html: "<p>hi</p>", filename: "chat.pdf" })
    expect(consumePrintJob("a")).toBeNull()
    expect(localStorage.getItem(printJobKey("a"))).toBeNull()
  })

  it("rejects malformed payloads", () => {
    localStorage.setItem(printJobKey("bad"), "not json")
    expect(consumePrintJob("bad")).toBeNull()

    putJob("no-html", { filename: "x.pdf" })
    expect(consumePrintJob("no-html")).toBeNull()
  })

  it("leaves other jobs untouched when one is consumed", () => {
    putJob("a", {
      html: "A",
      filename: "",
      allowRemoteImages: false,
      createdAt: 1
    })
    putJob("b", {
      html: "B",
      filename: "",
      allowRemoteImages: false,
      createdAt: 1
    })

    consumePrintJob("a")
    expect(consumePrintJob("b")?.html).toBe("B")
  })

  it("purges stale and legacy payloads but keeps fresh jobs", () => {
    const now = Date.now()
    putJob("fresh", {
      html: "F",
      filename: "",
      allowRemoteImages: false,
      createdAt: now
    })
    putJob("stale", {
      html: "S",
      filename: "",
      allowRemoteImages: false,
      createdAt: now - 11 * 60 * 1000
    })
    localStorage.setItem(printJobKey("garbage"), "not json")
    localStorage.setItem("print_html", "<p>legacy</p>")
    localStorage.setItem("print_filename", "legacy.pdf")
    localStorage.setItem("print_allow_remote", "1")

    purgeStalePrintJobs(now)

    expect(localStorage.getItem(printJobKey("fresh"))).not.toBeNull()
    expect(localStorage.getItem(printJobKey("stale"))).toBeNull()
    expect(localStorage.getItem(printJobKey("garbage"))).toBeNull()
    expect(localStorage.getItem("print_html")).toBeNull()
    expect(localStorage.getItem("print_filename")).toBeNull()
    expect(localStorage.getItem("print_allow_remote")).toBeNull()
  })
})
