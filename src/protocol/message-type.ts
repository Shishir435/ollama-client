export const getMessageType = (value: unknown): string | undefined => {
  if (!value || typeof value !== "object" || !("type" in value)) {
    return undefined
  }

  const type = value.type
  return typeof type === "string" ? type : undefined
}
