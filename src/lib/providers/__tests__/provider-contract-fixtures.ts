import { vi } from "vitest"

import type { ToolDefinition } from "@/lib/tools/types"
import type { ChatStreamMessage } from "@/types"

const encoder = new TextEncoder()

export const weatherTool: ToolDefinition = {
  name: "get_weather",
  description: "Get the weather",
  parameters: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"]
  }
}

export const streamResponse = (chunks: string[]): Response => {
  let index = 0
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: vi.fn(async () =>
          index < chunks.length
            ? { done: false, value: encoder.encode(chunks[index++]) }
            : { done: true, value: undefined }
        ),
        cancel: vi.fn(async () => undefined),
        releaseLock: vi.fn()
      })
    },
    text: async () => ""
  } as unknown as Response
}

export const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  })

export const requestBody = (
  fetchMock: ReturnType<typeof vi.spyOn>,
  call = 0
): Record<string, unknown> =>
  JSON.parse((fetchMock.mock.calls[call]?.[1] as RequestInit).body as string)

export const collectChunks = () => {
  const chunks: ChatStreamMessage[] = []
  return {
    chunks,
    onChunk: (chunk: ChatStreamMessage) => chunks.push(chunk)
  }
}

export const openAIStream = ({
  reasoning = "plan",
  content = "done",
  includeTool = true
}: {
  reasoning?: string
  content?: string
  includeTool?: boolean
} = {}): string[] => [
  `data: ${JSON.stringify({
    choices: [{ delta: { reasoning_content: reasoning } }]
  })}\n\n`,
  `data: ${JSON.stringify({
    choices: [{ delta: { content } }]
  })}\n\n`,
  ...(includeTool
    ? [
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "get_weather",
                      arguments: '{"city":"Paris"}'
                    }
                  }
                ]
              },
              finish_reason: "tool_calls"
            }
          ]
        })}\n\n`
      ]
    : []),
  `data: ${JSON.stringify({
    choices: [],
    usage: { prompt_tokens: 7, completion_tokens: 3 }
  })}\n\n`,
  "data: [DONE]\n\n"
]
