import { CopyButton } from "@/features/chat/components/copy-button"
import { OLLAMA_CORS_COMMAND } from "@/lib/onboarding/provider-connection"

/**
 * The one command that lets Ollama accept this extension's origin, with a
 * copy action. Shown wherever a connection test reports the origin block.
 */
export const OllamaOriginsCommand = () => (
  <div className="flex items-center gap-1 rounded-control bg-muted p-2 text-foreground">
    <code className="min-w-0 flex-1 break-all font-mono text-xs select-all">
      {OLLAMA_CORS_COMMAND}
    </code>
    <CopyButton text={OLLAMA_CORS_COMMAND} />
  </div>
)
