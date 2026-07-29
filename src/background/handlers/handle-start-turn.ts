import { startDurableTurn } from "@/background/durable-turn-runtime"
import { withErrorContext } from "@/background/lib/error-handler"
import type { StartTurnMessage } from "@/types"

export const handleStartTurn = withErrorContext(
  async (msg: StartTurnMessage, port, isPortClosed) => {
    const { start, assistantMessageId } = msg.payload
    await startDurableTurn(
      start.submission,
      start.userMessageId,
      assistantMessageId,
      { port, isPortClosed }
    )
  },
  {
    handler: "handleStartTurn",
    operation: "durable turn",
    resolveDiagnosticSessionId: (msg) => msg.payload.start.submission.sessionId
  }
)
