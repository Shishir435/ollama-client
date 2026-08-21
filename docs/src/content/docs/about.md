---
title: About Ollama Client
description: Learn what Ollama Client is, who maintains it, what local-first means, and how the open-source browser extension is developed and supported.
---

Ollama Client is an open-source browser extension for chatting with local and user-selected language-model providers from a Chrome or Firefox side panel. It supports verified Ollama, LM Studio, and llama.cpp profiles, user-added OpenAI-compatible servers, and Anthropic. Its purpose is to make model chat, page context, files, retrieval, optional web search, and permission-gated browser tools available without requiring a hosted Ollama Client account or a mandatory cloud API.

The project is maintained by [Shishir Chaurasiya](https://www.shishirchaurasiya.in/) and developed publicly in the [Ollama Client GitHub repository](https://github.com/Shishir435/ollama-client). Source code is available under the MIT license. Releases are distributed through browser extension stores, while this site publishes setup, architecture, privacy, troubleshooting, and developer documentation.

## What local-first means here

Chat history, sessions, attachments, and most application state are stored by the extension in the user's browser profile. Model prompts go to the provider endpoint the user configures. A local provider can keep inference traffic on the device; a remote provider receives the data sent to it under that provider's terms. Optional web-search services likewise receive their search requests. “Local-first” describes the default ownership and architecture, not a claim that every possible configuration is offline.

Ollama Client has no hosted inference API at `ollamaclient.in`. The site is documentation. The separate olc developer proxy runs on the user's own machine and exposes a loopback OpenAI-compatible interface for local agent runtimes.

## Project principles

- Keep provider choice and endpoint configuration visible to the user.
- Ask for browser capabilities only when the requested feature needs them.
- Preserve chat data locally and make backup, restore, diagnostics, and deletion understandable.
- Document limitations and compatibility boundaries rather than guessing that an endpoint or model supports a feature.
- Keep development, issues, and architectural decisions inspectable in the public repository.

Questions and security-sensitive reports should use the channels on the [contact page](/contact/). Product setup questions are usually answered fastest by the [quick start](/guides/quick-start/), [provider setup](/guides/provider-setup/), and [FAQ](/about/faq/).
