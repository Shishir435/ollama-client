import { POLICY_SETTINGS } from "@/lib/storage/policy-settings"
import { readSetting, writeSetting } from "@/lib/storage/setting-access"
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

export const getAllApprovalGrants = async (): Promise<ApprovalGrantMap> => {
  return { ...(await readSetting(POLICY_SETTINGS.APPROVAL_GRANTS)) }
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
  await writeSetting(POLICY_SETTINGS.APPROVAL_GRANTS, all)
}

export const revokeApprovalGrant = async (key: string): Promise<void> => {
  const all = await getAllApprovalGrants()
  if (key in all) {
    delete all[key]
    await writeSetting(POLICY_SETTINGS.APPROVAL_GRANTS, all)
  }
}

export const clearAllApprovalGrants = async (): Promise<void> => {
  await writeSetting(POLICY_SETTINGS.APPROVAL_GRANTS, {})
}
