// HireReady agent: a multi-step, self-correcting workflow that tailors a CV to a job.
//
//  1. Parse JD + CV in parallel into structured data
//  2. Gap analysis (match score, missing skills, transferable evidence)
//  3. Draft a tailored CV (no invented facts)
//  4. Critic agent scores the draft & flags fabrication -> revise loop (max 2 rounds)
//  5. Cover letter + interview prep in parallel

import { chatJson, chatText, type Msg } from "./llm";

export type AgentEvent =
  | { type: "step"; id: string; label: string; status: "running" | "done" | "error"; detail?: string }
  | { type: "result"; key: string; data: unknown }
  | { type: "error"; message: string }
  | { type: "done" };

export type JobProfile = {
  role: string;
  company: string;
  seniority: string;
  must_have: string[];
  nice_to_have: string[];
  keywords: string[];
  responsibilities: string[];
};

export type CandidateProfile = {
  name: string;
  headline: string;
  skills: string[];
  experiences: { title: string; org: string; period: string; highlights: string[] }[];
  education: string[];
  projects: string[];
};

export type GapAnalysis = {
  score: number;
  summary: string;
  matched: string[];
  missing: { skill: string; importance: "high" | "medium" | "low"; how_to_close: string }[];
  transferable: { requirement: string; evidence: string }[];
  strategy: string[];
};

export type Critique = {
  score: number;
  verdict: string;
  issues: string[];
  fabrication_flags: string[];
  missing_keywords: string[];
};

export type InterviewPrep = {
  questions: { q: string; why: string; answer_outline: string; type: "behavioral" | "technical" | "gap" }[];
  questions_to_ask: string[];
};

export type AgentInput = {
  jd: string;
  cv: string;
  language: string; // output language, e.g. "English" or "Vietnamese"
  model?: string;
  apiKey?: string;
};

const TARGET_SCORE = 85;
const MAX_REVISIONS = 2;

