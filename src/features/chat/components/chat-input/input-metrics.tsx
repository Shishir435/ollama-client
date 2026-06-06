import { CharCount } from "@/features/chat/components/char-count"

export interface InputMetricsProps {
  inputLength: number
}

export const InputMetrics = ({ inputLength }: InputMetricsProps) => {
  return (
    <div className="flex min-w-5 items-center justify-end">
      <CharCount count={inputLength} />
    </div>
  )
}
