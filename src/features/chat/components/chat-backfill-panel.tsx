import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { useAutoEmbedMessages } from "@/features/chat/hooks/use-auto-embed-messages"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { db } from "@/lib/db"
import { AlertCircle, Loader2, Sparkles } from "@/lib/lucide-icon"

export const ChatBackfillPanel = () => {
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)
  const { sessions } = useChatSessions()
  const { embedMessages } = useAutoEmbedMessages()

  const handleBackfill = useCallback(async () => {
    setIsRunning(true)
    setError(null)
    setCompleted(false)

    try {
      // Get all sessions
      const allSessions = await db.sessions.toArray()

      // Count total messages
      let totalMessages = 0
      for (const session of allSessions) {
        totalMessages += session.messages.filter(
          (msg) =>
            msg.role !== "system" &&
            msg.content?.trim().length >= 10 &&
            (msg.role === "user" || msg.done === true)
        ).length
      }

      setProgress({ current: 0, total: totalMessages })

      // Process each session
      let processedMessages = 0
      for (const session of allSessions) {
        const messagesToEmbed = session.messages.filter(
          (msg) =>
            msg.role !== "system" &&
            msg.content?.trim().length >= 10 &&
            (msg.role === "user" || msg.done === true)
        )

        if (messagesToEmbed.length > 0) {
          await embedMessages(messagesToEmbed, session.id)
          processedMessages += messagesToEmbed.length
          setProgress({ current: processedMessages, total: totalMessages })

          // Small delay to avoid overwhelming the system
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }

      setCompleted(true)
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Backfill failed"
      setError(errorMessage)
      console.error("Backfill error:", err)
    } finally {
      setIsRunning(false)
    }
  }, [embedMessages])

  const progressPercentage =
    progress.total > 0 ? (progress.current / progress.total) * 100 : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          Backfill Chat History
        </CardTitle>
        <CardDescription>
          Generate embeddings for all existing chat messages to enable semantic
          search
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-xs font-medium text-red-600 dark:text-red-400">
                  Error
                </p>
                <p className="text-xs text-muted-foreground mt-1">{error}</p>
              </div>
            </div>
          </div>
        )}

        {completed && (
          <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
            <div className="flex items-start gap-2">
              <Sparkles className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-xs font-medium text-green-600 dark:text-green-400">
                  Completed!
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Successfully embedded {progress.current} messages across{" "}
                  {sessions.length} sessions.
                </p>
              </div>
            </div>
          </div>
        )}

        {isRunning && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Processing {progress.current} of {progress.total} messages
              </span>
              <span>{Math.round(progressPercentage)}%</span>
            </div>
            <Progress value={progressPercentage} />
          </div>
        )}

        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            • This will process all messages from {sessions.length}{" "}
            {sessions.length === 1 ? "session" : "sessions"}
          </p>
          <p>• Only messages with at least 10 characters will be embedded</p>
          <p>• This may take a while depending on the number of messages</p>
        </div>

        <Button
          onClick={handleBackfill}
          disabled={isRunning}
          className="w-full"
          variant={completed ? "outline" : "default"}>
          {isRunning ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Processing...
            </>
          ) : completed ? (
            <>
              <Sparkles className="h-4 w-4 mr-2" />
              Backfill Completed
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-2" />
              Start Backfill
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  )
}
