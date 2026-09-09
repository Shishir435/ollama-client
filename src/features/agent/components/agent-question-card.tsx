import { MAX_AGENT_ANSWER_CHARS } from "@ollama-client/contracts"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { AGENT_PAGE_TEXT_LIMIT, agentPlainText } from "../lib/presentation"

/**
 * The run's open question and the field that answers it.
 *
 * `ask_user` used to pause with reason `user`, which is what a user pausing
 * the run looks like: the question went nowhere and there was nothing to
 * answer it with. The text is model-authored and may quote the page, so it is
 * rendered escaped, capped, and outside the control region.
 */
export const AgentQuestionCard = ({
  question,
  onAnswer
}: {
  question: string
  onAnswer: (text: string) => void
}) => {
  const { t } = useTranslation()
  const [answer, setAnswer] = useState("")
  const trimmed = answer.trim()

  return (
    <section className="mb-3 rounded-panel border border-app-primary/40 bg-app-primary-soft/40 p-2.5 text-xs">
      <h2 className="font-medium">{t("agent.question.title")}</h2>
      <p className="mt-1 break-words">
        {agentPlainText(question, AGENT_PAGE_TEXT_LIMIT)}
      </p>
      <form
        className="mt-2 flex flex-col gap-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          if (!trimmed) return
          setAnswer("")
          onAnswer(trimmed)
        }}>
        <Textarea
          aria-label={t("agent.question.inputLabel")}
          className="min-h-16 text-xs"
          maxLength={MAX_AGENT_ANSWER_CHARS}
          onChange={(event) => setAnswer(event.target.value)}
          placeholder={t("agent.question.placeholder")}
          value={answer}
        />
        <Button className="self-start" disabled={!trimmed} type="submit">
          {t("agent.question.send")}
        </Button>
      </form>
    </section>
  )
}
