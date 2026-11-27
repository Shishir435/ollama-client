import { Check as CheckIcon, PlugZap } from "lucide-react"
import { useTranslation } from "react-i18next"
import { ListRowButton, ListRowTitle } from "@/components/layout"
import { useChatConnectorSelection } from "../hooks/use-chat-connector-selection"

/**
 * Which MCP connectors this chat may use, next to the other per-chat context
 * switches. Every enabled connector starts on, so a chat behaves as it did
 * before the picker existed; switching one off removes its tools from the
 * model's request for this chat only. Hidden while no connector is enabled.
 */
export const ChatConnectorPicker = ({
  disabled = false
}: {
  disabled?: boolean
}) => {
  const { t } = useTranslation()
  const { connectors, isEnabledForChat, toggle } = useChatConnectorSelection()
  if (connectors.length === 0) return null

  return (
    <section
      className="shrink-0 space-y-0.5 border-t border-border pt-1.5"
      aria-labelledby="chat-connectors-heading">
      <div className="px-2.5 pb-0.5">
        <h3
          id="chat-connectors-heading"
          className="flex items-center gap-2 font-medium text-xs">
          <PlugZap className="icon-sm shrink-0 text-muted-foreground" />
          {t("chat.connector_picker.title")}
        </h3>
        <p className="text-2xs text-muted-foreground">
          {t("chat.connector_picker.description")}
        </p>
      </div>
      <div className="grid gap-0.5">
        {connectors.map((connector) => {
          const checked = isEnabledForChat(connector.id)
          return (
            <ListRowButton
              key={connector.id}
              aria-pressed={checked}
              active={checked}
              disabled={disabled}
              trailing={
                checked ? (
                  <CheckIcon className="icon-sm text-app-primary" />
                ) : undefined
              }
              onClick={() => void toggle(connector.id)}>
              <ListRowTitle className="font-normal">
                {connector.name}
              </ListRowTitle>
            </ListRowButton>
          )
        })}
      </div>
    </section>
  )
}
