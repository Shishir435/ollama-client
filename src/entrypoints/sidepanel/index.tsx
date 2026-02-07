import { createRoot } from "react-dom/client"

import IndexSidePanel from "@/sidepanel/index"

const app = document.getElementById("app")

if (!app) {
  throw new Error("Unable to find #app for sidepanel")
}

createRoot(app).render(<IndexSidePanel />)
