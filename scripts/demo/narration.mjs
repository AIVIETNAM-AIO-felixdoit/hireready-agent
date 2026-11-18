// Generates voice-over clips with edge-tts and writes voice/narration.json {id: {file, dur}}.
// Usage: node narration.mjs <voiceDir> [voice]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [, , DIR, VOICE = "en-US-AndrewNeural"] = process.argv;
fs.mkdirSync(DIR, { recursive: true });

export const LINES = {
  intro: "Meet HireReady Agent: an AI agent that tailors your CV to any job, fact-checks its own work, and gets you ready for the interview.",
  problem: "Early-career job seekers send the same generic CV everywhere. Keyword screening rejects most of them before a human ever reads them. And generic AI rewriters are fast, but they often invent skills and numbers.",
  paste: "You just paste a job post and your CV. Here, a junior full-stack developer role, and a fresh graduate's CV.",
  run: "One click starts the agent.",
  trace: "The agent now works through a multi-step workflow, and you can watch every step live.",
  parse: "First, it reads the job and the CV in parallel, and turns both into structured data.",
  gap: "Next, a gap analysis: which skills match, what's missing, and which strengths can be reframed.",
  draft: "Then a writer agent drafts a tailored CV, while the original CV is scored with the same rubric.",
  critic1: "Here's the key part. A separate critic agent scores the draft, and fact-checks every claim against the original CV.",
  revise: "It found problems, so the writer revises the draft with minimal edits.",
  critic2: "The critic checks the new draft again.",
  select: "The agent keeps the best draft: no fabrication first, then the highest score.",
  extras: "Finally, it writes a cover letter and predicts interview questions.",
  report: "The match report compares the original and the tailored CV on the same rubric, with the critic's verdict.",
  gaps: "It lists real gaps with concrete ways to close them, plus strengths the candidate didn't highlight.",
  cv: "Here's the tailored CV, rewritten for the role without inventing facts. Unknown numbers become placeholders for the candidate to fill in.",
  letter: "A targeted cover letter that cites real achievements.",
  prep: "And predicted interview questions, including the ones that probe the gaps, each with an answer outline built from the candidate's real experience.",
  outro: "HireReady Agent. Parse, analyze, draft, critique, revise, and prepare. Built for the Agentic Hackathon.",
};

const out = {};
for (const [id, text] of Object.entries(LINES)) {
  const file = path.join(DIR, `${id}.mp3`);
  for (let i = 0; !fs.existsSync(file) || fs.statSync(file).size === 0; i++) {
    try {
      execFileSync("python", ["-m", "edge_tts", "--voice", VOICE, "--rate", "+5%", "--text", text, "--write-media", file], { stdio: "pipe" });
    } catch (e) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
      if (i >= 4) throw e;
      execFileSync("node", ["-e", "setTimeout(()=>{},3000)"]);
    }
  }
  const dur = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());
  out[id] = { file, dur };
  console.log(id.padEnd(8), dur.toFixed(1) + "s");
}
fs.writeFileSync(path.join(DIR, "narration.json"), JSON.stringify(out, null, 2));