export async function runAgent(input: AgentInput, emit: (e: AgentEvent) => void) {
  const opts = { model: input.model, apiKey: input.apiKey };
  const lang = input.language || "English";
  const step = (id: string, label: string, status: "running" | "done" | "error", detail?: string) =>
    emit({ type: "step", id, label, status, detail });

  // ---------- 1. Parse ----------
  step("parse", "Reading the job description and your CV", "running");
  const [job, cand] = await Promise.all([
    chatJson<JobProfile>(
      [
        {
          role: "system",
          content:
            "You are a recruiting analyst. Extract structured data from a job description. Respond with JSON: " +
            '{"role":string,"company":string,"seniority":string,"must_have":string[],"nice_to_have":string[],"keywords":string[],"responsibilities":string[]}. ' +
            "keywords = the exact ATS terms a screener would search for (tools, skills, certifications). Use 'Unknown' if absent.",
        },
        { role: "user", content: input.jd },
      ],
      opts,
    ),
    chatJson<CandidateProfile>(
      [
        {
          role: "system",
          content:
            "You are a recruiting analyst. Extract structured data from a CV/resume. Respond with JSON: " +
            '{"name":string,"headline":string,"skills":string[],"experiences":[{"title":string,"org":string,"period":string,"highlights":string[]}],"education":string[],"projects":string[]}. ' +
            "Copy facts faithfully. Never invent anything not in the CV.",
        },
        { role: "user", content: input.cv },
      ],
      opts,
    ),
  ]);
  emit({ type: "result", key: "job", data: job });
  emit({ type: "result", key: "candidate", data: cand });
  step(
    "parse",
    "Reading the job description and your CV",
    "done",
    `${job.role} @ ${job.company} · ${job.must_have?.length ?? 0} must-haves · ${cand.skills?.length ?? 0} skills found in CV`,
  );

  // ---------- 2. Gap analysis ----------
  step("gap", "Analyzing skill gaps and match score", "running");
  const gap = await chatJson<GapAnalysis>(
    [
      {
        role: "system",
        content:
          "You are a senior hiring manager. Compare the candidate to the job honestly. Respond with JSON: " +
          '{"score":number 0-100,"summary":string,"matched":string[],"missing":[{"skill":string,"importance":"high"|"medium"|"low","how_to_close":string}],' +
          '"transferable":[{"requirement":string,"evidence":string}],"strategy":string[]}. ' +
          "score = how well the ORIGINAL CV would pass screening for this job. transferable = job requirements the CV does not state directly " +
          "but where the CV has real evidence that can be reframed. how_to_close = concrete, fast actions (a course, a mini project). " +
          `strategy = 3-5 tailoring moves for the rewrite. Write all text values in ${lang}.`,
      },
      { role: "user", content: `JOB:\n${JSON.stringify(job)}\n\nCANDIDATE:\n${JSON.stringify(cand)}` },
    ],
    opts,
  );
  gap.score = clampScore(gap.score);
  emit({ type: "result", key: "gap", data: gap });
  step(
    "gap",
    "Analyzing skill gaps and match score",
    "done",
    `Original match ${gap.score}/100 · ${gap.missing?.length ?? 0} gaps · ${gap.transferable?.length ?? 0} transferable strengths`,
  );

  // ---------- 3. Draft + 4. critique / revise loop ----------
  const writerSystem: Msg = {
    role: "system",
    content:
      "You are an expert resume writer. Rewrite the candidate's CV tailored to the job, in Markdown. Rules:\n" +
      "- NEVER invent employers, titles, dates, degrees, metrics, or skills the candidate does not have.\n" +
      "- You MAY reorder, rephrase with strong action verbs, surface transferable evidence, and mirror the job's keywords where truthful.\n" +
      "- If a metric would help but is unknown, write a placeholder like [X%] so the candidate fills it in.\n" +
      "- Structure: name + headline, short professional summary targeted at the role, skills (most relevant first), experience, projects, education.\n" +
      `- Write in ${lang}. Output ONLY the Markdown CV.`,
  };
  const context = `ORIGINAL CV:\n${input.cv}\n\nJOB:\n${JSON.stringify(job)}\n\nGAP ANALYSIS:\n${JSON.stringify(gap)}`;

  step("draft", "Writing a tailored CV", "running");
  let draft = stripFences(await chatText([writerSystem, { role: "user", content: context }], opts));
  step("draft", "Writing a tailored CV", "done", `${draft.split(/\s+/).length} words`);

  let critique: Critique | null = null;
  for (let round = 1; round <= MAX_REVISIONS + 1; round++) {
    const id = `critic-${round}`;
    step(id, `Critic agent reviewing draft #${round}`, "running");
    critique = await chatJson<Critique>(
      [
        {
          role: "system",
          content:
            "You are a strict ATS screener and fact-checker. Evaluate the TAILORED CV against the JOB, and check it against the ORIGINAL CV for fabrication. Respond with JSON: " +
            '{"score":number 0-100,"verdict":string,"issues":string[],"fabrication_flags":string[],"missing_keywords":string[]}. ' +
            "fabrication_flags = any claim in the tailored CV not supported by the original CV (placeholders like [X%] are fine). " +
            "missing_keywords = job keywords the candidate truly has evidence for but the tailored CV does not mention. " +
            `issues = concrete fixes. Write text values in ${lang}.`,
        },
        { role: "user", content: `JOB:\n${JSON.stringify(job)}\n\nORIGINAL CV:\n${input.cv}\n\nTAILORED CV:\n${draft}` },
      ],
      opts,
    );
    critique.score = clampScore(critique.score);
    const flags = critique.fabrication_flags?.length ?? 0;
    const pass = critique.score >= TARGET_SCORE && flags === 0;
    step(
      id,
      `Critic agent reviewing draft #${round}`,
      "done",
      `Score ${critique.score}/100 · ${flags} fabrication flag(s) · ${pass ? "approved ✓" : "needs revision"}`,
    );
    emit({ type: "result", key: "critique", data: { ...critique, round } });
    if (pass || round > MAX_REVISIONS) break;

    const rid = `revise-${round}`;
    step(rid, `Revising CV based on critic feedback`, "running");
    draft = stripFences(
      await chatText(
        [
          writerSystem,
          { role: "user", content: context },
          { role: "assistant", content: draft },
          {
            role: "user",
            content:
              "A reviewer found these problems. Fix all of them and return the full revised Markdown CV only.\n" +
              `FABRICATION (remove or rephrase to match the original CV): ${JSON.stringify(critique.fabrication_flags)}\n` +
              `ISSUES: ${JSON.stringify(critique.issues)}\n` +
              `KEYWORDS TO ADD (only where truthful): ${JSON.stringify(critique.missing_keywords)}`,
          },
        ],
        opts,
      ),
    );
    step(rid, `Revising CV based on critic feedback`, "done");
  }
  emit({ type: "result", key: "cv", data: draft });

  // ---------- 5. Cover letter + interview prep ----------
  step("extras", "Writing cover letter and interview prep", "running");
  const [letter, prep] = await Promise.all([
    chatText(
      [
        {
          role: "system",
          content:
            "Write a concise, specific cover letter (max 250 words) in Markdown for this candidate and job. " +
            "Open with a hook tied to the company/role, cite 2-3 real achievements from the CV mapped to the job's needs, " +
            `acknowledge growth areas positively only if useful, no clichés, no invented facts. Write in ${lang}. Output only the letter.`,
        },
        { role: "user", content: `JOB:\n${JSON.stringify(job)}\n\nTAILORED CV:\n${draft}` },
      ],
      opts,
    ),
    chatJson<InterviewPrep>(
      [
        {
          role: "system",
          content:
            "You are an interview coach. Predict the 6 questions this interviewer is most likely to ask THIS candidate, " +
            "including at least 2 that probe the candidate's gaps. Respond with JSON: " +
            '{"questions":[{"q":string,"why":string,"answer_outline":string,"type":"behavioral"|"technical"|"gap"}],"questions_to_ask":string[]}. ' +
            "answer_outline = a STAR-style outline using the candidate's real experience. questions_to_ask = 3 smart questions for the candidate to ask. " +
            `Write in ${lang}.`,
        },
        { role: "user", content: `JOB:\n${JSON.stringify(job)}\n\nGAPS:\n${JSON.stringify(gap)}\n\nCV:\n${draft}` },
      ],
      opts,
    ),
  ]);
  emit({ type: "result", key: "letter", data: stripFences(letter) });
  emit({ type: "result", key: "prep", data: prep });
  step("extras", "Writing cover letter and interview prep", "done", `${prep.questions?.length ?? 0} predicted questions`);

  emit({ type: "done" });
}

function clampScore(n: unknown) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
}

function stripFences(s: string) {
  const m = s.trim().match(/^```(?:markdown|md)?\s*([\s\S]*?)```$/i);
  return (m ? m[1] : s).trim();
}
