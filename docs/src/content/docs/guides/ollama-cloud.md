---
title: Use Ollama Cloud models
description: Sign in to Ollama, discover hosted models automatically, and use :cloud models without downloading them.
---

Ollama Cloud models run on Ollama's hosted infrastructure while you keep using the local Ollama API at `http://localhost:11434`. You do not need a separate provider, base URL, or API key in Ollama Client.

:::caution[Cloud is not local]
Prompts, chat context, attached images, page content, tool results, and any other input sent to a `:cloud` model leave your device and are processed by Ollama's cloud service. Use a local model when the conversation must remain on your hardware.
:::

## Set up Ollama Cloud

1. Install or update [Ollama](https://ollama.com/download).
2. Sign in through the Ollama app, or run:

   ```bash
   ollama signin
   ```

3. Confirm that a cloud model works through Ollama itself:

   ```bash
   ollama run minimax-m3:cloud
   ```

4. Open the Ollama Client model menu, enable **Ollama cloud models**, and refresh.
5. Select a model carrying the **Cloud** badge and start chatting.

The model is served through your normal Ollama provider. Nothing large is downloaded to your computer.

## Automatic discovery

Enable **Ollama cloud models** in the model menu to combine the public catalog at `https://ollama.com/api/tags`, hosted recommendations from the local daemon, and your installed models. The public catalog includes models missing from recommendations, including models offered to free accounts. Model names are routed through your configured Ollama daemon: untagged names use `:cloud` (for example, `beam:cloud`), while names with a size or version tag use `-cloud` (for example, `gpt-oss:20b-cloud`). Equivalent cloud aliases are merged into one row, preserving an installed model’s name.

Discovery contacts ollama.com only while this switch is enabled. It sends no prompts, API keys or account cookies. The catalog is not an account entitlement list: availability, quotas and refill times remain controlled by Ollama. We do not label a model free unless Ollama reports that plan.

The Cloud badge shows the required plan when Ollama reports one, such as **Cloud · Free** or **Cloud · Pro**. If the plan is not reported, it shows **Cloud**, with an explanatory tooltip. Hover it to see Ollama's model description. The response is cached briefly to avoid repeatedly polling the experimental endpoint.

Older Ollama versions may not provide cloud recommendations. That does not break local discovery: the public cloud catalog can still supply cloud models. If both supplemental sources fail, Ollama Client keeps the ordinary local model list.

## If a cloud model does not appear

First update Ollama and make sure you are signed in. Then verify the model in a terminal:

```bash
ollama run minimax-m3:cloud
```

If the model works there but is still absent from Ollama Client:

1. Open **Settings → Providers → Ollama**.
2. Add the exact model name, such as `minimax-m3:cloud`, under **Model IDs**.
3. Refresh the model menu and select it.

This manual entry is only a compatibility fallback. It does not download or delete a model.

## Web search for local and cloud models

1. Create an [Ollama API key](https://ollama.com/settings/keys). Ollama supports search with a free account; service quotas still apply.
2. Open **Settings → Knowledge & web → Web search**.
3. Choose **Configured provider** as the execution source and **Ollama** as the provider, then enter the API key and use **Test search**.
4. Enable the chat web-search toggle and choose a model that supports tool calling.

Search uses `https://ollama.com/api/web_search`, independently of where the model runs. Your search query goes to Ollama, and returned snippets go to the selected model. Local inference stays local, while search requires a network connection. The key stays on this device. Signing into the Ollama app alone does not supply this separate search API key.

Ollama's search API accepts a query and result count; safe-search and date filters are not supported. No search is sent merely by selecting this provider.

## Output-token setting

Leave **Maximum Tokens** on **Auto (recommended)**. Ollama Client omits the wire-level output limit in Auto mode so the daemon can choose a valid value for either a local or hosted model.

Older releases sent their internal `-1` sentinel to Ollama. Some cloud models reject that value with HTTP 400. You should no longer need to replace it with a large positive number manually.

## Troubleshooting

### HTTP 401 or sign-in error

Open the Ollama app or run `ollama signin`, then retry the same model with `ollama run <model>:cloud`.

### HTTP 400 while generating

Reset **Maximum Tokens** to Auto. Also start a new text-only chat if the selected cloud model does not support images or other input from the current conversation.

### Model requires another plan

The Cloud badge may include `free`, `pro`, or another plan reported by Ollama. Availability and usage limits are controlled by your Ollama account. See [Ollama Cloud](https://docs.ollama.com/cloud) for current account and usage details.

### Local models work but cloud models do not

That confirms the local daemon is reachable, but not that it is authenticated for cloud inference. Test the exact `:cloud` model with the Ollama CLI; its error is usually the clearest sign-in or plan diagnostic.

## Related

- [Provider Setup](/guides/provider-setup/)
- [Privacy](/concepts/privacy/)
- [Ollama Cloud documentation](https://docs.ollama.com/cloud)
- [MiniMax M3 on Ollama](https://ollama.com/library/minimax-m3%3Acloud)
