import { Box, Text, useInput } from "ink"
import React, { useCallback, useMemo, useState } from "react"

export type ReplMessage = {
  id: string
  role: "user" | "assistant"
  content: string
}

type ReplProps = {
  onSubmit: (input: string) => Promise<void>
  messages: ReplMessage[]
  status?: string
}

export const Repl = ({ onSubmit, messages, status }: ReplProps) => {
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)

  const handleSubmit = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || busy) return
    setInput("")
    setBusy(true)
    await onSubmit(trimmed)
    setBusy(false)
  }, [busy, input, onSubmit])

  useInput((value, key) => {
    if (key.return) {
      void handleSubmit()
      return
    }

    if (key.backspace || key.delete) {
      setInput((current) => current.slice(0, -1))
      return
    }

    if (key.ctrl && value === "c") {
      process.exit(0)
    }

    if (value) {
      setInput((current) => current + value)
    }
  })

  const content = useMemo(() => messages, [messages])

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        {content.map((message) => (
          <Text key={message.id}>
            <Text color={message.role === "user" ? "cyan" : "green"}>
              {message.role === "user" ? "You" : "olc"}:
            </Text>{" "}
            {message.content}
          </Text>
        ))}
      </Box>
      <Text color="yellow">{status || "Type a message and press Enter"}</Text>
      <Text>
        <Text color="cyan">&gt; </Text>
        {input}
        {busy ? " …" : ""}
      </Text>
    </Box>
  )
}
