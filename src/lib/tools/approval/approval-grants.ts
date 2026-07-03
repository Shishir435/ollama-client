import { STORAGE_KEYS } from "@/lib/constants"
import {
  getPlasmoStoredValue,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"
import { approvalGrantKey } from "./approval-policy"

/**
 * Persisted "Always allow" grants, keyed `${toolName}::${origin}` ("*" when the
 * tool has no origin). Device-local — an approval to act on this machine
 * shouldn't sync to other devices. Viewed and revoked in Settings → Privacy →
 * Approvals.
 */

export interface ApprovalGrant {
  toolName: string
  origin: string
  grantedAt: number
}

export type ApprovalGrantMap = Record<string, ApprovalGrant>

const STORAGE_KEY = STORAGE_KEYS.TOOLS.APPROVAL_GRANTS

export const getAllApprovalGrants = async (): Promise<ApprovalGrantMap> => {
  const stored = await getPlasmoStoredValue<ApprovalGrantMap>(STORAGE_KEY)
  return stored ?? {}
}

export const hasAlwaysGrant = async (
  toolName: string,
  origin?: string
): Promise<boolean> => {
  const all = await getAllApprovalGrants()
  return approvalGrantKey(toolName, origin) in all
}

export const addAlwaysGrant = async (
  toolName: string,
  origin?: string
): Promise<void> => {
  const all = await getAllApprovalGrants()
  const key = approvalGrantKey(toolName, origin)
  all[key] = {
    toolName,
    origin: origin || "*",
    grantedAt: Date.now()
  }
  await setPlasmoStoredValue(STORAGE_KEY, all)
}

export const revokeApprovalGrant = async (key: string): Promise<void> => {
  const all = await getAllApprovalGrants()
  if (key in all) {
    delete all[key]
    await setPlasmoStoredValue(STORAGE_KEY, all)
  }
}

export const clearAllApprovalGrants = async (): Promise<void> => {
  await setPlasmoStoredValue(STORAGE_KEY, {})
}
