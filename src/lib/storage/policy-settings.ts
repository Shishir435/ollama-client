import { STORAGE_KEYS } from "@/lib/constants"
import type { CapabilityProbeMap } from "@/lib/providers/capability-probe"
import type { ModelCapabilityOverrideMap } from "@/lib/providers/model-capability-overrides"
import type { ApprovalGrantMap } from "@/lib/tools/approval/approval-grants"
import type { ToolModelOverrideMap } from "@/lib/tools/tool-model-overrides"
import {
  ApprovalGrantMapSchema,
  CapabilityProbeMapSchema,
  ModelCapabilityOverrideMapSchema,
  ToolModelOverrideMapSchema
} from "./policy-setting-schemas"
import { defineSetting } from "./setting-descriptor"

export const POLICY_SETTINGS = {
  MODEL_CAPABILITY_OVERRIDES: defineSetting<ModelCapabilityOverrideMap>(
    STORAGE_KEYS.PROVIDER.MODEL_CAPABILITY_OVERRIDES,
    { defaultValue: {}, parser: ModelCapabilityOverrideMapSchema }
  ),
  MODEL_CAPABILITY_PROBES: defineSetting<CapabilityProbeMap>(
    STORAGE_KEYS.PROVIDER.MODEL_CAPABILITY_PROBES,
    { defaultValue: {}, parser: CapabilityProbeMapSchema }
  ),
  APPROVAL_GRANTS: defineSetting<ApprovalGrantMap>(
    STORAGE_KEYS.TOOLS.APPROVAL_GRANTS,
    { defaultValue: {}, parser: ApprovalGrantMapSchema }
  ),
  TOOL_MODEL_OVERRIDES: defineSetting<ToolModelOverrideMap>(
    STORAGE_KEYS.TOOLS.MODEL_OVERRIDES,
    { defaultValue: {}, parser: ToolModelOverrideMapSchema }
  )
}
