import cssText from "data-text:~globals.css"
import "@/i18n/config"

import { useStorage } from "@plasmohq/storage/hook"
import type { PlasmoCSConfig, PlasmoGetStyle } from "plasmo"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { useLanguageSync } from "@/hooks/use-language-sync"
import {
  DEFAULT_CONTENT_EXTRACTION_CONFIG,
  MESSAGE_KEYS,
  STORAGE_KEYS
} from "@/lib/constants"
import { Quote } from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ContentExtractionConfig } from "@/types"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  all_frames: true
}

export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style")
  style.textContent = cssText
  // Fix for :root variables in Shadow DOM
  // Replace :root with :host to ensure variables apply within the shadow tree
  style.textContent = style.textContent.replace(/:root/g, ":host")
  return style
}

const SelectionButton = () => {
  useLanguageSync()
  const { t } = useTranslation()
  const [showButton, setShowButton] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [selectionText, setSelectionText] = useState("")

  const [contentConfig] = useStorage<ContentExtractionConfig>(
    {
      key: STORAGE_KEYS.BROWSER.CONTENT_EXTRACTION_CONFIG,
      instance: plasmoGlobalStorage
    },
    DEFAULT_CONTENT_EXTRACTION_CONFIG
  )

  const isEnabled = contentConfig?.showSelectionButton ?? true

  useEffect(() => {
    if (!isEnabled) {
      setShowButton(false)
      return
    }

    const handleSelectionChange = () => {
      const selection = window.getSelection()
      const text = selection?.toString().trim()

      if (text && text.length > 0) {
        const range = selection?.getRangeAt(0)
        const rect = range?.getBoundingClientRect()

        if (rect) {
          setPosition({
            top: rect.bottom + window.scrollY + 10,
            left: rect.right + window.scrollX - 30
          })
          setSelectionText(text)
          setShowButton(true)
        }
      } else {
        setShowButton(false)
      }
    }

    document.addEventListener("mouseup", handleSelectionChange)
    document.addEventListener("keyup", handleSelectionChange)

    return () => {
      document.removeEventListener("mouseup", handleSelectionChange)
      document.removeEventListener("keyup", handleSelectionChange)
    }
  }, [isEnabled])

  const handleClick = async () => {
    try {
      await chrome.runtime.sendMessage({
        type: MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT,
        payload: selectionText
      })

      setShowButton(false)
      window.getSelection()?.removeAllRanges()
    } catch (error) {
      console.error("Failed to send selection:", error)
    }
  }

  if (!showButton || !isEnabled) return null

  return (
    <div
      style={{
        position: "absolute",
        top: position.top,
        left: position.left,
        zIndex: 2147483647
      }}>
      <Button
        onClick={handleClick}
        variant="secondary"
        className="h-8 gap-2 rounded-lg px-3 shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl"
        title={t("selection_button.tooltip")}>
        <Quote className="size-3.5" />
        <span className="text-xs font-medium">
          {t("selection_button.label")}
        </span>
      </Button>
    </div>
  )
}

export default SelectionButton
