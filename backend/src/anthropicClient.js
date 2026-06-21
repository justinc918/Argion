// anthropicClient.js
//
// Thin wrapper around the Anthropic Messages API.
// Uses node-fetch (already a project dependency) so we don't add the full SDK.

import fetch from "node-fetch";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";
const API_KEY = process.env.ANTHROPIC_API_KEY;

export async function callSonnet({ system, userMessage, maxTokens = 2048, timeoutMs = 30_000 }) {
  if (!API_KEY) {
    throw new Error("ANTHROPIC_API_KEY env var is not set");
  }

  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: userMessage }],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`Anthropic API timed out after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 500)}`);
  }

  const json = await res.json();
  const content = json.content?.[0]?.text;
  if (!content) {
    throw new Error("Empty response from Anthropic API");
  }
  return content;
}

// Streaming variant: calls Anthropic with stream:true and yields text chunks
// via a callback. Returns the full accumulated text when done.
export async function callSonnetStream({ system, userMessage, maxTokens = 1024, onChunk }) {
  if (!API_KEY) {
    throw new Error("ANTHROPIC_API_KEY env var is not set");
  }

  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    stream: true,
    system,
    messages: [{ role: "user", content: userMessage }],
  };

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 500)}`);
  }

  let full = "";
  let buffer = "";

  for await (const chunk of res.body) {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") continue;

      try {
        const evt = JSON.parse(payload);
        if (evt.type === "content_block_delta" && evt.delta?.text) {
          full += evt.delta.text;
          if (onChunk) onChunk(evt.delta.text);
        }
      } catch {}
    }
  }

  return full;
}
