# Agent Behavior Instructions

This file contains instructions for the Codex Agent when working in this repository.

## Error Handling
- If a shell command fails, do NOT attempt to hide the error.
- Immediately analyze the error message and report it to the user.
- If an error is detected, propose a fix or a debugging step instead of blindly retrying the same command.

## Communication & Feedback
- **No Silent Failures**: Always provide a brief update after executing a command.
- **Avoid Long-Running Single Commands**: Break down complex sequences (e.g., install && build && test) into individual, manageable steps to prevent terminal timeouts.
- **Progress Updates**: Use concise, frequent updates to let the user know the current state (e.g., "Writing test file...", "Running build...", "Executing test...").

## Execution Strategy
- Prefer atomic operations.
- If a command is likely to take more than 10 seconds, inform the user before starting.
- Always verify the existence and integrity of files before performing operations on them.
