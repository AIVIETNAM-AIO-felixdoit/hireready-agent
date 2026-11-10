# HireReady Agent

An AI agent that tailors your CV to a specific job, **fact-checks its own output**, and gets you ready for the interview.

Paste a job post and your CV. The agent runs a multi-step workflow you can watch live:

1. **Parse**: extracts the job's must-haves, ATS keywords and responsibilities, and turns your CV into structured data (in parallel).
2. **Gap analysis**: scores your original CV against the job and lists matched skills, gaps (with fast ways to close them) and transferable strengths.
3. **Draft**: rewrites your CV for the role without inventing facts. Unknown metrics become placeholders like `[X%]`.
4. **Critic loop**: a second agent acts as an ATS screener and fact-checker. It scores the draft and flags any claim not backed by your original CV. If the score is below 85 or anything is flagged, the writer revises (up to 2 rounds).
5. **Cover letter and interview prep**: a targeted cover letter, plus 6 predicted questions (including ones that probe your gaps) with STAR answer outlines built from your real experience.

Output can be in English, Vietnamese or Bangla. Results can be copied, downloaded as Markdown or printed to PDF.

## Run locally

```bash
npm install
cp .env.example .env.local   # then add your OpenRouter key
npm run dev                  # http://localhost:3000
```

Click **Load sample** to try it with a sample job and CV.

If no server key is set, users can paste their own OpenRouter key in **Settings**. It stays in their browser's localStorage and is only sent with their own requests.

### Environment variables

| Name | Required | Default |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | yes, unless users paste their own | none |
| `OPENROUTER_MODEL` | no | `google/gemini-2.5-flash` |

## Deploy

Push the repo to GitHub, import it in [Vercel](https://vercel.com/new) and add `OPENROUTER_API_KEY`. Nothing else needs configuring.

## Stack

Next.js 15 (App Router) + TypeScript. The API route streams agent events to the browser as NDJSON. LLM access goes through [OpenRouter](https://openrouter.ai), so the model can be swapped with one env var. There is no database: inputs are never stored.

## Project structure

```
lib/agent.ts            the agent workflow (parse → gap → draft → critic/revise loop → extras)
lib/llm.ts              OpenRouter client with retries and JSON repair
app/api/agent/route.ts  streaming endpoint
app/page.tsx            UI: inputs, live agent trace, results tabs
```
