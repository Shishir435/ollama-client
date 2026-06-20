import { STORAGE_KEYS } from "@/lib/constants"
import {
  getPlasmoStoredValue,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"

export const SCHEDULED_JOB_IDS = ["vector-maintenance"] as const

export type ScheduledJobId = (typeof SCHEDULED_JOB_IDS)[number]

export interface ScheduledJobSettings {
  enabled: Record<ScheduledJobId, boolean>
}

export const DEFAULT_SCHEDULED_JOB_SETTINGS: ScheduledJobSettings = {
  enabled: {
    "vector-maintenance": false
  }
}

export const getScheduledJobSettings =
  async (): Promise<ScheduledJobSettings> => {
    const stored = await getPlasmoStoredValue<Partial<ScheduledJobSettings>>(
      STORAGE_KEYS.BACKGROUND.SCHEDULED_JOBS
    )

    return {
      enabled: {
        ...DEFAULT_SCHEDULED_JOB_SETTINGS.enabled,
        ...(stored?.enabled ?? {})
      }
    }
  }

export const setScheduledJobEnabled = async (
  jobId: ScheduledJobId,
  enabled: boolean
): Promise<ScheduledJobSettings> => {
  const settings = await getScheduledJobSettings()
  const next: ScheduledJobSettings = {
    enabled: {
      ...settings.enabled,
      [jobId]: enabled
    }
  }

  await setPlasmoStoredValue(STORAGE_KEYS.BACKGROUND.SCHEDULED_JOBS, next)
  return next
}
