import type { Runtime } from "webextension-polyfill"
import { executeAgentDomMutationInDocument } from "@/lib/browser-agent/command-executor"
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
    attachAgentControlContentPort(rawPort as unknown as AgentControlPort, {
      buildObservation(request) {
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
      },
      executeDomMutation(request) {
        if (!references) {
          throw new Error("Agent mutation has no observed snapshot")
        }
        executeAgentDomMutationInDocument({
          effect: request.instruction,
          document,
          references,
          signal: { aborted: false }
        })
      }
    })
  }) as Parameters<typeof browser.runtime.onConnect.addListener>[0])
}

installAgentControlContentScript()
