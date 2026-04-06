import { Box, Text } from "ink"
import React from "react"

export type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
}

type ChatAppProps = {
  messages: ChatMessage[]
  status?: string
}

export const ChatApp = ({ messages, status }: ChatAppProps) => {
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        {messages.map((message) => (
          <Text key={message.id}>
            <Text color={message.role === "user" ? "cyan" : "green"}>
              {message.role === "user" ? "You" : "olc"}:
            </Text>{" "}
            {message.content}
          </Text>
        ))}
      </Box>
      {status ? <Text color="yellow">{status}</Text> : null}
    </Box>
  )
}
