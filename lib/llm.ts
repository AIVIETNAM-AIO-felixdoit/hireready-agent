// Thin client for any OpenAI-compatible chat completions API.
// Server provider: LLM_BASE_URL + LLM_API_KEY + LLM_MODEL (e.g. Meta Model API) if set,
// otherwise OpenRouter. A key pasted by the user in Settings is always an OpenRouter key.

export type Msg = { role: "system" | "user" | "assistant"; content: string };

const OPENROUTER = "https://openrouter.ai/api/v1";

type Provider = { base: string; key?: string; model: string; openrouter: boolean };

function provider(userKey?: string, userModel?: string): Provider {
  if (!userKey && process.env.LLM_BASE_URL && process.env.LLM_API_KEY) {
    return {
      base: process.env.LLM_BASE_URL.replace(/\/+$/, ""),
      key: process.env.LLM_API_KEY,
      model: process.env.LLM_MODEL || "muse-spark-1.3",
      openrouter: false,
    };
  }
  return {
    base: OPENROUTER,
    key: userKey || process.env.OPENROUTER_API_KEY,
    model: userModel || process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash",
    openrouter: true,
  };
}

export function serverInfo() {
  const p = provider();
  return { serverKey: Boolean(p.key), model: p.model, provider: p.openrouter ? "openrouter" : new URL(p.base).host };
}

async function chat(messages: Msg[], opts: { json?: boolean; model?: string; apiKey?: string } = {}) {
  const p = provider(opts.apiKey, opts.model);
  if (!p.key) throw new Error("Missing API key. Configure the server key or paste an OpenRouter key in Settings.");

  const body: Record<string, unknown> = { model: p.model, messages, temperature: 0.4 };
  if (opts.json) body.response_format = { type: "json_object" };
  // Thinking models (e.g. NVIDIA Nemotron) are ~7x slower with reasoning on; this workflow
  // doesn't need it. Set OPENROUTER_REASONING=on to re-enable.
  if (p.openrouter && process.env.OPENROUTER_REASONING !== "on") body.reasoning = { enabled: false };
  // e.g. "minimal" for Meta muse-spark models, which reason by default.
  if (!p.openrouter && process.env.LLM_REASONING_EFFORT) body.reasoning_effort = process.env.LLM_REASONING_EFFORT;

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${p.base}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${p.key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/hireready-agent",
          "X-Title": "HireReady Agent",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        const name = p.openrouter ? "OpenRouter" : new URL(p.base).host;
        // Some providers reject json_object mode: drop it and rely on parseJson instead.
        if ((res.status === 400 || res.status === 422) && body.response_format) {
          delete body.response_format;
          attempt--;
          continue;
        }
        // Don't retry auth / bad request errors
        if (res.status === 401 || res.status === 400 || res.status === 402 || res.status === 403) {
          throw Object.assign(new Error(`${name} ${res.status}: ${text.slice(0, 300)}`), { fatal: true });
        }
        throw new Error(`${name} ${res.status}: ${text.slice(0, 300)}`);
      }
      const data = await res.json();
      const content: string | undefined = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error("Empty response from model");
      return content;
    } catch (e) {
      lastErr = e;
      if ((e as { fatal?: boolean }).fatal) throw e;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/** Extract the first JSON object from a model reply (handles ```json fences and stray text). */
export function parseJson<T>(raw: string): T {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s) as T;
  } catch {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(s.slice(start, end + 1)) as T;
    throw new Error("Model did not return valid JSON");
  }
}

export async function chatJson<T>(messages: Msg[], opts: { model?: string; apiKey?: string } = {}): Promise<T> {
  try {
    return parseJson<T>(await chat(messages, { ...opts, json: true }));
  } catch (e) {
    if ((e as { fatal?: boolean }).fatal) throw e;
    // One repair attempt: some models ignore response_format.
    const raw = await chat(
      [...messages, { role: "user", content: "Return ONLY a valid JSON object, no prose, no code fences." }],
      opts,
    );
    return parseJson<T>(raw);
  }
}

export async function chatText(messages: Msg[], opts: { model?: string; apiKey?: string } = {}) {
  return chat(messages, opts);
}
