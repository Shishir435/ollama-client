import { Loader2, Search } from "lucide-react"
import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/class-names"

export interface SearchInputProps {
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
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  return (
    <div className={cn("relative", className)}>
      <Search className="absolute left-3 top-1/2 icon-md -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        placeholder={placeholder || t("chat.search.placeholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-9 h-10 text-sm shadow-xs transition-all focus:ring-2 focus:ring-primary/20"
      />
      {isSearching && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <Loader2 className="icon-md animate-spin text-foreground-tertiary" />
        </div>
      )}
    </div>
  )
}
