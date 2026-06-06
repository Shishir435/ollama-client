export const safeSendResponse = (
  sendResponse: (response: unknown) => void,
  response: unknown
): void => {
  try {
    sendResponse(response)
  } catch {
    // Channel closed - ignore
  }
}
