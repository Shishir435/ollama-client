import { useTranslation } from "react-i18next"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

interface SearchScopeTabsProps {
  value: "all" | "current"
  onValueChange: (value: "all" | "current") => void
  disabled?: boolean
  className?: string
}

export const SearchScopeTabs = ({
  value,
  onValueChange,
  disabled,
  className
}: SearchScopeTabsProps) => {
  const { t } = useTranslation()

  return (
    <Tabs
      value={value}
      onValueChange={(v) => onValueChange(v as "all" | "current")}
      className={cn("w-full", className)}>
      <TabsList className="grid w-full grid-cols-2 h-9 p-1 bg-muted/50 border shadow-inner">
        <TabsTrigger
          value="all"
          disabled={disabled}
          className={cn(
            "text-xs transition-all duration-200",
            "data-active:bg-background data-active:text-foreground data-active:shadow-sm data-active:border-border/50",
            "hover:text-foreground/80"
          )}>
          {t("chat.search.scope_all")}
        </TabsTrigger>
        <TabsTrigger
          value="current"
          disabled={disabled}
          className={cn(
            "text-xs transition-all duration-200",
            "data-active:bg-background data-active:text-foreground data-active:shadow-sm data-active:border-border/50",
            "hover:text-foreground/80"
          )}>
          {t("chat.search.scope_current")}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
