import { createRoot } from "react-dom/client"

import { i18nReady } from "@/i18n/config"
import OptionsIndex from "@/options/index"

const app = document.getElementById("app")

if (!app) {
  throw new Error("Unable to find #app for options page")
}

const render = async () => {
  await i18nReady
  createRoot(app).render(<OptionsIndex />)
}

void render()
