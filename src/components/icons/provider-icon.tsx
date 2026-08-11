import { lazy, Suspense } from "react"
import {
  isProviderBrandId,
  type ProviderBrandId
} from "@/lib/providers/provider-brand"
import { getProviderMeta } from "@/lib/providers/registry"
import { cn } from "@/lib/utils"
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
 * curated mark, then the icon its own endpoint served, then the registry's
 * generic icon. Falling back rather than guessing keeps a self-hosted endpoint
 * from wearing some hosted vendor's logo.
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

  const Icon = meta.icon.icon
  return <Icon className={className} />
}
