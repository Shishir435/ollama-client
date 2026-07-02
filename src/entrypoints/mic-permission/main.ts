/**
 * Microphone permission handshake page.
 *
 * The sidepanel cannot reliably show the browser's mic permission prompt
 * (`SpeechRecognition.start()` never prompts; `getUserMedia` prompts are
 * suppressed in some panel contexts). This page runs in a regular tab where
 * the prompt always shows; the grant applies to the whole extension origin,
 * so the sidepanel's voice input works afterwards.
 */
import { resources } from "@/i18n/resources"

type PageKey =
  | "page_title"
  | "page_requesting"
  | "page_granted"
  | "page_denied"
  | "page_retry"

const pickLanguage = (): string => {
  const stored = localStorage.getItem("i18nextLng")
  const candidates = [stored, navigator.language, "en"]
  for (const candidate of candidates) {
    if (!candidate) continue
    const base = candidate.split("-")[0]
    if (base in resources) return base
  }
  return "en"
}

const lang = pickLanguage()
const t = (key: PageKey): string => {
  const table = (
    resources as Record<
      string,
      { translation: { chat: { voice_input: Record<string, string> } } }
    >
  )[lang]
  return table.translation.chat.voice_input[key]
}

const titleEl = document.getElementById("title") as HTMLHeadingElement
const messageEl = document.getElementById("message") as HTMLParagraphElement
const retryEl = document.getElementById("retry") as HTMLButtonElement

const requestMic = async (): Promise<void> => {
  titleEl.textContent = t("page_title")
  messageEl.textContent = t("page_requesting")
  retryEl.classList.add("hidden")

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    for (const track of stream.getTracks()) track.stop()
    messageEl.textContent = t("page_granted")
    setTimeout(() => window.close(), 1500)
  } catch {
    messageEl.textContent = t("page_denied")
    retryEl.textContent = t("page_retry")
    retryEl.classList.remove("hidden")
  }
}

retryEl.addEventListener("click", () => void requestMic())
document.title = t("page_title")
void requestMic()
