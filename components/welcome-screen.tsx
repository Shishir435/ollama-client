import SettingsButton from "@/components/settings-button"
import SocialHandles from "@/components/social-handles"
import { Button } from "@/components/ui/button"
import { useOllamaModels } from "@/hooks/use-ollama-models"
import { PanelTopClose } from "lucide-react"
import { useState } from "react"

export default function WelcomeScreen() {
  const [show, setShow] = useState(true)
  const { status, refresh } = useOllamaModels()

  if (!show) return null

  return (
    <div className="flex h-screen w-full flex-col items-center justify-center rounded-b-lg rounded-t-2xl bg-white px-4 text-center text-gray-900 scrollbar-none dark:bg-gray-900 dark:text-gray-100">
      <h1 className="mb-2 text-2xl font-semibold">Welcome to Ollama Chat</h1>
      <p className="dark:text-muted-foreground-dark mb-2 max-w-md text-sm text-muted-foreground">
        Start chatting with your local models using Ollama. Type a message below
        to get started.
      </p>

      <p className="dark:text-muted-foreground-dark mb-6 max-w-md text-sm text-yellow-500">
        ⚠️ Before you chat, please make sure you've set up Ollama correctly.
        <br />
        👉{" "}
        <a
          href="https://shishir435.github.io/ollama-client/ollama-setup-guide"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-yellow-600 dark:hover:text-yellow-400">
          Follow the Setup Guide
        </a>
      </p>

      {status === "error" && (
        <div className="mb-4 w-full max-w-md rounded-md border border-red-500 bg-red-100 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          ❌ Failed to connect to Ollama. Is the server running at{" "}
          <code>http://localhost:11434</code>?
          <div className="mt-2">
            <Button size="sm" variant="outline" onClick={refresh}>
              Retry
            </Button>
          </div>
        </div>
      )}

      {status === "empty" && (
        <div className="mb-4 w-full max-w-md rounded-md border border-yellow-500 bg-yellow-100 p-3 text-sm text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300">
          ⚠️ No models found. Please run <code>ollama pull gemma3:2b</code> or
          check your setup.
          <div className="mt-2">
            <a
              href="https://shishir435.github.io/ollama-client/ollama-setup-guide"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline dark:text-blue-400">
              Setup Guide
            </a>
          </div>
        </div>
      )}

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
