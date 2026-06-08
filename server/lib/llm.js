// Thin OpenAI SDK wrapper that targets the oauth2api Claude proxy.
//
// We keep a single shared client so the SDK's connection pool stays warm.
// The `system` extra_body annotation carries Anthropic's cache_control
// marker — when the proxy passes it through, the mode prompts (which are
// big and static) get cached and the per-call billed input drops to near zero.
import OpenAI from "openai";

let _client = null;

function client() {
  if (_client) return _client;
  _client = new OpenAI({
    apiKey:  process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    timeout: 120_000,
    maxRetries: 2,
  });
  return _client;
}

function model() {
  return process.env.OPENAI_MODEL || "auto";
}

/**
 * Run one chat completion with the given system + user messages. The
 * `system` text is sent twice — once via the standard `messages` field
 * (for proxies that ignore extra_body) and once via `extra_body.system`
 * with cache_control:ephemeral (for proxies that pass through to Claude).
 *
 * Returns the assistant's plain-text content.
 */
export async function complete({ system, user, maxTokens = 1500 }) {
  const resp = await client().chat.completions.create({
    model:        model(),
    max_tokens:   maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user",   content: user },
    ],
    // Anthropic-style cache hint. Ignored by proxies that don't know
    // about it; massive savings on proxies that do.
    extra_body: {
      system: [
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
      ],
    },
  });
  return resp.choices[0]?.message?.content?.trim() || "";
}
