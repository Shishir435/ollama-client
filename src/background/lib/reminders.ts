import { notifyJobComplete } from "@/background/lib/notify"
import { browser, supportsAlarms } from "@/lib/browser-api"
import { STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { hasPermission } from "@/lib/permissions"
import {
  getPlasmoStoredValue,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"

const REMINDER_ALARM_PREFIX = "ollama-client:reminder:"

type Alarm = { name: string }
type AlarmsApi = {
  create: (name: string, alarmInfo: { when: number }) => Promise<void>
  clear: (name: string) => Promise<boolean>
  onAlarm?: {
    addListener: (listener: (alarm: Alarm) => void) => void
  }
}

export interface Reminder {
  id: string
  message: string
  dueAt: number
  createdAt: number
}

interface ReminderStore {
  reminders: Reminder[]
}

let reminderStoreLock: Promise<void> = Promise.resolve()

const getAlarmsApi = (): AlarmsApi | undefined =>
  (browser as unknown as { alarms?: AlarmsApi }).alarms

const createReminderId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const getReminderStore = async (): Promise<ReminderStore> => {
  const stored = await getPlasmoStoredValue<Partial<ReminderStore>>(
    STORAGE_KEYS.BACKGROUND.REMINDERS
  )
  return { reminders: stored?.reminders ?? [] }
}

const setReminderStore = async (store: ReminderStore): Promise<void> => {
  await setPlasmoStoredValue(STORAGE_KEYS.BACKGROUND.REMINDERS, store)
}

const withReminderStoreLock = async <T>(
  operation: () => Promise<T>
): Promise<T> => {
  const run = reminderStoreLock.then(operation, operation)
  reminderStoreLock = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

export const alarmNameForReminder = (id: string): string =>
  `${REMINDER_ALARM_PREFIX}${id}`

const reminderIdFromAlarmName = (name: string): string | undefined =>
  name.startsWith(REMINDER_ALARM_PREFIX)
    ? name.slice(REMINDER_ALARM_PREFIX.length)
    : undefined

export const scheduleReminder = async ({
  message,
  delayMinutes
}: {
  message: string
  delayMinutes: number
}): Promise<Reminder> => {
  const trimmedMessage = message.trim()
  if (!trimmedMessage) {
    throw new Error("Reminder message is required.")
  }

  if (!Number.isFinite(delayMinutes) || delayMinutes <= 0) {
    throw new Error("Reminder delay must be greater than 0 minutes.")
  }

  // When ungranted the alarms namespace can be absent, so check permission first
  // to give a clear error instead of the generic unsupported-browser one below.
  if (!(await hasPermission("alarms"))) {
    throw new Error(
      "Alarms permission is required to schedule reminders. Enable it in Settings → Permissions."
    )
  }

  if (!supportsAlarms()) {
    throw new Error("Scheduled reminders are not supported in this browser.")
  }

  const alarms = getAlarmsApi()
  if (!alarms) {
    throw new Error("Browser alarms API is unavailable.")
  }

  if (!(await hasPermission("notifications"))) {
    throw new Error(
      "Notifications permission is required before scheduling reminders."
    )
  }

  const now = Date.now()
  const reminder: Reminder = {
    id: createReminderId(),
    message: trimmedMessage,
    dueAt: now + Math.ceil(delayMinutes * 60 * 1000),
    createdAt: now
  }

  await withReminderStoreLock(async () => {
    const store = await getReminderStore()
    await setReminderStore({
      reminders: [...store.reminders, reminder]
    })
  })

  try {
    await alarms.create(alarmNameForReminder(reminder.id), {
      when: reminder.dueAt
    })
  } catch (error) {
    await withReminderStoreLock(async () => {
      const store = await getReminderStore()
      await setReminderStore({
        reminders: store.reminders.filter((item) => item.id !== reminder.id)
      })
    }).catch((rollbackError) => {
      logger.warn(
        "Failed to roll back reminder after alarm creation failure",
        "Reminders",
        {
          reminderId: reminder.id,
          rollbackError
        }
      )
    })
    throw error
  }

  return reminder
}

export const fireReminder = async (id: string): Promise<void> => {
  const reminder = await withReminderStoreLock(async () => {
    const store = await getReminderStore()
    const reminder = store.reminders.find((item) => item.id === id)
    if (!reminder) return undefined

    await setReminderStore({
      reminders: store.reminders.filter((item) => item.id !== id)
    })

    return reminder
  })
  if (!reminder) return

  void notifyJobComplete({
    id: `reminder-${reminder.id}`,
    title: "Reminder",
    message: reminder.message
  })
}

// Guards a double-add when registration runs both at startup and again on a
// runtime `alarms` permission grant within the same service-worker session.
let reminderAlarmsRegistered = false

export const registerReminderAlarms = (): void => {
  if (reminderAlarmsRegistered) return
  if (!supportsAlarms()) return
  const alarms = getAlarmsApi()
  if (!alarms?.onAlarm) return

  reminderAlarmsRegistered = true
  alarms.onAlarm.addListener((alarm) => {
    const id = reminderIdFromAlarmName(alarm.name)
    if (!id) return
    void fireReminder(id).catch((error) => {
      logger.warn("Reminder failed", "Reminders", { error })
    })
  })
}
