import { useTranslation } from "react-i18next"
import { SocialLinkButton } from "@/components/social-link-button"
import { SOCIAL_LINKS } from "@/lib/constants-ui"

export const SocialHandles = () => {
  const { t } = useTranslation()

  return (
    <div className="mb-8">
      <div className="mb-6 text-center">
        <h3 className="mb-2 text-lg font-semibold text-foreground">
          {t("common.social.title")}
        </h3>
        <div className="mx-auto h-0.5 w-12 rounded-full bg-linear-to-r from-blue-500 to-purple-500"></div>
      </div>

      <div className="mx-auto flex max-w-md flex-wrap justify-center gap-4 p-2">
        {SOCIAL_LINKS.map(({ id, labelKey, href, icon: Icon }) => (
          <SocialLinkButton
            key={id}
            href={href}
            aria-label={t("common.social.visit_profile", {
              platform: t(labelKey)
            })}
            icon={Icon}
            label={t(labelKey)}
          />
        ))}
      </div>
    </div>
  )
}
