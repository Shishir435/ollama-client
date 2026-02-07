# Security Policy

## Supported Versions

Security fixes are prioritized for the latest released version and the current default branch.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| `main` (unreleased) | Best effort |
| Older releases | No |

## Reporting a Vulnerability

Do not disclose vulnerabilities in public issues.

Report privately via email:

- `shishirchaurasiya435@gmail.com`

Include:

1. A clear description of the issue.
2. Steps to reproduce.
3. Impact assessment (what could happen).
4. A proof of concept, logs, or screenshots if available.
5. Suggested remediation if you have one.

## Response Process

1. Acknowledgement target: within 72 hours.
2. Initial triage and severity assessment.
3. Reproduction and fix planning.
4. Coordinated release and disclosure notes.

Timing depends on severity, exploitability, and maintainer availability.

## Scope Notes

In scope:

- Extension code in this repository
- Bundled docs/site artifacts in this repository

Out of scope:

- Vulnerabilities in third-party provider runtimes (for example Ollama, LM Studio, llama.cpp)
- User misconfiguration of exposed local/LAN endpoints

## Safe Testing Guidelines

- Test only on environments you own or are explicitly authorized to test.
- Do not access other users' data.
- Do not run denial-of-service style tests on shared infrastructure.

## Security Expectations for Contributors

- Do not commit secrets, tokens, or private keys.
- Keep endpoint behavior explicit and user-controlled.
- Prefer minimal permissions and least-privilege changes.
- Mention security implications in PR descriptions when relevant.
