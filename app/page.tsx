"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import { SAMPLE_CV, SAMPLE_JD } from "@/lib/samples";
import type { AgentEvent, Critique, GapAnalysis, InterviewPrep, JobProfile } from "@/lib/agent";

type Step = { id: string; label: string; status: "running" | "done" | "error"; detail?: string; t0: number; t1?: number };
type Tab = "overview" | "cv" | "letter" | "prep";

const LS_KEY = "hireready-settings";

export default function Home() {
  const [jd, setJd] = useState("");
  const [cv, setCv] = useState("");
  const [language, setLanguage] = useState("English");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [serverKey, setServerKey] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [job, setJob] = useState<JobProfile | null>(null);
  const [gap, setGap] = useState<GapAnalysis | null>(null);
  const [critiques, setCritiques] = useState<(Critique & { round: number })[]>([]);
  const [tailored, setTailored] = useState("");
  const [letter, setLetter] = useState("");
  const [prep, setPrep] = useState<InterviewPrep | null>(null);
  const [best, setBest] = useState<{ round: number; score: number } | null>(null);
  const [baseline, setBaseline] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
      if (s.language) setLanguage(s.language);
      if (s.model) setModel(s.model);
      if (s.apiKey) setApiKey(s.apiKey);
    } catch {}
    fetch("/api/agent")
      .then((r) => r.json())
      .then((d) => setServerKey(Boolean(d.serverKey)))
      .catch(() => setServerKey(false));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ language, model, apiKey }));
    } catch {}
  }, [language, model, apiKey]);

  const finalScore = best ? best.score : null;

  async function run() {
    setError("");
    setSteps([]);
    setJob(null);
    setGap(null);
    setCritiques([]);
    setTailored("");
    setLetter("");
    setPrep(null);
    setBest(null);
    setBaseline(null);
    setTab("overview");
    setRunning(true);
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jd, cv, language, model: model || undefined, apiKey: apiKey || undefined }),
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) handle(JSON.parse(line) as AgentEvent);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSteps((s) => s.map((x) => (x.status === "running" ? { ...x, status: "error" } : x)));
    } finally {
      setRunning(false);
    }
  }

  function handle(e: AgentEvent) {
    if (e.type === "step") {
      setSteps((prev) => {
        const i = prev.findIndex((s) => s.id === e.id);
        if (i < 0) return [...prev, { ...e, t0: Date.now() }];
        const next = [...prev];
        next[i] = { ...next[i], ...e, t1: e.status !== "running" ? Date.now() : undefined };
        return next;
      });
    } else if (e.type === "result") {
      if (e.key === "job") setJob(e.data as JobProfile);
      if (e.key === "gap") setGap(e.data as GapAnalysis);
      if (e.key === "critique") setCritiques((c) => [...c, e.data as Critique & { round: number }]);
      if (e.key === "cv") setTailored(e.data as string);
      if (e.key === "letter") setLetter(e.data as string);
      if (e.key === "baseline") setBaseline((e.data as { score: number }).score);
      if (e.key === "best") setBest(e.data as { round: number; score: number });
      if (e.key === "prep") setPrep(e.data as InterviewPrep);
    } else if (e.type === "error") {
      setError(e.message);
      setSteps((s) => s.map((x) => (x.status === "running" ? { ...x, status: "error" } : x)));
    }
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (!/\.(txt|md|markdown)$/i.test(f.name)) {
      setError("Upload a .txt or .md file, or paste the CV text directly (copy from your PDF/Word file).");
      return;
    }
    setCv(await f.text());
  }

  const canRun = !running && jd.trim().length >= 50 && cv.trim().length >= 50 && (serverKey || apiKey);

  return (
    <main>
      <header className="hero">
        <div className="brand">
          <span className="logo">◆</span> HireReady Agent
        </div>
        <h1>Tailor your CV to any job — with an AI agent that checks its own work.</h1>
        <p className="sub">
          Paste a job post and your CV. The agent parses both, finds your skill gaps, rewrites your CV, has a second
          critic agent fact-check and score it, revises until it passes, then writes your cover letter and predicts
          your interview questions.
        </p>
      </header>

      <section className="inputs">
        <div className="field">
          <div className="label-row">
            <label htmlFor="jd">Job description</label>
            <span className="count">{jd.length.toLocaleString()} chars</span>
          </div>
          <textarea id="jd" value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the full job post here…" />
        </div>
        <div className="field">
          <div className="label-row">
            <label htmlFor="cv">Your CV</label>
            <label className="link">
              Upload .txt/.md
              <input type="file" accept=".txt,.md,.markdown" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          </div>
          <textarea id="cv" value={cv} onChange={(e) => setCv(e.target.value)} placeholder="Paste your CV text here…" />
        </div>
      </section>

      <section className="controls">
        <button className="ghost" onClick={() => { setJd(SAMPLE_JD); setCv(SAMPLE_CV); }} disabled={running}>
          Load sample
        </button>
        <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={running} aria-label="Output language">
          <option>English</option>
          <option>Vietnamese</option>
          <option>Bangla</option>
        </select>
        <button className="ghost" onClick={() => setShowSettings((s) => !s)}>
          Settings {showSettings ? "▴" : "▾"}
        </button>
        <button className="primary" onClick={run} disabled={!canRun}>
          {running ? "Agent working…" : "Run agent →"}
        </button>
      </section>

      {showSettings && (
        <section className="settings">
          <div className="field">
            <label htmlFor="key">OpenRouter API key {serverKey ? "(optional — server key configured)" : "(required)"}</label>
            <input id="key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-or-…" />
            <small>Stored only in your browser and sent with your request. Get one at openrouter.ai/keys.</small>
          </div>
          <div className="field">
            <label htmlFor="model">Model (optional)</label>
            <input id="model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="google/gemini-2.5-flash" />
            <small>Any OpenRouter model id, e.g. anthropic/claude-sonnet-4.5, openai/gpt-4o-mini.</small>
          </div>
        </section>
      )}
      {serverKey === false && !apiKey && !showSettings && (
        <p className="hint">No server API key configured — open Settings and paste your OpenRouter key.</p>
      )}

      <div ref={resultsRef} />
      {error && <div className="error">⚠ {error}</div>}

      {steps.length > 0 && (
        <section className="grid">
          <aside className="timeline card">
            <h3>Agent trace</h3>
            <ol>
              {steps.map((s) => (
                <li key={s.id} className={s.status}>
                  <span className="dot" />
                  <div>
                    <div className="step-label">
                      {s.label}
                      {s.t1 && <span className="time">{((s.t1 - s.t0) / 1000).toFixed(1)}s</span>}
                    </div>
                    {s.detail && <div className="step-detail">{s.detail}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </aside>

          <div className="results card">
            <nav className="tabs">
              {(
                [
                  ["overview", "Match report"],
                  ["cv", "Tailored CV"],
                  ["letter", "Cover letter"],
                  ["prep", "Interview prep"],
                ] as [Tab, string][]
              ).map(([k, l]) => (
                <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
                  {l}
                </button>
              ))}
            </nav>

            {tab === "overview" && (
              <Overview job={job} gap={gap} critiques={critiques} finalScore={finalScore} baseline={baseline} bestRound={best?.round ?? null} />
            )}
            {tab === "cv" && <Doc md={tailored} name="tailored-cv.md" pending={running} />}
            {tab === "letter" && <Doc md={letter} name="cover-letter.md" pending={running} />}
            {tab === "prep" && <Prep prep={prep} pending={running} />}
          </div>
        </section>
      )}

      <footer>
        Built for the Agentic Hackathon with Devin · Your data is sent only to the model provider for this request and is not stored.
      </footer>
    </main>
  );
}

function Overview({
  job,
  gap,
  critiques,
  finalScore,
  baseline,
  bestRound,
}: {
  job: JobProfile | null;
  gap: GapAnalysis | null;
  critiques: (Critique & { round: number })[];
  finalScore: number | null;
  bestRound: number | null;
  baseline: number | null;
}) {
  if (!gap) return <Waiting text="Analyzing the match…" />;
  const last = critiques.find((c) => c.round === bestRound) ?? critiques[critiques.length - 1];
  return (
    <div className="overview">
      {job && (
        <p className="job-line">
          <strong>{job.role}</strong> · {job.company} · {job.seniority}
        </p>
      )}
      <div className="scores">
        <Score label="Original CV" value={baseline} />
        <span className="arrow">→</span>
        <Score label="Tailored CV" value={finalScore} />
      </div>
      <p>{gap.summary}</p>

      {critiques.length > 0 && (
        <div className="rounds">
          {critiques.map((c) => (
            <span key={c.round} className={`pill${c.round === bestRound ? " best" : ""}`}>
              Draft #{c.round}: {c.score}
              {c.fabrication_flags?.length ? ` · ${c.fabrication_flags.length} flag(s)` : ""}
              {c.round === bestRound ? " · selected ✓" : ""}
            </span>
          ))}
          {last && <p className="muted">Critic: {last.verdict}</p>}
        </div>
      )}

      <div className="cols">
        <div>
          <h4>✓ Matched</h4>
          <div className="chips">
            {(gap.matched || []).map((m) => (
              <span key={m} className="chip ok">{m}</span>
            ))}
          </div>
          <h4>↻ Transferable strengths</h4>
          <ul className="plain">
            {(gap.transferable || []).map((t, i) => (
              <li key={i}>
                <strong>{t.requirement}</strong> — {t.evidence}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4>✗ Gaps & how to close them</h4>
          <ul className="plain">
            {(gap.missing || []).map((m, i) => (
              <li key={i}>
                <span className={`imp ${m.importance}`}>{m.importance}</span> <strong>{m.skill}</strong> — {m.how_to_close}
              </li>
            ))}
          </ul>
          <h4>Strategy used</h4>
          <ul className="plain">
            {(gap.strategy || []).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Score({ label, value }: { label: string; value: number | null }) {
  const v = value ?? 0;
  const color = value == null ? "var(--muted)" : v >= 80 ? "var(--ok)" : v >= 60 ? "var(--warn)" : "var(--bad)";
  return (
    <div className="score">
      <div className="ring" style={{ ["--p" as string]: `${v}`, ["--c" as string]: color }}>
        <span>{value == null ? "…" : v}</span>
      </div>
      <div className="score-label">{label}</div>
    </div>
  );
}

function Doc({ md, name, pending }: { md: string; name: string; pending: boolean }) {
  const html = useMemo(() => (md ? (marked.parse(md, { async: false }) as string) : ""), [md]);
  const [copied, setCopied] = useState(false);
  if (!md) return <Waiting text={pending ? "The agent is still working on this…" : "Not generated."} />;
  return (
    <div>
      <div className="doc-actions">
        <button
          className="ghost"
          onClick={() => {
            navigator.clipboard.writeText(md);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied ✓" : "Copy Markdown"}
        </button>
        <button
          className="ghost"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = name;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download .md
        </button>
        <button className="ghost" onClick={() => printHtml(html)}>
          Print / PDF
        </button>
      </div>
      <article className="md" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function printHtml(html: string) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>Document</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:760px;margin:40px auto;color:#111}h1{margin-bottom:0}h2{border-bottom:1px solid #ddd;padding-bottom:4px;margin-top:24px}</style></head><body>${html}</body></html>`,
  );
  w.document.close();
  w.focus();
  w.print();
}

function Prep({ prep, pending }: { prep: InterviewPrep | null; pending: boolean }) {
  if (!prep) return <Waiting text={pending ? "The agent is still working on this…" : "Not generated."} />;
  return (
    <div className="prep">
      {(prep.questions || []).map((q, i) => (
        <details key={i} open={i === 0}>
          <summary>
            <span className={`tag ${q.type}`}>{q.type}</span> {q.q}
          </summary>
          <p className="muted">Why they ask: {q.why}</p>
          <p>
            <strong>Answer outline:</strong> {q.answer_outline}
          </p>
        </details>
      ))}
      {prep.questions_to_ask?.length > 0 && (
        <>
          <h4>Questions you should ask them</h4>
          <ul className="plain">
            {prep.questions_to_ask.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Waiting({ text }: { text: string }) {
  return (
    <div className="waiting">
      <span className="spinner" /> {text}
    </div>
  );
}
