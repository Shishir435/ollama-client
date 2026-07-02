import {
  cancelReminder,
  listReminders,
  scheduleReminder
} from "@/background/lib/reminders"
import type { ToolContext, ToolDefinition, ToolResult } from "../types"

export const scheduleReminderDefinition: ToolDefinition = {
  name: "schedule_reminder",
  description:
    "Schedule a one-off local reminder notification. Use only when the user explicitly asks to be reminded or notified later, such as 'remind me in 2 minutes to stretch'. Requires a concise reminder message and delay in minutes.",
  displayNameKey: "chat.reasoning.trace.schedule_reminder",
  category: "system",
  iconKey: "bell",
  risk: "medium",
  cacheable: false,
  requires: ["storage"],
  runtime: { parallelizable: false, timeoutMs: 10_000 },
  parameters: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description:
          "Short reminder text to show when the reminder fires. Example: 'Stretch'."
      },
      delay_minutes: {
        type: "number",
        description:
          "How many minutes from now to fire the reminder. Example: 2."
      }
    },
    required: ["message", "delay_minutes"]
  }
}

export const runScheduleReminder = async (
  args: Record<string, unknown>,
  _ctx: ToolContext
): Promise<ToolResult> => {
  const message = typeof args.message === "string" ? args.message.trim() : ""
  const delayMinutes =
    typeof args.delay_minutes === "number"
      ? args.delay_minutes
      : Number(args.delay_minutes)

  if (!message) {
    return {
      content: "schedule_reminder requires a non-empty message.",
      isError: true
    }
  }

  if (!Number.isFinite(delayMinutes) || delayMinutes <= 0) {
    return {
      content: "schedule_reminder requires delay_minutes greater than 0.",
      isError: true
    }
  }

  try {
    const reminder = await scheduleReminder({ message, delayMinutes })
    return {
      content: `Reminder scheduled for ${new Date(reminder.dueAt).toLocaleString()}: ${reminder.message}`
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      content: `Could not schedule reminder: ${reason}`,
      isError: true
    }
  }
}

export const listRemindersDefinition: ToolDefinition = {
  name: "list_reminders",
  description:
    "List the user's pending scheduled reminders. Each entry includes an [id: ...]; pass that id to cancel_reminder to cancel it. Use when the user asks what reminders they have set or wants to cancel one.",
  displayNameKey: "chat.reasoning.trace.list_reminders",
  category: "system",
  iconKey: "bell",
  risk: "low",
  cacheable: false,
  requires: ["storage"],
  runtime: { timeoutMs: 5_000, maxResultChars: 4000 },
  parameters: { type: "object", properties: {} }
}

export const runListReminders = async (
  _args: Record<string, unknown>,
  _ctx: ToolContext
): Promise<ToolResult> => {
  const reminders = await listReminders()
  if (reminders.length === 0) {
    return { content: "No pending reminders." }
  }
  return {
    content: `Pending reminders:\n${reminders
      .map(
        (reminder, index) =>
          `${index + 1}. "${reminder.message}" — due ${new Date(
            reminder.dueAt
          ).toLocaleString()} [id: ${reminder.id}]`
      )
      .join("\n")}`
  }
}

export const cancelReminderDefinition: ToolDefinition = {
  name: "cancel_reminder",
  description:
    "Cancel a pending reminder. Pass the [id: ...] from list_reminders. This permanently removes the reminder, so it requires the user's confirmation before running.",
  displayNameKey: "chat.reasoning.trace.cancel_reminder",
  category: "system",
  iconKey: "bell",
  // Destructive: removes a scheduled reminder. Gate behind explicit approval.
  risk: "high",
  requiresConfirmation: true,
  cacheable: false,
  requires: ["storage"],
  runtime: { parallelizable: false, timeoutMs: 5_000 },
  parameters: {
    type: "object",
    properties: {
      reminderId: {
        type: "string",
        description: "The [id: ...] of the reminder to cancel."
      }
    },
    required: ["reminderId"]
  }
}

export const runCancelReminder = async (
  args: Record<string, unknown>,
  _ctx: ToolContext
): Promise<ToolResult> => {
  const reminderId =
    typeof args.reminderId === "string" ? args.reminderId.trim() : ""
  if (!reminderId) {
    return { content: "cancel_reminder requires a reminderId.", isError: true }
  }

  try {
    const cancelled = await cancelReminder(reminderId)
    return cancelled
      ? { content: `Cancelled reminder ${reminderId}.` }
      : {
          content: `No pending reminder with id ${reminderId}.`,
          isError: true
        }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { content: `Could not cancel reminder: ${reason}`, isError: true }
  }
}
