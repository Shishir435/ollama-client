import type { Runtime } from "webextension-polyfill"
import {
  type AgentControlPort,
  attachAgentControlContentPort
} from "@/lib/browser-agent/control-port"
import { createAgentElementReferenceStore } from "@/lib/browser-agent/element-references"
import { buildAgentObservation } from "@/lib/browser-agent/observation-builder"
import { browser } from "@/lib/browser-api"

const INSTALL_MARKER = "__ollamaClientAgentControlInstalled__"

export const installAgentControlContentScript = (): void => {
  const scope = globalThis as typeof globalThis & Record<string, unknown>
  if (scope[INSTALL_MARKER]) return
  scope[INSTALL_MARKER] = true

  browser.runtime.onConnect.addListener(((rawPort: Runtime.Port) => {
    let references:
      | ReturnType<typeof createAgentElementReferenceStore>
      | undefined
    attachAgentControlContentPort(
      rawPort as unknown as AgentControlPort,
      (request) => {
        references ??= createAgentElementReferenceStore({
          documentId: request.documentId
        })
        return buildAgentObservation({
          document,
          tabId: request.tabId,
          documentId: request.documentId,
          minimumGeneration: request.minimumGeneration,
          references
        })
      }
    )
  }) as Parameters<typeof browser.runtime.onConnect.addListener>[0])
}

installAgentControlContentScript()
