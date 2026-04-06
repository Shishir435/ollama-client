import { createRoot } from "react-dom/client"

import OptionsIndex from "@/options/index"

const app = document.getElementById("app")

if (!app) {
  throw new Error("Unable to find #app for options page")
}

createRoot(app).render(<OptionsIndex />)
