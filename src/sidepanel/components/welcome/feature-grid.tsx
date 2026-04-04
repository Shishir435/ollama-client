import { useTranslation } from "react-i18next"
import { Cpu, Globe, Shield, Sparkles } from "@/lib/lucide-icon"
import { FeatureCard, type FeatureColor } from "./feature-card"

export const FeatureGrid = () => {
  const { t } = useTranslation()

  return (
    <div className="mb-6 grid w-full max-w-xl grid-cols-2 gap-4">
      {[
        { icon: Shield, color: "green", key: "private" },
        { icon: Globe, color: "blue", key: "offline" },
        { icon: Cpu, color: "purple", key: "local_processing" },
        { icon: Sparkles, color: "indigo", key: "embeddings" }
      ].map(({ icon, color, key }) => (
        <FeatureCard
          key={key}
          icon={icon}
          color={color as FeatureColor}
          title={t(`welcome.features.${key}.title`)}
          description={t(`welcome.features.${key}.description`)}
        />
      ))}
    </div>
  )
}
