import { createRoot } from "react-dom/client"

import { i18nReady } from "@/i18n/config"
import IndexSidePanel from "@/sidepanel/index"

const app = document.getElementById("app")

if (!app) {
  throw new Error("Unable to find #app for sidepanel")
}

const render = async () => {
  await i18nReady
  createRoot(app).render(<IndexSidePanel />)
}

void render()
