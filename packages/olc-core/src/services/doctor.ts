import type { RuntimeContext } from "../runtime"
import type { HealthStatus } from "../types"

export const getHealthReport = async (
  runtime: RuntimeContext
): Promise<{
  configPath: string
  providers: HealthStatus[]
}> => {
  const config = await runtime.getConfig()
  const checks = await Promise.all(
    config.providers.map(async (providerConfig): Promise<HealthStatus> => {
      if (!providerConfig.enabled) {
        return {
          id: providerConfig.id,
          name: providerConfig.name,
          enabled: false,
          reachable: false
        }
      }

      const provider = await runtime.getProviderById(providerConfig.id)
      const start = Date.now()
      try {
        await provider.checkHealth()
        return {
          id: providerConfig.id,
          name: providerConfig.name,
          enabled: true,
          reachable: true,
          latencyMs: Date.now() - start
        }
      } catch (error) {
        return {
          id: providerConfig.id,
          name: providerConfig.name,
          enabled: true,
          reachable: false,
          latencyMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    })
  )

  return {
    configPath: runtime.getConfigPath(),
    providers: checks
  }
}
