---
title: Understand error reports
description: Read Ollama Client error codes, incident IDs, failure phases, and privacy-safe diagnostic details.
---

Ollama Client error reports are designed to give users a direct recovery step
and give maintainers enough technical context to reproduce a bug without
collecting telemetry.

## Error code versus incident ID

An **error code** identifies the failure category. For example,
`OLC-PROVIDER-DISABLED` always means the selected provider is disabled.
Maintainers can use the code to find the relevant recovery path and code branch.

An **incident ID**, such as `INC-1F9F2263`, is a short random correlation token
created locally for one error. It is not an encoded error message, account ID,
server log ID, or tracking identifier. There is no remote database where an
incident ID can be looked up.

The incident ID is useful when a local diagnostic event was recorded with the
same support code. It lets a maintainer match the failed chat message and issue
draft to the corresponding event in a support bundle, and distinguish two
otherwise identical failures. Local diagnostic events expire after seven days.

## How to triage a report

Read these fields in order:

1. **Error code** identifies the stable failure category.
2. **Suggested recovery** shows the action offered to the user.
3. **Provider, model, base URL, status, and failure phase** locate the failing
   request stage. Credentials, query parameters, and URL fragments are removed.
4. **Automatic checks** show whether the provider was enabled, reachable, and
   advertising the selected model when **Open an issue** was clicked.
5. **Incident ID** can be matched to the `supportCode` in an attached support
   bundle.
6. **Extension, browser/version, and OS family** help isolate release-specific
   and browser-specific behavior.

The support bundle is available under **Help → Diagnostics & support**. Users
can preview it before copying or downloading it. Nothing is uploaded
automatically.

## Error-code reference

| Code | Meaning | First check |
| --- | --- | --- |
| `OLC-PROVIDER-DISABLED` | Selected provider is disabled | Enable it in Model behavior |
| `OLC-PROVIDER-UNREACHABLE` | Endpoint could not be reached | Provider process and base URL |
| `OLC-PROVIDER-HTTP` | Provider returned an unclassified HTTP error | Status and provider logs |
| `OLC-MODEL-NOT-FOUND` | Requested model does not exist | Selected model name |
| `OLC-RESOURCE-NOT-FOUND` | Provider endpoint or resource is missing | Base URL and API path |
| `OLC-MODEL-NOT-LOADED` | Model exists but is not loaded | Load the model in the provider |
| `OLC-CORS-BLOCKED` | Browser origin was rejected | Provider CORS/origin settings |
| `OLC-AUTH-FAILED` | Remote provider rejected credentials | API key and endpoint |
| `OLC-PAYMENT-REQUIRED` | Hosted provider requires credits | Provider account balance |
| `OLC-CONTEXT-TOO-LARGE` | Input exceeds the context window | Reduce chat/context size |
| `OLC-INPUT-UNSUPPORTED` | Model cannot handle the input type | Model capabilities |
| `OLC-OUT-OF-MEMORY` | Provider could not allocate enough memory | Smaller model or more memory |
| `OLC-MODEL-LOADING` | Model is still loading | Wait, then retry |
| `OLC-RATE-LIMITED` | Provider is throttling requests | Retry timing |
| `OLC-PROVIDER-OVERLOADED` | Provider is temporarily overloaded | Wait, then retry |
| `OLC-PROVIDER-TIMEOUT` | Request exceeded its time limit | Provider health and model speed |
| `OLC-STREAM-DROPPED` | Connection ended during response streaming | Provider logs and network |
| `OLC-UNKNOWN` | Failure did not match a safe known category | Phase, status, and reproduction |

## Privacy boundaries

Issue drafts are generated locally and opened for review. They do not include
prompts, responses, page or file content, file names, API keys, credentials,
raw provider response bodies, or console logs. Browser detection is best effort
because Chromium-based browsers may deliberately identify as Chrome; users
should edit the browser field if it is wrong.
