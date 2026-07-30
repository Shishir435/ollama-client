import { registerIngestionProcessorHost } from "@/lib/ingestion/ingestion-processor-host"

if (new URLSearchParams(location.search).get("host") === "1") {
  registerIngestionProcessorHost()
} else {
  document.body.textContent =
    "This is an internal page of the extension; it has no user-facing content."
}
