import { lazy, Suspense } from "react"
import { cn } from "@/lib/class-names"
import {
  isProviderBrandId,
  type ProviderBrandId
} from "@/lib/providers/provider-brand"
import { getProviderMeta } from "@/lib/providers/registry"
import { isCustomProviderId } from "@/lib/providers/types"
import { useIconMask } from "./use-icon-mask"

/**
 * The marks are ~19KB of path data for sixteen vendors, and nothing draws them
 * until a provider surface is opened — the model menu or the provider grid. Held
 * behind a dynamic import so they cost a chunk on first use rather than weight
 * in every page's initial payload.
 */
const BrandGlyph = lazy(async () => {
  const { PROVIDER_BRAND_ICONS } = await import("./provider-brand-icons")
  return {
    default: ({
      brand,
      className
    }: {
      brand: ProviderBrandId
      className?: string
    }) => {
      const Icon = PROVIDER_BRAND_ICONS[brand]
      return <Icon className={className} />
    }
  }
})

/**
 * Initials for a provider that has no mark and no icon of its own.
 *
 * Every custom provider fell back to one identical server glyph, so a rail
 * holding three of them said only that three existed. The name the user gave
 * is the one thing that distinguishes them, and its first letters are the part
 * that survives at sixteen pixels — a second letter only for a name that has a
 * second word, because two glyphs at this size are already close to unreadable.
 */
export const providerMonogram = (name?: string): string | undefined => {
  const words =
    name
      ?.trim()
      .split(/[\s._/-]+/)
      .filter(Boolean) ?? []
  if (words.length === 0) return undefined
  const initials =
    words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0][0]
  return initials.toUpperCase()
}

/**
 * Drawn as SVG text in the mark's own 24-square box so it scales with whatever
 * size class the caller passes, exactly as every curated mark does. A span with
 * a font size could not follow the box.
 */
const ProviderMonogram = ({
  initials,
  className
}: {
  initials: string
  className?: string
}) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    focusable="false">
    <rect
      x="1.5"
      y="1.5"
      width="21"
      height="21"
      rx="5"
      stroke="currentColor"
      strokeWidth="1.5"
      opacity="0.5"
    />
    <text
      x="12"
      y="12.5"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={initials.length > 1 ? 10 : 13}
      fontWeight="600"
      fill="currentColor">
      {initials}
    </text>
  </svg>
)

export interface ProviderIconProps {
  providerId?: string
  /**
   * Brand resolved from the provider's own configuration. Custom providers all
   * share the `custom:` id shape, so their vendor is knowable only from the
   * base URL, service profile, or display name — never from the id alone.
   */
  brand?: ProviderBrandId | string
  /** Stored display name, so a custom provider shows its user-given name. */
  fallbackName?: string
  /**
   * `data:` URI of the icon the provider's own endpoint served, used only when
   * there is no curated mark for it.
   */
  iconUrl?: string
  className?: string
}

/**
 * One glyph for a provider, in descending order of confidence: the vendor's
 * curated mark, then the icon its own endpoint served, then the initials of a
 * custom provider's own name, then the registry's generic icon. Falling back
 * rather than guessing keeps a self-hosted endpoint from wearing some hosted
 * vendor's logo, and the initials keep a rail of unrecognised providers from
 * being a row of one repeated glyph.
 */
export const ProviderIcon = ({
  providerId,
  brand,
  fallbackName,
  iconUrl,
  className
}: ProviderIconProps) => {
  const meta = getProviderMeta(providerId, fallbackName)
  const brandId = isProviderBrandId(brand) ? brand : meta.brand
  // Built only for a fetched icon that is actually going to be drawn.
  const iconMask = useIconMask(brandId ? undefined : iconUrl)
  const FallbackIcon = meta.icon.kind === "lucide" ? meta.icon.icon : undefined

  if (brandId) {
    // The generic glyph holds the slot for the one frame the chunk takes, so
    // the row does not reflow around an empty box.
    return (
      <Suspense
        fallback={FallbackIcon ? <FallbackIcon className={className} /> : null}>
        <BrandGlyph brand={brandId} className={className} />
      </Suspense>
    )
  }

  if (iconUrl) {
    /*
     * Painted through a mask so the icon reads as a glyph in the current text
     * colour, the same as every mark around it, in either theme.
     */
    if (iconMask) {
      return (
        <span
          aria-hidden="true"
          /*
           * Held slightly back: the glyphs around it are line art, this is a
           * filled mark, so the same colour reads as more ink at the same size.
           */
          className={cn(
            "inline-block shrink-0 bg-current opacity-80",
            className
          )}
          style={{
            maskImage: `url("${iconMask}")`,
            WebkitMaskImage: `url("${iconMask}")`,
            maskSize: "contain",
            WebkitMaskSize: "contain",
            maskRepeat: "no-repeat",
            WebkitMaskRepeat: "no-repeat",
            maskPosition: "center",
            WebkitMaskPosition: "center"
          }}
        />
      )
    }

    /*
     * No mask yet, or no canvas to build one with. Desaturating keeps the icon
     * from shouting over the glyphs around it, and the per-theme brightness
     * nudge keeps a mark drawn for a white site background from disappearing
     * against a dark rail.
     */
    return (
      <img
        src={iconUrl}
        alt=""
        aria-hidden="true"
        className={cn(
          "rounded-control object-contain grayscale brightness-90 dark:brightness-150 dark:contrast-75",
          className
        )}
      />
    )
  }

  if (meta.icon.kind === "asset") {
    return <img src={meta.icon.src} alt={meta.icon.alt} className={className} />
  }

  /*
   * Initials before the generic glyph. A custom provider has no curated mark
   * and, on loopback, no favicon either, so every one of them drew the same
   * server icon — a rail of three said only that three existed.
   */
  const monogram =
    providerId && isCustomProviderId(providerId)
      ? providerMonogram(fallbackName)
      : undefined
  if (monogram) {
    return <ProviderMonogram initials={monogram} className={className} />
  }

  const Icon = meta.icon.icon
  return <Icon className={className} />
}
