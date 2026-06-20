import { scheduleReminder } from "@/background/lib/reminders"
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
