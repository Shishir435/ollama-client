import { notifyJobComplete } from "@/background/lib/notify"
import { browser, supportsAlarms } from "@/lib/browser-api"
import { STORAGE_KEYS } from "@/lib/constants"
import {
  checkStorageLimit,
  removeDuplicateVectors
} from "@/lib/embeddings/storage"
import { logger } from "@/lib/logger"
import {
  getScheduledJobSettings,
  SCHEDULED_JOB_IDS,
  type ScheduledJobId
} from "@/lib/scheduled-jobs"

type Alarm = { name: string }
type AlarmsApi = {
  create: (
    name: string,
    alarmInfo: { delayInMinutes?: number; periodInMinutes?: number }
  ) => Promise<void>
  clear: (name: string) => Promise<boolean>
  get: (name: string) => Promise<unknown>
  onAlarm?: {
    addListener: (listener: (alarm: Alarm) => void) => void
  }
}

interface ScheduledJobDefinition {
  id: ScheduledJobId
  alarmName: string
  delayInMinutes: number
  periodInMinutes: number
  run: () => Promise<void>
}

const alarmNameForJob = (jobId: ScheduledJobId) =>
  `ollama-client:scheduled-job:${jobId}`

const isScheduledJobId = (value: string): value is ScheduledJobId =>
  SCHEDULED_JOB_IDS.includes(value as ScheduledJobId)

const jobIdFromAlarmName = (alarmName: string): ScheduledJobId | undefined => {
  const prefix = "ollama-client:scheduled-job:"
  if (!alarmName.startsWith(prefix)) return undefined
  const id = alarmName.slice(prefix.length)
  return isScheduledJobId(id) ? id : undefined
}

const runVectorMaintenance = async () => {
  await checkStorageLimit()
  const { deleted } = await removeDuplicateVectors()

  logger.info("Scheduled vector maintenance finished", "ScheduledJobs", {
    duplicateVectorsDeleted: deleted
  })

  if (deleted > 0) {
    void notifyJobComplete({
      id: "vector-maintenance",
      title: "Knowledge maintenance done",
      message: `Removed ${deleted} duplicate local knowledge chunks.`
    })
  }
}

const JOBS: Record<ScheduledJobId, ScheduledJobDefinition> = {
  "vector-maintenance": {
    id: "vector-maintenance",
    alarmName: alarmNameForJob("vector-maintenance"),
    delayInMinutes: 5,
    periodInMinutes: 24 * 60,
    run: runVectorMaintenance
  }
}

const getAlarmsApi = (): AlarmsApi | undefined =>
  (browser as unknown as { alarms?: AlarmsApi }).alarms

export const syncScheduledJobAlarms = async (): Promise<void> => {
  if (!supportsAlarms()) return
  const alarms = getAlarmsApi()
  if (!alarms) return

  const settings = await getScheduledJobSettings()

  for (const job of Object.values(JOBS)) {
    try {
      if (settings.enabled[job.id]) {
        const existingAlarm = await alarms.get(job.alarmName)
        if (!existingAlarm) {
          await alarms.create(job.alarmName, {
            delayInMinutes: job.delayInMinutes,
            periodInMinutes: job.periodInMinutes
          })
        }
      } else {
        await alarms.clear(job.alarmName)
      }
    } catch (error) {
      logger.warn("Scheduled job alarm sync failed", "ScheduledJobs", {
        jobId: job.id,
        error
      })
    }
  }
}

export const runScheduledJob = async (jobId: ScheduledJobId): Promise<void> => {
  const settings = await getScheduledJobSettings()
  if (!settings.enabled[jobId]) return

  const job = JOBS[jobId]
  try {
    await job.run()
  } catch (error) {
    logger.warn("Scheduled job failed", "ScheduledJobs", {
      jobId,
      error
    })
  }
}

// Guards a double-add when registration runs both at startup and again on a
// runtime `alarms` permission grant within the same service-worker session.
let scheduledJobsRegistered = false

export const registerScheduledJobs = (): void => {
  if (scheduledJobsRegistered) return
  if (!supportsAlarms()) return
  const alarms = getAlarmsApi()
  if (!alarms?.onAlarm) return

  scheduledJobsRegistered = true
  alarms.onAlarm.addListener((alarm) => {
    const jobId = jobIdFromAlarmName(alarm.name)
    if (!jobId) return
    void runScheduledJob(jobId)
  })

  if (browser.storage?.onChanged) {
    browser.storage.onChanged.addListener((changes) => {
      if (STORAGE_KEYS.BACKGROUND.SCHEDULED_JOBS in changes) {
        void syncScheduledJobAlarms()
      }
    })
  }

  void syncScheduledJobAlarms()
}
