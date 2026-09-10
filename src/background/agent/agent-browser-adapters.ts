import type {
  AgentCancellationSignal,
  AgentObservationPort,
  AgentScreenshotPort,
  AuthorizedAgentEffect
} from "@ollama-client/agent-runtime"
import type {
  AgentDialogState,
  AgentObservation,
  AgentSnapshotIdentity
} from "@ollama-client/contracts"

import type { AgentCommandExecutorAdapter } from "@/lib/browser-agent/command-executor"
import type { AgentDomMutationInstruction } from "@/lib/browser-agent/control-port"
import type { AgentEffectVerifierAdapter } from "@/lib/browser-agent/effect-verifier"
import {
  type AgentInputPlatform,
  runAgentNativeInputPlan
} from "@/lib/browser-agent/native-input"
import type { AgentEffectResolverAdapter } from "@/lib/browser-agent/resolved-effect"
import {
  type AgentImageEditor,
  type AgentScreenshotSource,
  createAgentScreenshotPort
} from "@/lib/browser-agent/screenshot-capture"
import { createOffscreenAgentImageEditor } from "@/lib/browser-agent/screenshot-image"
import { browser } from "@/lib/browser-api"
import {
  classifyAgentTabAccess,
  queryActiveTab
} from "@/lib/browser-tab-access"
import type {
  AgentBrowserSessionManager,
  AgentExtensionFrame
} from "./agent-browser-session-manager"
import type { AgentControlSessionRegistry } from "./agent-control-sessions"
import { waitForAgentNavigation } from "./agent-navigation-settlement"
import type { AgentTabHistory } from "./agent-tab-history"

export interface AgentBrowserAdapters {
  observation: AgentObservationPort
  /** Absent when this browser offers no way to picture the tab. */
  screenshot?: AgentScreenshotPort
  resolver: AgentEffectResolverAdapter
  executor: AgentCommandExecutorAdapter
  verifier: AgentEffectVerifierAdapter
}

export interface AgentVisibleTabApi {
  get(tabId: number): Promise<{ windowId?: number; active?: boolean }>
  captureVisibleTab(
    windowId: number,
    options: { format: "jpeg"; quality: number }
  ): Promise<string>
}

/**
 * Pictures a tab without a debugger: the browser's own capture of the visible
 * tab, framed by the observation's viewport since no layout metrics come with
 * it. The API pictures whichever tab is active in the window, so the
 * controlled tab has to be that tab immediately before and after the capture
 * or nothing is returned — a picture of a neighbouring tab stamped with this
 * tab's identity would be masked for the wrong page. Pinch zoom is not
 * accounted for on this path and clips are not offered.
 */
export const visibleTabCaptureSource = (
  viewportOf: (
    tabId: number
  ) => { x: number; y: number; width: number; height: number } | undefined,
  tabs: AgentVisibleTabApi = browser.tabs as unknown as AgentVisibleTabApi
): AgentScreenshotSource => ({
  async capture(tabId, clip) {
    if (clip) return undefined
    const viewport = viewportOf(tabId)
    if (!viewport) return undefined
    const activeWindow = async (): Promise<number | undefined> => {
      try {
        const tab = await tabs.get(tabId)
        return tab.active === true ? tab.windowId : undefined
      } catch {
        return undefined
      }
    }
    const windowBefore = await activeWindow()
    if (windowBefore === undefined) return undefined
    let dataUrl: string
    try {
      dataUrl = await tabs.captureVisibleTab(windowBefore, {
        format: "jpeg",
        quality: 80
      })
    } catch {
      return undefined
    }
    if ((await activeWindow()) !== windowBefore) return undefined
    const match = /^data:(image\/(?:jpeg|png));base64,(.+)$/.exec(dataUrl)
    if (!match) return undefined
    const layout = {
      pageX: viewport.x,
      pageY: viewport.y,
      clientWidth: viewport.width,
      clientHeight: viewport.height
    }
    return {
      data: match[2],
      mimeType: match[1] as "image/jpeg" | "image/png",
      layout: {
        cssLayoutViewport: layout,
        cssVisualViewport: { ...layout, scale: 1 }
      }
    }
  }
})

