import { Button } from "@/components/ui/button"
import { PanelTopClose } from "lucide-react"
import { useState } from "react"

import SettingsButton from "./settings-button"
import SocialHandles from "./social-handles"

export default function WelcomeScreen() {
  const [show, setShow] = useState(true)

  if (!show) return null

  return (
    <div className="flex h-screen w-full flex-col items-center justify-center rounded-b-lg rounded-t-2xl bg-white px-4 text-center text-gray-900 scrollbar-none dark:bg-gray-900 dark:text-gray-100">
      <h1 className="mb-2 text-2xl font-semibold">Welcome to Ollama Chat</h1>
      <p className="dark:text-muted-foreground-dark mb-6 max-w-md text-sm text-muted-foreground">
        Start chatting with your local models using Ollama. Type a message below
        to get started.
      </p>

      <div className="mb-6 flex items-center gap-3">
        <Button
          variant="default"
          onClick={() => {
            const textarea = document.getElementById("chat-input-textarea")
            textarea?.focus()
          }}>
          Start Chatting
        </Button>
        <SettingsButton />
      </div>

      <SocialHandles />

      <Button
        variant="ghost"
        className="dark:text-muted-foreground-dark mt-2 text-xs text-muted-foreground hover:text-foreground dark:hover:text-gray-200"
        onClick={() => setShow(false)}>
        <PanelTopClose className="mr-1 h-4 w-4" />
        Hide Welcome
      </Button>
    </div>
  )
}
