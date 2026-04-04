import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { Loader2, Search } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  isSearching?: boolean
  placeholder?: string
  className?: string
  autoFocus?: boolean
}

export const SearchInput = ({
  value,
  onChange,
  isSearching,
  placeholder,
  className,
  autoFocus = true
}: SearchInputProps) => {
  const { t } = useTranslation()

  return (
    <div className={cn("relative", className)}>
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder={placeholder || t("chat.search.placeholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-9 h-10 text-sm shadow-xs transition-all focus:ring-2 focus:ring-primary/20"
        autoFocus={autoFocus}
      />
      {isSearching && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/60" />
        </div>
      )}
    </div>
  )
}
