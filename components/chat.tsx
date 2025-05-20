import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constant"
import { useEffect, useRef, useState } from "react"

import { useStorage } from "@plasmohq/storage/hook"

type Role = "user" | "assistant"

interface ChatMessage {
  role: Role
  content: string
}

function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [selectedModel] = useStorage<string>(
    STORAGE_KEYS.OLLAMA.SELECTED_MODEL,
    ""
  )
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const sendMessage = async () => {
    if (!input.trim()) return

    const userMessage: ChatMessage = { role: "user", content: input }
    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setInput("")
    setIsLoading(true)

    chrome.runtime.sendMessage(
      {
        type: MESSAGE_KEYS.OLLAMA.CHAT_WITH_MODEL,
        payload: {
          model: selectedModel,
          messages: newMessages
        }
      },
      (response) => {
        setIsLoading(false)
        if (response.success) {
          // Extract assistant message from response.data.choices[0].message
          const lastMessage = response.data.choices?.[0]?.message

          if (lastMessage?.role && lastMessage?.content) {
            setMessages([...newMessages, lastMessage])
          } else {
            setMessages([
              ...newMessages,
              { role: "assistant", content: "❌ Invalid response from model." }
            ])
          }
        } else {
          setMessages([
            ...newMessages,
            { role: "assistant", content: `❌ Error: ${response.error}` }
          ])
        }
      }
    )
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      sendMessage()
    }
  }

  return (
    <div className="flex h-full flex-col p-4">
      <ScrollArea className="flex-1 space-y-4 overflow-auto pr-2">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`rounded-md p-3 text-sm ${
              msg.role === "user"
                ? "ml-auto max-w-[80%] self-end bg-blue-100 text-blue-900"
                : "mr-auto max-w-[80%] self-start bg-gray-200 text-gray-900"
            }`}>
            {msg.content}
          </div>
        ))}
        <div ref={scrollRef} />
      </ScrollArea>

      <div className="mt-4 flex gap-2">
        <Input
          placeholder="Type your message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <Button onClick={sendMessage} disabled={isLoading}>
          {isLoading ? "..." : "Send"}
        </Button>
      </div>
    </div>
  )
}

export default Chat
