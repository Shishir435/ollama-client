import { notifyJobComplete } from "@/background/lib/notify"
import { browser, supportsAlarms } from "@/lib/browser-api"
import { logger } from "@/lib/logger"
import { reminderIdFromAlarmName, takeReminder } from "@/lib/reminders"

type Alarm = { name: string }
type AlarmsApi = {
  onAlarm?: {
    addListener: (listener: (alarm: Alarm) => void) => void
  }
}

const getAlarmsApi = (): AlarmsApi | undefined =>
  (browser as unknown as { alarms?: AlarmsApi }).alarms

export {
  alarmNameForReminder,
  cancelReminder,
  listReminders,
  scheduleReminder
} from "@/lib/reminders"

export const fireReminder = async (id: string): Promise<void> => {
  const reminder = await takeReminder(id)
  if (!reminder) return

  void notifyJobComplete({
    id: `reminder-${reminder.id}`,
    title: "Reminder",
    message: reminder.message
  })
}

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
