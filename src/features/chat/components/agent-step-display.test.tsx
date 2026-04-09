import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AgentStepDisplay } from "./agent-step-display"

describe("AgentStepDisplay", () => {
  it("shows a contextual waiting state for video playback instead of model slow copy", () => {
    render(
      <AgentStepDisplay
        steps={[
          {
            stepNumber: 1,
            timestamp: Date.now(),
            action: { type: "wait_for_video_end" }
          }
        ]}
        status="running"
        elapsedMs={60_000}
        isSlow={false}
        waitContext="video_playback"
      />
    )

    expect(screen.getByText(/Watching video/i)).toBeInTheDocument()
    expect(
      screen.getByText(/waiting for the current video to finish before moving to the next lesson/i)
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/The model hasn't responded/i)
    ).not.toBeInTheDocument()
  })
})
