const COLOR_MAP = {
  blue: "text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700",
  emerald:
    "text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700",
  purple:
    "text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-700",
  amber:
    "text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700",
  rose: "text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-700",
  indigo:
    "text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-700"
}

export const MetricCard = ({
  title,
  value,
  color
}: {
  title: string
  value: string
  color: keyof typeof COLOR_MAP
}) => {
  const classes = COLOR_MAP[color]
  return (
    <div className={`flex flex-col rounded-lg border p-2 ${classes}`}>
      <span className="font-medium">{title}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  )
}
