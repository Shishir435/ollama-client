import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

type CustomClassGroupId = "icon"

/**
 * tailwind-merge does not read globals.css. Register custom size/radius/spacing
 * tokens and the icon-* utility group so caller classes override base classes.
 * Semantic colors and font families already use the library's default groups.
 */
const twMerge = extendTailwindMerge<CustomClassGroupId>({
  extend: {
    theme: {
      text: ["nano", "micro", "2xs"],
      radius: ["control", "panel", "chip", "message", "4xl"],
      spacing: ["control-xs", "control-sm", "control-md", "control-lg"]
    },
    classGroups: {
      icon: [{ icon: ["micro", "xs", "sm", "md", "lg", "xl", "2xl", "3xl"] }]
    }
  }
})

/** Compose classes with caller overrides, including the app's custom tokens. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
