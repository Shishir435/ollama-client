import { useTranslation } from "react-i18next"
import { Sparkles } from "@/lib/lucide-icon"

export const HeroSection = () => {
  const { t } = useTranslation()

  return (
    <div className="flex w-full max-w-xl flex-col items-center text-center">
      <div className="group relative mb-5 flex cursor-default items-center gap-2 rounded-full border border-border bg-muted/40 py-1.5 pl-1.5 pr-4 text-xs font-medium uppercase tracking-widest transition-all duration-500 hover:border-primary/40 hover:bg-muted/60 hover:shadow-md">
        <div className="relative flex size-7 items-center justify-center rounded-full bg-linear-to-br from-foreground to-muted-foreground shadow-sm transition-all duration-500 group-hover:scale-110 group-hover:shadow-primary/30">
          <div className="absolute inset-0 rounded-full bg-primary/30 opacity-0 transition-opacity duration-300 group-hover:animate-ping group-hover:opacity-100" />
          <Sparkles className="relative z-10 size-3.5 text-background transition-transform duration-500 group-hover:rotate-12" />
        </div>
        <span className="relative bg-linear-to-r from-foreground to-foreground/80 bg-clip-text text-xs font-bold text-transparent transition-all duration-300 group-hover:from-primary group-hover:to-primary/80">
          {t("welcome.badge")}
        </span>
      </div>
      <h1 className="mb-2 text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
        {t("welcome.title")}
      </h1>
      <p className="mb-6 max-w-[90%] text-sm text-muted-foreground sm:text-base">
        {t("welcome.subtitle")}
      </p>
    </div>
  )
}
