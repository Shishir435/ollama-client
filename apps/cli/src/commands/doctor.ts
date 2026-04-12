import { getHealthReport, RuntimeContext } from "@olc/core"

export const runDoctorCommand = async () => {
  const runtime = new RuntimeContext()
  const report = await getHealthReport(runtime)
  process.stdout.write(`Config: ${report.configPath}\n`)
  for (const provider of report.providers) {
    process.stdout.write(
      [
        provider.id,
        `enabled=${provider.enabled}`,
        `reachable=${provider.reachable}`,
        provider.latencyMs ? `latencyMs=${provider.latencyMs}` : "",
        provider.error ? `error=${provider.error}` : ""
      ]
        .filter(Boolean)
        .join("\t") + "\n"
    )
  }
}
