import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import { Check, ChevronsUpDown, Loader2, Mic } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

interface VoiceSelectorProps {
  voices: SpeechSynthesisVoice[]
  selectedVoiceURI: string | null
  onVoiceChange: (voiceURI: string) => void
  isLoading?: boolean
}

export const VoiceSelector = ({
  voices,
  selectedVoiceURI,
  onVoiceChange,
  isLoading = false
}: VoiceSelectorProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")

  const selectedVoice = useMemo(
    () => voices.find((v) => v.voiceURI === selectedVoiceURI),
    [voices, selectedVoiceURI]
  )

  // Group voices by language for better organization
  const groupedVoices = useMemo(() => {
    const grouped = voices.reduce(
      (acc, voice) => {
        const lang = voice.lang || t("chat.voice_selector.unknown_language")
        if (!acc[lang]) {
          acc[lang] = []
        }
        acc[lang].push(voice)
        return acc
      },
      {} as Record<string, SpeechSynthesisVoice[]>
    )

    // Sort languages alphabetically
    return Object.keys(grouped)
      .sort()
      .map((lang) => ({
        lang,
        voices: grouped[lang].sort((a, b) => a.name.localeCompare(b.name))
      }))
  }, [voices, t])

  // Filter voices based on search query
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) {
      return groupedVoices
    }

    const query = searchQuery.toLowerCase()
    return groupedVoices
      .map((group) => ({
        ...group,
        voices: group.voices.filter(
          (voice) =>
            voice.name.toLowerCase().includes(query) ||
            voice.lang.toLowerCase().includes(query) ||
            voice.voiceURI.toLowerCase().includes(query)
        )
      }))
      .filter((group) => group.voices.length > 0)
  }, [groupedVoices, searchQuery])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={t("chat.voice_selector.select_voice")}
          className={cn(
            "h-10 w-full justify-between gap-2 border-input bg-background px-3 text-sm font-normal shadow-sm transition-colors",
            "hover:bg-accent hover:text-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            open && "ring-1 ring-ring"
          )}
          disabled={isLoading || voices.length === 0}>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
                <span className="text-muted-foreground text-sm truncate">
                  {t("chat.speech.loading_voices")}
                </span>
              </>
            ) : selectedVoice ? (
              <>
                <span className="text-sm font-medium truncate">
                  {selectedVoice.name}
                </span>
                <Badge
                  variant="secondary"
                  className="text-[10px] h-5 px-1.5 font-normal shrink-0">
                  {selectedVoice.lang}
                </Badge>
              </>
            ) : (
              <span className="text-muted-foreground text-sm truncate">
                {t("chat.voice_selector.select_placeholder")}
              </span>
            )}
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[440px] p-0 shadow-lg"
        align="center"
        sideOffset={6}>
        <Command className="rounded-lg border-0" shouldFilter={false}>
          <div className="flex items-center border-b px-3">
            <CommandInput
              placeholder={t("chat.voice_selector.search_placeholder")}
              value={searchQuery}
              onValueChange={setSearchQuery}
              className="h-11 border-0 focus:outline-none focus:ring-0"
            />
          </div>
          <CommandList className="max-h-[320px] overflow-y-auto">
            <CommandEmpty className="py-8">
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="rounded-full bg-muted p-3">
                  <Mic className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    {t("chat.voice_selector.no_voices_found")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {searchQuery
                      ? t("chat.voice_selector.try_different_search")
                      : t("chat.voice_selector.no_voices_available")}
                  </p>
                </div>
              </div>
            </CommandEmpty>
            <div className="p-1">
              {filteredGroups.map((group, groupIndex) => (
                <CommandGroup
                  key={group.lang}
                  className={cn("px-0 py-0", groupIndex > 0 && "mt-2")}>
                  <div className="flex items-center justify-between px-3 py-2 mb-1">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {group.lang}
                    </span>
                    <Badge
                      variant="secondary"
                      className="text-[10px] h-4 px-1.5 font-normal">
                      {group.voices.length}
                    </Badge>
                  </div>
                  {group.voices.map((voice) => {
                    const isSelected = selectedVoiceURI === voice.voiceURI
                    return (
                      <CommandItem
                        key={voice.voiceURI}
                        value={voice.voiceURI}
                        onSelect={() => {
                          onVoiceChange(voice.voiceURI)
                          setOpen(false)
                          setSearchQuery("")
                        }}
                        className={cn(
                          "group mx-1 flex items-center gap-3 rounded-md px-3 py-2.5 cursor-pointer transition-all",
                          "aria-selected:bg-accent/50",
                          isSelected
                            ? "bg-accent text-accent-foreground shadow-sm"
                            : "hover:bg-accent/50"
                        )}>
                        <div className="flex flex-1 items-center justify-between gap-3 min-w-0">
                          <div className="flex flex-col min-w-0">
                            <span
                              className={cn(
                                "text-sm truncate leading-tight transition-colors",
                                isSelected ? "font-semibold" : "font-medium"
                              )}>
                              {voice.name}
                            </span>
                            {voice.localService === false && (
                              <span className="text-[10px] text-muted-foreground mt-0.5">
                                {t("chat.voice_selector.network_voice")}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {voice.default && (
                              <Badge
                                variant="outline"
                                className="text-[10px] h-4 px-1.5 font-normal border-muted-foreground/30">
                                {t("chat.voice_selector.default_badge")}
                              </Badge>
                            )}
                            {isSelected && (
                              <div className="flex items-center justify-center">
                                <Check className="h-4 w-4 text-primary" />
                              </div>
                            )}
                          </div>
                        </div>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              ))}
            </div>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
