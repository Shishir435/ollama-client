export {}
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.log(error))

console.log("hello ji ")
const baseUrl = "http://localhost:11434"
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "get-ollama-models") {
    fetch("http://localhost:11434/api/tags")
      .then((res) => res.json())
      .then((data) => {
        console.log(data)
        sendResponse({ success: true, data })
      })
      .catch((err) => sendResponse({ success: false, error: err.message }))
    return true // keep the message channel open for async response
  }
})
