import { TurnService } from "@/application/turns/turn-service"
import { createTurnRun, updateTurnRun } from "@/lib/repositories/turn-runs"

/** Production composition root for durable turn ownership. */
export const turnService = new TurnService({
  create: createTurnRun,
  update: updateTurnRun
})
