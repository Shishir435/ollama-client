import { createOwnerHost } from "@/spike/opfs/owner-host-core"

// Section 9.4 spike phase 2: the Chromium offscreen owner document. Hosts
// the one SQLite worker via the shared owner-host core; the background
// service worker creates/closes this document (see background-owner-host.ts).

createOwnerHost().registerRpcListener()
