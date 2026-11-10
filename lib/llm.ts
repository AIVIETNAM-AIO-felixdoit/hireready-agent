// Thin OpenRouter client (OpenAI-compatible chat completions API).

export type Msg = { role: "system" | "user" | "assistant"; content: string };

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export function getModel(override?: string) {
  return override || process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash";
}

async function chat(messages: Msg[], opts: { json?: boolean; model?: string; apiKey?: string } = {}) {
  const apiKey = opts.apiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Missing OpenRouter API key. Set OPENROUTER_API_KEY or paste a key in Settings.");

  const body: Record<string, unknown> = {
    model: getModel(opts.model),
    messages,
    temperature: 0.4,
  };
  if (opts.json) body.response_format = { type: "json_object" };
  // Thinking models (e.g. NVIDIA Nemotron) are ~7x slower with reasoning on; this workflow
  // doesn't need it. Set OPENROUTER_REASONING=on to re-enable.
  if (process.env.OPENROUTER_REASONING !== "on") body.reasoning = { enabled: false };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/hireready-agent",
          "X-Title": "HireReady Agent",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        // Don't retry auth / bad request errors
        if (res.status === 401 || res.status === 400 || res.status === 402) {
          throw Object.assign(new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`), { fatal: true });
        }
        throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
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
