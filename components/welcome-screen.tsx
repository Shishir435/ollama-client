import { Button } from "@/components/ui/button"
import { PanelTopClose } from "lucide-react"
import { useState } from "react"

import SettingsButton from "./settings-button"
import SocialHandles from "./social-handles"

export default function WelcomeScreen() {
  const [show, setShow] = useState(true)

  if (!show) return null

  return (
    <div className="scrollbar-none flex h-screen w-full flex-col items-center justify-center rounded-full px-4 text-center">
      <h1 className="mb-2 text-2xl font-semibold">Welcome to Ollama Chat</h1>
      <p className="mb-6 max-w-md text-sm text-muted-foreground">
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
        className="mt-2 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setShow(false)}>
        <PanelTopClose className="mr-1 h-4 w-4" />
        Hide Welcome
      </Button>
    </div>
  )
}
