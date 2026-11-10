# Devpost submission text: HireReady Agent

## Tagline
An AI agent that tailors your CV to any job, fact-checks itself, and preps you for the interview.

## Inspiration
Fresh graduates and early-career developers apply to dozens of jobs with the same generic CV. Most applications are filtered out by keyword screening before a person reads them. Tailoring each CV by hand takes about an hour per job. Generic AI rewriters are fast, but they often *invent* skills and numbers, which can cost you the job at the interview.

## What it does
You paste a job post and your CV. HireReady runs an agentic workflow and shows every step live:

1. **Parses** the job (must-haves, ATS keywords) and your CV into structured data.
2. **Analyzes gaps**: gives an original match score, matched skills, missing skills with fast ways to close them, and transferable strengths you didn't highlight.
3. **Drafts** a tailored CV that never invents facts. Missing metrics become `[X%]` placeholders for you to fill in.
4. **Self-critiques**: a separate critic agent scores the draft as an ATS screener and fact-checks every claim against your original CV. The writer revises until the score is at least 85 and no claim is flagged (max 2 revisions).
5. **Prepares you**: writes a targeted cover letter and predicts 6 interview questions, including ones about your gaps, with STAR answer outlines.

Output in English, Vietnamese or Bangla. You can copy, download or print to PDF.

## How we built it
- **Next.js 15 + TypeScript**, deployed on Vercel.
- The **agent workflow** (`lib/agent.ts`) mixes parallel steps, structured JSON outputs and a **writer ↔ critic feedback loop** with a stopping condition.
- Agent events are **streamed** to the UI as NDJSON, so users see each step, its timing and its result as it happens.
- **Meta Model API** (`muse-spark-1.3`) powers the agents; the client works with any OpenAI-compatible provider (OpenRouter fallback), so models can be swapped with env vars.
- **Devin** was used during development to *(fill in: e.g. scaffold the project, implement the streaming endpoint, write the UI, fix bugs)*.

## Challenges
- Stopping the model from "improving" a CV by inventing experience. We solved it with a dedicated fact-checking critic, which beats prompt instructions alone.
- Getting reliable structured output across different models (JSON mode + a repair fallback).

## What's next
- PDF/DOCX CV upload
- Track applications across many jobs
- Browser extension: tailor straight from a LinkedIn or BDJobs job page

## Target users
Students, fresh graduates and early-career professionals in Bangladesh and beyond who apply to many jobs and need each application to stand out.

## Try it
- Live demo: https://hireready-agent.vercel.app/
- Repo: https://github.com/AIVIETNAM-AIO-felixdoit/hireready-agent
- Demo video: https://youtu.be/LZQsHbsydGY
- Click **Load sample**, then **Run agent**. A full run takes about 1–1.5 minutes.
