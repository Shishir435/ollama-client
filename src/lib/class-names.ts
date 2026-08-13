import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * Custom class-group ids registered with tailwind-merge.
 *
 * `icon` covers our hand-written `icon-*` `@utility` classes (see `globals.css`),
 * which set `width` + `height`. They are not part of any standard Tailwind scale,
 * so tailwind-merge has no built-in conflict group for them — we define one here.
 */
type CustomClassGroupId = "icon"

/**
 * A `twMerge` instance taught about this project's custom Tailwind tokens.
 *
 * tailwind-merge ships a static config and never reads our CSS, so it doesn't
 * know the custom values declared in `@theme` / `@utility` (`globals.css`). Left
 * unconfigured, a later utility such as `text-nano` does not displace a base
 * class such as `text-micro`; tailwind-merge keeps both and CSS source order —
 * not author intent — decides the winner.
 *
 * Two mechanisms close that gap:
 *
 * - `theme`: registers custom values on an existing Tailwind scale, which
 *   teaches every class group fed by that scale at once.
 *     - `text`    → font-size utilities (`text-nano`, `text-micro`, `text-2xs`)
 *     - `radius`  → every `rounded-*` group (`rounded-control`, `rounded-panel`, …)
 *     - `spacing` → every spacing group (`p-`, `m-`, `gap-`, `w-`, `h-`, `size-`, `inset-`, …)
 *
 * - `classGroups`: defines conflict groups for fully custom `@utility` names that
 *   map to no standard scale (see {@link CustomClassGroupId}).
 *
 * Colors and font-families need no entry here — tailwind-merge already treats any
 * unknown `text-*` / `bg-*` / `font-*` token as a color or family respectively.
 */
const twMerge = extendTailwindMerge<CustomClassGroupId>({
  extend: {
    theme: {
      text: ["nano", "micro", "2xs"],
      radius: ["control", "panel", "chip", "message", "4xl"],
      spacing: ["control-sm", "control-md", "control-lg"]
    },
    classGroups: {
      icon: [{ icon: ["micro", "xs", "sm", "md", "lg", "xl", "2xl", "3xl"] }]
    }
  }
})

/**
 * Merge Tailwind class names, resolving conflicts so the last-applied utility
 * wins (e.g. a `className` prop overrides a component's base classes).
 *
 * Combines `clsx` (conditional/array/object class composition) with this
 * project's configured `twMerge` (conflict resolution, including the custom
 * tokens documented above). Prefer this over raw string concatenation anywhere
 * classes may overlap.
 *
 * @param inputs - Any `clsx`-compatible values (strings, arrays, conditional objects).
 * @returns The merged, de-conflicted class string.
 *
 * @example
 * cn("px-2 text-micro", isLarge && "text-nano") // → "px-2 text-nano" when isLarge
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
