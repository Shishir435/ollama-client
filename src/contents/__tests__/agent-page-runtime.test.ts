import { beforeEach, describe, expect, it, vi } from "vitest"
import { executeAgentAction, snapshotPage } from "@/contents/agent-page-runtime"

const visibleRect = {
  x: 10,
  y: 10,
  width: 120,
  height: 32,
  top: 10,
  right: 130,
  bottom: 42,
  left: 10,
  toJSON: () => ({})
}

describe("agent page runtime", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      visibleRect
    )
  })

  it("creates snapshot-scoped accessible element references", () => {
    document.body.innerHTML = `
      <label for="email">Email address</label>
      <input id="email" type="email" />
      <button aria-label="Save profile">Save</button>
    `

    const snapshot = snapshotPage()

    expect(snapshot.elements).toHaveLength(2)
    expect(snapshot.elements[0]).toMatchObject({
      role: "textbox",
      name: "Email address",
      type: "email"
    })
    expect(snapshot.elements[1]).toMatchObject({
      role: "button",
      name: "Save profile"
    })
  })

  it("replaces text through the native setter and expires older snapshots", () => {
    document.body.innerHTML = '<input aria-label="Name" value="old" />'
    const first = snapshotPage()
    const input = document.querySelector("input") as HTMLInputElement

    executeAgentAction({
      action: "type",
      snapshotId: first.snapshotId,
      elementId: 1,
      text: "new"
    })
    expect(input.value).toBe("new")

    snapshotPage()
    expect(() =>
      executeAgentAction({
        action: "click",
        snapshotId: first.snapshotId,
        elementId: 1
      })
    ).toThrow("Page changed")
  })

  it("refuses password fields at executor boundary", () => {
    document.body.innerHTML = '<input type="password" aria-label="Password" />'
    const snapshot = snapshotPage()

    expect(() =>
      executeAgentAction({
        action: "type",
        snapshotId: snapshot.snapshotId,
        elementId: 1,
        text: "secret"
      })
    ).toThrow("not supported")
  })

  it("rejects a disconnected target", () => {
    document.body.innerHTML = '<button aria-label="Remove">Remove</button>'
    const snapshot = snapshotPage()
    document.querySelector("button")?.remove()

    expect(() =>
      executeAgentAction({
        action: "click",
        snapshotId: snapshot.snapshotId,
        elementId: 1
      })
    ).toThrow("changed or disappeared")
  })
})