/**
 * A cancellable pause. Both sides of a `wait` need one — the executor to let
 * the page settle, the verifier to space the looks it takes while the
 * condition has not appeared — and a second copy would be a second
 * cancellation contract.
 */
const waitFor = (ms: number, signal: AgentCancellationSignal): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Agent wait cancelled"))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener?.("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error("Agent wait cancelled"))
    }
    signal.addEventListener?.("abort", onAbort, { once: true })
  })

/** The platform's primary editing modifier, read once from the worker's own UA. */
const detectPlatform = (): AgentInputPlatform => {
  const navigatorLike = globalThis.navigator as
    | { userAgentData?: { platform?: string }; platform?: string }
    | undefined
  const platform =
    navigatorLike?.userAgentData?.platform ?? navigatorLike?.platform ?? ""
  return /mac/i.test(platform) ? "mac" : "other"
}

/**
 * Bridges the run-neutral resolver, executor and verifier ports to Chromium.
 *
 * Every adapter is built for one run: the control port is bound to that run's
 * id, so a tab handle cannot be shared with another run, and page-side work
 * (scroll, DOM mutation, observation) goes through the same bound session
 * rather than a fresh injection.
 */
export const createAgentBrowserAdapters = (input: {
  runId: string
  sessions: AgentControlSessionRegistry
  /** Absent means no native backend: every action runs through the content script. */
  browserSessions?: AgentBrowserSessionManager
  history: AgentTabHistory
  now?: () => number
  platform?: AgentInputPlatform
  listFrames?: (tabId: number) => Promise<readonly AgentExtensionFrame[]>
  /** Defaults to the worker's OffscreenCanvas; absent means no screenshots. */
  imageEditor?: AgentImageEditor
}): AgentBrowserAdapters => {
  const now = input.now ?? (() => Date.now())
  const imageEditor =
    "imageEditor" in input
      ? input.imageEditor
      : createOffscreenAgentImageEditor()
  const platform = input.platform ?? detectPlatform()
  const listFrames =
    input.listFrames ??
    (async (tabId: number): Promise<AgentExtensionFrame[]> => {
      const frames = (await browser.webNavigation.getAllFrames({ tabId })) as
        | { frameId: number; parentFrameId?: number; url: string }[]
        | null
      return (frames ?? []).map((frame) => ({
        frameId: frame.frameId,
        ...(frame.parentFrameId !== undefined && frame.parentFrameId >= 0
          ? { parentFrameId: frame.parentFrameId }
          : {}),
        url: frame.url
      }))
    })

  const abortSignal = (
    signal: AgentCancellationSignal
  ): AbortSignal | undefined => {
    const controller = new AbortController()
    if (signal.aborted) {
      controller.abort()
      return controller.signal
    }
    signal.addEventListener?.("abort", () => controller.abort(), { once: true })
    return controller.signal
  }

  const mutationInstruction = (
    effect: AuthorizedAgentEffect
  ): AgentDomMutationInstruction => {
    if (!effect.target.ref || !effect.target.tag) {
      throw new Error("Agent mutation target is not an observed element")
    }
    /**
     * The frame identity travels as the instruction's own field, never inside
     * the wire target: that target is validated by a strict schema with no
     * `frame` key, so leaking it there is a parse failure before a byte is
     * sent. `noSubmitStep` is dropped for the same reason — it is policy's
     * evidence about the target, not a fact the page is told.
     */
    const {
      frame: targetFrame,
      point,
      noSubmitStep: _noSubmitStep,
      ...target
    } = effect.target
    const frame = targetFrame ?? effect.snapshotIdentity
    return {
      command: effect.command,
      target: { ...target, ref: effect.target.ref, frameId: frame.frameId },
      snapshotIdentity: effect.snapshotIdentity,
      frame,
      ...(point ? { point } : {})
    } as AgentDomMutationInstruction
  }

  const getTab = async (tabId: number) => {
    try {
      return await browser.tabs.get(tabId)
    } catch {
      return undefined
    }
  }

  const targetFrame = (effect: AuthorizedAgentEffect): AgentSnapshotIdentity =>
    effect.target.frame ?? effect.snapshotIdentity

  const nativeChannel = (effect: AuthorizedAgentEffect) =>
    input.browserSessions?.nativeInput(
      input.runId,
      effect.snapshotIdentity.tabId
    )

  /**
   * The native half of the executor adapter, present only when a session
   * manager was supplied. Facts are read immediately before the action; the
   * frame offset is resolved from the debugger's tree, never from the page.
   */
  const nativeAdapter: Pick<
    AgentCommandExecutorAdapter,
    | "nativeControl"
    | "prepareNativeInput"
    | "dispatchNativeInput"
    | "settleNativeInput"
    | "viewportCentre"
    | "fileChooserOpened"
    | "handleDialog"
  > = {
    async nativeControl(effect) {
      const channel = nativeChannel(effect)
      const cdpControl = input.browserSessions?.capabilities.cdpControl ?? false
      if (!channel) {
        return { cdpControl, attached: false, frameMapped: false, platform }
      }
      /**
       * The facts are read once, immediately before the action acts, so this
       * is where its file-chooser window opens: a chooser the page raised
       * before now belongs to no action of this run and is discarded.
       */
      channel.beginFileChooserWindow()
      const frame = targetFrame(effect)
      const frames = frame.frameId === 0 ? [] : await listFrames(frame.tabId)
      const offset = await channel.frameOffset(frame.frameId, frames)
      return {
        cdpControl,
        attached: true,
        frameMapped: offset !== undefined,
        ...(offset ? { frameOffset: offset } : {}),
        platform
      }
    },
    async prepareNativeInput(effect, signal) {
      return input.sessions.prepareNativeInput(
        {
          runId: input.runId,
          tabId: effect.snapshotIdentity.tabId,
          instruction: mutationInstruction(effect)
        },
        abortSignal(signal)
      )
    },
    async dispatchNativeInput(effect, plan, signal) {
      const channel = nativeChannel(effect)
      if (!channel) throw new Error("Agent debugger is no longer attached")
      return runAgentNativeInputPlan(plan, channel, signal)
    },
    async settleNativeInput(effect, signal) {
      return input.sessions.settleNativeInput(
        {
          runId: input.runId,
          tabId: effect.snapshotIdentity.tabId,
          frameId: targetFrame(effect).frameId
        },
        abortSignal(signal)
      )
    },
    async viewportCentre(effect) {
      return nativeChannel(effect)?.viewportCentre()
    },
    async fileChooserOpened(effect) {
      return nativeChannel(effect)?.consumeFileChooser() ?? false
    },
    async handleDialog(effect) {
      const { command } = effect
      if (command.type !== "handle_dialog") {
        throw new Error("Agent dialog answer names another command")
      }
      return (
        (await input.browserSessions?.handleDialog(
          input.runId,
          effect.snapshotIdentity.tabId,
          {
            dialogId: command.dialogId,
            accept: command.accept,
            ...(command.promptText === undefined
              ? {}
              : { promptText: command.promptText })
          }
        )) ?? "not_open"
      )
    }
  }

  const resolveHistoryDestination = async (
    tabId: number,
    direction: "back" | "forward"
  ) => input.history.resolveDestination(tabId, direction)

  /**
   * Every observation this run takes, whether the controller's or the
   * verifier's, goes through here — so the dialog check is not something a
   * second caller can forget. A blocked document cannot answer a control
   * port at all, and a verifier that asked one anyway would wait for a page
   * that is not going to reply until the dialog is answered.
   */
  const observe = async (
    tabId: number,
    minimumGeneration: number,
    allowedOrigins: readonly string[],
    signal: AgentCancellationSignal
  ): Promise<AgentObservation> => {
    const dialog = input.browserSessions?.openDialog(input.runId, tabId)
    if (dialog) {
      return dialogBlockedObservation(
        { tabId, minimumGeneration, allowedOrigins },
        dialog
      )
    }
    const observation = await input.sessions.observe(
      { runId: input.runId, tabId, minimumGeneration, allowedOrigins },
      abortSignal(signal)
    )
    lastPage.set(tabId, {
      documentId: observation.documentId,
      generation: observation.generation
    })
    return observation
  }

  /**
   * The picture comes through the debugger when the run holds one and through
   * the browser's visible-tab capture otherwise; sensitive controls are
   * measured through the same bound control session the observation used.
   */
  const lastViewport = new Map<
    number,
    { x: number; y: number; width: number; height: number }
  >()
  /**
   * What the last real observation of a tab established about it. A dialog
   * blocks the document, so an observation taken while one is open cannot ask
   * the page anything — including which document it is and which generation
   * its references are on. Both are remembered here from the observation
   * before it.
   */
  const lastPage = new Map<number, { documentId: string; generation: number }>()
  const screenshot: AgentScreenshotPort | undefined = imageEditor
    ? createAgentScreenshotPort({
        editor: imageEditor,
        now,
        source: {
          async capture(tabId, clip, signal) {
            const channel = input.browserSessions?.nativeInput(
              input.runId,
              tabId
            )
            if (channel) return channel.captureScreenshot(clip)
            return visibleTabCaptureSource((id) =>
              lastViewport.get(id)
            ).capture(tabId, clip, signal)
          }
        },
        sensitive: {
          async regions(tabId, observation, signal) {
            try {
              const regions = await input.sessions.sensitiveRegions(
                {
                  runId: input.runId,
                  tabId,
                  frame: {
                    snapshotId: observation.snapshotId,
                    generation: observation.generation,
                    tabId: observation.tabId,
                    frameId: observation.frameId,
                    documentId: observation.documentId
                  }
                },
                abortSignal(signal)
              )
              return regions ?? undefined
            } catch {
              return undefined
            }
          }
        }
      })
    : undefined

  /**
   * The observation of a tab a native dialog is holding.
   *
   * Nothing in the page can be read: its script is blocked, so the content
   * script cannot answer and no element, text or scroll position can be
   * reported. What travels instead is the truth — the tab, the dialog, and a
   * root frame that says it was not read — so the only thing the run can do
   * with it is answer the dialog, which is also the only thing that is true.
   *
   * Its identity is the browser's where the browser knows it (the tab and its
   * document) and the run's own where the page would have supplied it: the
   * generation follows the last real observation so nothing regresses, and
   * the snapshot names the dialog, so a command grounded in this observation
   * cannot be replayed against the page once the dialog is gone.
   */
  /**
   * The dialog as this run is allowed to know it.
   *
   * A dialog belongs to the document that opened it, and an embedded frame's
   * `confirm` blocks the whole tab — so a dialog's text is read exactly when
   * that document's content is, and it is the document, not the tab, that
   * decides.
   *
   * For a child frame that is the run's origin allowlist, the same gate
   * `authorizeAgentFrame` applies to a frame's elements: a dialog from an
   * origin outside it is reported as existing, on that origin, with nothing
   * it wrote. For the document the tab itself shows it is not, because the
   * root frame is not allowlist-gated either — `observeRoot` reads the page
   * the user pointed the run at, and `allowedOrigins` governs where the run
   * may travel and act rather than what the page in front of it may say.
   * Withholding an `alert` from a page whose whole body text is already
   * readable would be a stricter rule for the box on top than for the page
   * under it, and it would blind the run to a legitimate dialog after any
   * redirect it did not itself approve.
   *
   * Reading it is not the same as answering it: a dialog on an origin the
   * run was never approved for costs an approval whoever raised it, which is
   * `baselineRisk`'s business and not this function's.
   */
  const authorizedDialog = (
    dialog: AgentDialogState,
    pageOrigin: string,
    allowedOrigins: readonly string[]
  ): AgentDialogState => {
    if (
      dialog.origin === pageOrigin ||
      allowedOrigins.includes(dialog.origin)
    ) {
      return dialog
    }
    const { defaultPrompt: _withheld, ...rest } = dialog
    return { ...rest, message: "", unauthorizedOrigin: true }
  }

  const dialogBlockedObservation = async (
    request: {
      tabId: number
      minimumGeneration: number
      allowedOrigins: readonly string[]
    },
    dialog: AgentDialogState
  ): Promise<AgentObservation> => {
    const tab = await getTab(request.tabId)
    const url = tab?.url
    if (!url) throw new Error("Agent dialog tab has no readable address")
    const frame = await browser.webNavigation
      .getFrame({ tabId: request.tabId, frameId: 0 })
      .catch(() => null)
    const known = lastPage.get(request.tabId)
    const documentId =
      (frame as { documentId?: string } | null)?.documentId ?? known?.documentId
    if (!documentId) {
      throw new Error("Agent dialog tab has no identified document")
    }
    const generation = Math.max(
      request.minimumGeneration,
      (known?.generation ?? 0) + 1
    )
    const identity = {
      snapshotId: `dialog-${dialog.id}-${generation}`,
      generation,
      tabId: request.tabId,
      frameId: 0,
      documentId
    }
    const origin = new URL(url).origin
    return {
      ...identity,
      url,
      origin,
      title: (tab as { title?: string }).title?.slice(0, 500) ?? "",
      frames: [
        {
          frameId: 0,
          documentId,
          origin,
          access: "unreadable",
          snapshotId: identity.snapshotId,
          generation
        }
      ],
      elements: [],
      visibleText: "",
      scroll: {
        x: 0,
        y: 0,
        viewportWidth: 0,
        viewportHeight: 0,
        documentWidth: 0,
        documentHeight: 0
      },
      dialogs: [authorizedDialog(dialog, origin, request.allowedOrigins)],
      capturedAt: now()
    }
  }

  return {
    observation: {
      async observe(request, signal) {
        const observation = await observe(
          request.tabId,
          request.minimumGeneration,
          request.allowedOrigins,
          signal
        )
        lastViewport.set(request.tabId, {
          x: observation.scroll.x,
          y: observation.scroll.y,
          width: observation.scroll.viewportWidth,
          height: observation.scroll.viewportHeight
        })
        return observation
      }
    },
    ...(screenshot ? { screenshot } : {}),
    resolver: {
      getTab,
      classifyAccess: classifyAgentTabAccess,
      resolveHistoryDestination,
      hitTest: (identity, point) =>
        input.sessions.hitTest({
          runId: input.runId,
          tabId: identity.tabId,
          frame: identity,
          point
        })
    },
    executor: {
      getTab,
      async getFrame(tabId, frameId) {
        const frame = (await browser.webNavigation.getFrame({
          tabId,
          frameId
        })) as { documentId?: string; url: string } | null
        return frame ? { documentId: frame.documentId, url: frame.url } : null
      },
      classifyAccess: classifyAgentTabAccess,
      async scroll(
        command,
        identity: AgentSnapshotIdentity,
        frame: AgentSnapshotIdentity,
        signal: AgentCancellationSignal
      ) {
        await input.sessions.executeScroll(
          {
            runId: input.runId,
            tabId: identity.tabId,
            instruction: { command, snapshotIdentity: identity, frame }
          },
          abortSignal(signal)
        )
      },
      async mutate(effect, signal) {
        return input.sessions.executeDomMutation(
          {
            runId: input.runId,
            tabId: effect.snapshotIdentity.tabId,
            instruction: mutationInstruction(effect)
          },
          abortSignal(signal)
        )
      },
      ...(input.browserSessions ? nativeAdapter : {}),
      async activateTab(tabId) {
        await browser.tabs.update(tabId, { active: true })
      },
      async goHistory(tabId, direction) {
        if (direction === "back") {
          await browser.tabs.goBack(tabId)
          return
        }
        await browser.tabs.goForward(tabId)
      },
      resolveHistoryDestination,
      wait: waitFor,
      async navigate(tabId, url) {
        await browser.tabs.update(tabId, { url })
      },
      async createTab({ url, openerTabId }) {
        return browser.tabs.create({ url, openerTabId, active: false })
      },
      now
    },
    verifier: {
      observe,
      wait: waitFor,
      waitForNavigation: (tabId, sourceUrl, destinationUrl, signal) =>
        waitForAgentNavigation({
          tabId,
          sourceUrl,
          destinationUrl,
          signal,
          getTab
        }),
      async getActiveTabId() {
        return (await queryActiveTab())?.id
      },
      getTab,
      classifyAccess: classifyAgentTabAccess,
      now
    }
  }
}
