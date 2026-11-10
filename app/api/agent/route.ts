import { runAgent, type AgentEvent } from "@/lib/agent";
import { serverInfo } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const jd = String(body.jd ?? "").trim();
  const cv = String(body.cv ?? "").trim();
  if (jd.length < 50 || cv.length < 50) {
    return Response.json({ error: "Please paste a full job description and CV (at least 50 characters each)." }, { status: 400 });
  }
  if (jd.length > 20000 || cv.length > 20000) {
    return Response.json({ error: "Input too long (max 20,000 characters each)." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AgentEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await runAgent(
          {
            jd,
            cv,
            language: String(body.language || "English"),
            model: body.model ? String(body.model) : undefined,
            apiKey: body.apiKey ? String(body.apiKey) : undefined,
          },
          emit,
        );
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
  });
}

export async function GET() {
  return Response.json({ ok: true, ...serverInfo() });
}
