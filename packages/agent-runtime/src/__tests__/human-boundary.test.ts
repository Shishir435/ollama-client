import type { AgentObservation } from "@ollama-client/contracts"
import { expect, it } from "vitest"
import { agentObservationNeedsHuman } from "../human-boundary"

const page = (
  title: string,
  visibleText: string,
  elements: AgentObservation["elements"] = []
) => ({ title, visibleText, elements }) as AgentObservation

it("pauses on a rendered login gate or challenge without treating ordinary prose as a gate", () => {
  expect(
    agentObservationNeedsHuman(page("Just a moment...", "Verify you are human"))
  ).toBe(true)
  expect(
    agentObservationNeedsHuman(
      page("Sign in", "", [
        {
          ref: "e1",
          tag: "input",
          type: "password",
          visible: true,
          enabled: true,
          editable: true,
          sensitive: true,
          frameId: 0
        },
        {
          ref: "e2",
          tag: "button",
          name: "Sign in",
          visible: true,
          enabled: true,
          editable: false,
          sensitive: false,
          frameId: 0
        }
      ])
    )
  ).toBe(true)
  expect(
    agentObservationNeedsHuman(
      page("CAPTCHA documentation", "Learn to integrate CAPTCHA or sign in")
    )
  ).toBe(false)
  expect(agentObservationNeedsHuman(page("Home", "Sign in"))).toBe(false)
})

const control = (
  ref: string,
  overrides: Partial<AgentObservation["elements"][number]>
): AgentObservation["elements"][number] => ({
  ref,
  tag: "input",
  visible: true,
  enabled: true,
  editable: true,
  sensitive: false,
  frameId: 0,
  ...overrides
})

it("treats a password field with its own form's submit control as a credential gate", () => {
  const field = control("e1", {
    type: "password",
    sensitive: true,
    formFingerprint: "aaaaaaaa"
  })
  const user = control("e0", { type: "email", formFingerprint: "aaaaaaaa" })
  const submit = control("e2", {
    tag: "button",
    name: "Submit",
    editable: false,
    formFingerprint: "aaaaaaaa"
  })
  expect(
    agentObservationNeedsHuman(page("Account", "", [user, field, submit]))
  ).toBe(true)
  /** Unbound to any form, only a page that calls itself a sign-in counts. */
  expect(
    agentObservationNeedsHuman({
      ...page("Welcome back", "", [{ ...field, formFingerprint: undefined }]),
      url: "https://example.com/login"
    })
  ).toBe(true)
  expect(
    agentObservationNeedsHuman(
      page("Status", "", [{ ...field, formFingerprint: undefined }])
    )
  ).toBe(false)
  expect(
    agentObservationNeedsHuman(
      page("Account", "", [{ ...field, visible: false }, submit])
    )
  ).toBe(false)
})

it("does not treat an optional password form among settings as a sign-in", () => {
  const passwordForm = "bbbbbbbb"
  const elements = [
    control("p1", {
      type: "password",
      sensitive: true,
      formFingerprint: passwordForm
    }),
    control("p2", {
      type: "password",
      sensitive: true,
      formFingerprint: passwordForm
    }),
    control("p3", {
      type: "password",
      sensitive: true,
      formFingerprint: passwordForm
    }),
    control("b1", {
      tag: "button",
      name: "Confirm",
      editable: false,
      formFingerprint: passwordForm
    }),
    /** A Submit elsewhere on the page belongs to another form. */
    control("b2", {
      tag: "button",
      name: "Submit",
      editable: false,
      formFingerprint: "cccccccc"
    })
  ]
  expect(agentObservationNeedsHuman(page("Settings", "", elements))).toBe(false)
  /** A single password among a profile's many fields is not a sign-in either. */
  const profile = "dddddddd"
  expect(
    agentObservationNeedsHuman(
      page("Settings", "", [
        control("f1", { type: "text", formFingerprint: profile }),
        control("f2", { type: "email", formFingerprint: profile }),
        control("f3", { type: "tel", formFingerprint: profile }),
        control("f4", {
          type: "password",
          sensitive: true,
          formFingerprint: profile
        }),
        control("f5", {
          tag: "button",
          name: "Submit",
          editable: false,
          formFingerprint: profile
        })
      ])
    )
  ).toBe(false)
})
