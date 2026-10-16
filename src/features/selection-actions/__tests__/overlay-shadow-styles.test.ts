import { describe, expect, it } from "vitest"
import {
  buildShadowStyles,
  registeredPropertyFallback
} from "../overlay-shadow-styles"

const compiled = [
  "@layer properties{@supports (((-webkit-hyphens:none))){*{--tw-ring-shadow:0 0 #0000}}}",
  '@property --tw-ring-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}',
  '@property --tw-ring-color{syntax:"*";inherits:false}',
  '@property --tw-ring-offset-width{syntax:"<length>";inherits:false;initial-value:0}',
  '@property --shimmer-angle{syntax:"<angle>";inherits:true;initial-value:20deg}'
].join("\n")

describe("overlay registered-property fallback", () => {
  it("restates every @property as a declaration the shadow root applies", () => {
    const fallback = registeredPropertyFallback(compiled)
    expect(fallback.startsWith("@layer properties{")).toBe(true)
    expect(fallback).toContain(
      "*,::before,::after,::backdrop{--tw-ring-shadow:0 0 #0000;--tw-ring-color:initial;--tw-ring-offset-width:0px}"
    )
    expect(fallback).toContain(":host{--shimmer-angle:20deg}")
    expect(fallback).not.toContain("@supports")
  })

  it("ships the fallback with the overlay's styles", () => {
    expect(buildShadowStyles(compiled)).toContain(
      registeredPropertyFallback(compiled)
    )
  })

  it("adds nothing when the app styles register no properties", () => {
    expect(registeredPropertyFallback("")).toBe("")
  })
})
