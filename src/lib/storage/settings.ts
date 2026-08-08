import { z } from "zod"
import { STORAGE_KEYS } from "@/lib/constants"
import type { CapabilityProbeMap } from "@/lib/providers/capability-probe"
import type { ModelCapabilityOverrideMap } from "@/lib/providers/model-capability-overrides"
import type { ApprovalGrantMap } from "@/lib/tools/approval/approval-grants"
import {
  DEFAULT_WEB_SEARCH_CONFIG,
  type WebSearchProviderConfig,
  WebSearchProviderConfigSchema
} from "@/lib/tools/web-search"
import { defineSetting } from "./setting-descriptor"

export const SETTINGS = {
  TTS_RATE: defineSetting<number>(STORAGE_KEYS.TTS.RATE, { defaultValue: 1 }),
  TTS_PITCH: defineSetting<number>(STORAGE_KEYS.TTS.PITCH, {
    defaultValue: 1
  }),
  TTS_VOICE_URI: defineSetting<string>(STORAGE_KEYS.TTS.VOICE_URI, {
    defaultValue: ""
  }),
  MODEL_CAPABILITY_OVERRIDES: defineSetting<ModelCapabilityOverrideMap>(
    STORAGE_KEYS.PROVIDER.MODEL_CAPABILITY_OVERRIDES,
    { defaultValue: {} }
  ),
  MODEL_CAPABILITY_PROBES: defineSetting<CapabilityProbeMap>(
    STORAGE_KEYS.PROVIDER.MODEL_CAPABILITY_PROBES,
    { defaultValue: {} }
  ),
  APPROVAL_GRANTS: defineSetting<ApprovalGrantMap>(
    STORAGE_KEYS.TOOLS.APPROVAL_GRANTS,
    { defaultValue: {} }
  ),
  WEB_SEARCH_ACTIVE: defineSetting<boolean>(STORAGE_KEYS.WEB_SEARCH.ACTIVE, {
    defaultValue: true,
    parser: z.boolean()
  }),
  WEB_SEARCH_CONFIG: defineSetting<WebSearchProviderConfig>(
    STORAGE_KEYS.WEB_SEARCH.CONFIG,
    {
      defaultValue: DEFAULT_WEB_SEARCH_CONFIG,
      parser: WebSearchProviderConfigSchema
    }
  )
}
