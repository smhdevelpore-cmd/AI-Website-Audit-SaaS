/**
 * A provider that talks to an OpenAI-compatible chat-completions endpoint.
 *
 * The endpoint is configuration, not a constant, because the provider is an unresolved decision
 * (ARD §12) and because a test must be able to point it at a local server. Nothing here logs the
 * key, the prompt or the reply: the reply is website-derived text and the key is a secret.
 */

import type { AiProvider, AiRequest } from "./types.js";

export interface HttpProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  /** Full URL of the completions endpoint. Defaults to the OpenAI-compatible path. */
  readonly endpoint?: string;
  readonly fetch?: typeof globalThis.fetch;
  /** Sent as `Authorization: Bearer`. Overridable for providers that use another scheme. */
  readonly authHeader?: string;
}

interface ChatCompletionResponse {
  readonly choices?: ReadonlyArray<{ readonly message?: { readonly content?: string } }>;
}

export const DEFAULT_LLM_ENDPOINT = "https://api.openai.com/v1/chat/completions";

export function createHttpAiProvider(options: HttpProviderOptions): AiProvider {
  const call = options.fetch ?? globalThis.fetch;
  const endpoint = options.endpoint ?? DEFAULT_LLM_ENDPOINT;

  return async (request: AiRequest, signal: AbortSignal): Promise<string> => {
    const response = await call(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: options.authHeader ?? `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        temperature: 0.2,
        max_tokens: request.maxOutputTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
      }),
      signal,
    });

    if (!response.ok) {
      // The body can echo the prompt; the status is the only thing worth keeping.
      throw new Error(`provider answered ${response.status}`);
    }

    const body = (await response.json()) as ChatCompletionResponse;
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new Error("provider returned no content");
    }
    return content;
  };
}
