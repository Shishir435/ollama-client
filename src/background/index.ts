import "webextension-polyfill"

import { registerMessageRouter } from "@/background/message-router"
import { registerPortRouter } from "@/background/port-router"
import { initializeBackgroundStartup } from "@/background/startup"

initializeBackgroundStartup()
registerPortRouter()
registerMessageRouter()
