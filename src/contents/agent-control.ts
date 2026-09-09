import type { Runtime } from "webextension-polyfill"
import {
  executeAgentDomMutationInDocument,
  executeAgentScrollInDocument
} from "@/lib/browser-agent/command-executor"
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
    /*
     * One store per port, created from the first request's binding: the
     * frame id and document id the background connected to are the identity
     * every reference this document hands out is bound to.
     */
    let references:
      | ReturnType<typeof createAgentElementReferenceStore>
      | undefined
    attachAgentControlContentPort(rawPort as unknown as AgentControlPort, {
      buildObservation(request) {
        references ??= createAgentElementReferenceStore({
          documentId: request.documentId,
          frameId: request.frameId
        })
        return buildAgentObservation({
          document,
          tabId: request.tabId,
          frameId: request.frameId,
          documentId: request.documentId,
          minimumGeneration: request.minimumGeneration,
          elementLimit: request.elementLimit,
          references
        })
      },
      executeDomMutation(request) {
        if (!references) {
          throw new Error("Agent mutation has no observed snapshot")
        }
        return executeAgentDomMutationInDocument({
          effect: request.instruction,
          document,
          references,
          signal: { aborted: false }
        })
      },
      executeScroll(request) {
        if (!references) {
          throw new Error("Agent scroll has no observed snapshot")
        }
        executeAgentScrollInDocument({
          command: request.instruction.command,
          identity: request.instruction.frame,
          document,
          references
        })
      }
    })
  }) as Parameters<typeof browser.runtime.onConnect.addListener>[0])
}

installAgentControlContentScript()
