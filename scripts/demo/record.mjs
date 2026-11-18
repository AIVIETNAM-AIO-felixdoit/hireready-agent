// Records a captioned demo video of HireReady Agent.
// Usage: node record.mjs <live|mock> <outDir> [replay.ndjson]
//   live: the app's real agent runs (uses API quota)
//   mock: replays a recorded run with realistic delays (for rehearsing the script)
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const [, , MODE = "mock", OUT = "out", REPLAY] = process.argv;
const APP = "http://localhost:3123";
const W = 1280, H = 800;
fs.mkdirSync(OUT, { recursive: true });

// ---------- mock streaming server ----------
let mockServer;
if (MODE === "mock") {
  const lines = fs.readFileSync(REPLAY, "utf8").trim().split("\n");
  mockServer = http.createServer(async (req, res) => {
    req.resume();
    res.writeHead(200, { "Content-Type": "application/x-ndjson", "Access-Control-Allow-Origin": "*" });
    for (const l of lines) {
      const e = JSON.parse(l);
      await sleep(e.type === "step" && e.status === "done" ? 4000 + Math.random() * 4000 : 150);
      res.write(l + "\n");
    }
    res.end();
  });
  await new Promise((r) => mockServer.listen(3999, r));
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: OUT, size: { width: W, height: H } },
  colorScheme: "light",
});
const page = await ctx.newPage();
const T0 = Date.now();
const t = () => (Date.now() - T0) / 1000;
const marks = []; // idle segments [start, end] to speed up in post

if (MODE === "mock") {
  await page.route("**/api/agent", (route) =>
    route.request().method() === "POST" ? route.continue({ url: "http://localhost:3999/" }) : route.continue(),
  );
}

// ---------- overlay helpers ----------
const OVERLAY = `
(() => {
  if (window.__ov) return;
  window.__ov = true;
  const st = document.createElement('style');
  st.textContent = \`
    #__cap{position:fixed;right:28px;bottom:28px;max-width:820px;z-index:99999;
      background:rgba(17,18,28,.92);color:#fff;font:600 20px/1.4 system-ui,Segoe UI,sans-serif;padding:14px 22px;border-radius:14px;
      box-shadow:0 10px 30px rgba(0,0,0,.25);opacity:0;transition:opacity .35s;text-align:center}
    #__cap small{display:block;font-weight:400;font-size:15px;opacity:.8;margin-top:4px}
    #__card{position:fixed;inset:0;z-index:100000;display:flex;flex-direction:column;align-items:center;justify-content:center;
      background:linear-gradient(135deg,#1e1b4b,#4f46e5);color:#fff;font-family:system-ui,Segoe UI,sans-serif;text-align:center;
      padding:60px;opacity:0;transition:opacity .5s;pointer-events:none}
    #__card h1{font-size:54px;margin:0 0 18px;letter-spacing:-.02em} #__card p{font-size:26px;max-width:900px;opacity:.92;line-height:1.45;margin:6px 0}
    #__card ul{font-size:24px;text-align:left;line-height:1.7;margin-top:10px}
    #__cur{position:fixed;width:22px;height:22px;border-radius:50%;background:rgba(79,70,229,.35);border:2px solid #4f46e5;
      z-index:100001;pointer-events:none;transform:translate(-50%,-50%);transition:transform .1s;left:-50px;top:-50px}
    #__cur.down{transform:translate(-50%,-50%) scale(.7);background:rgba(79,70,229,.7)}\`;
  document.head.appendChild(st);
  for (const id of ['__cap','__card','__cur']) { const d=document.createElement('div'); d.id=id; document.body.appendChild(d); }
  addEventListener('mousemove', e => { const c=document.getElementById('__cur'); c.style.left=e.clientX+'px'; c.style.top=e.clientY+'px'; }, true);
  addEventListener('mousedown', () => document.getElementById('__cur').classList.add('down'), true);
  addEventListener('mouseup', () => document.getElementById('__cur').classList.remove('down'), true);
})();`;

async function caption(text, sub = "") {
  await page.evaluate(([text, sub]) => {
    const c = document.getElementById("__cap");
    c.innerHTML = text ? text + (sub ? `<small>${sub}</small>` : "") : "";
    c.style.opacity = text ? "1" : "0";
  }, [esc(text), esc(sub)]);
}
async function card(html, ms) {
  await page.evaluate((html) => { const c = document.getElementById("__card"); c.innerHTML = html; c.style.opacity = "1"; }, html);
  await sleep(ms);
  await page.evaluate(() => { document.getElementById("__card").style.opacity = "0"; });
  await sleep(600);
}
async function click(selector) {
  if (!(await page.locator(selector).count())) { await page.screenshot({ path: OUT + "/fail.png" }); console.error("CLICK FAIL", selector, t().toFixed(1)); }
  const box = await page.locator(selector).first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
  await sleep(250);
  await page.mouse.down(); await sleep(90); await page.mouse.up();
}
async function smoothScrollTo(y, ms = 1200) {
  await page.evaluate(([y, ms]) => new Promise((r) => {
    const s = scrollY, d = y - s, t0 = performance.now();
    const f = (now) => { const k = Math.min(1, (now - t0) / ms); scrollTo(0, s + d * (k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2)); k < 1 ? requestAnimationFrame(f) : r(); };
    requestAnimationFrame(f);
  }), [y, ms]);
}
async function scrollIntoView(selector, offset = 90) {
  const y = await page.evaluate(([s, o]) => { const el = document.querySelector(s); return el ? el.getBoundingClientRect().top + scrollY - o : 0; }, [selector, offset]);
  await smoothScrollTo(y);
}

// ---------- voice-over ----------
const VO = process.env.VOICE_JSON ? JSON.parse(fs.readFileSync(process.env.VOICE_JSON, "utf8")) : {};
const voice = []; // {id, file, t}
// Starts a voice line now; returns the time (s) when it finishes.
function say(id) {
  const v = VO[id];
  if (!v) return t();
  voice.push({ id, file: v.file, t: t() });
  return t() + v.dur + 0.35;
}
async function until(deadline, minMs = 0) {
  const wait = Math.max(minMs, (deadline - t()) * 1000);
  if (wait > 0) await sleep(wait);
}
async function cardV(html, minMs, id) {
  await page.evaluate((html) => { const c = document.getElementById("__card"); c.innerHTML = html; c.style.opacity = "1"; }, html);
  const s0 = t();
  await sleep(500);
  const end = say(id);
  await until(Math.max(end, s0 + minMs / 1000));
  await page.evaluate(() => { document.getElementById("__card").style.opacity = "0"; });
  await sleep(600);
}

// ---------- the demo ----------
await page.goto(APP, { waitUntil: "networkidle" });
await page.evaluate(OVERLAY);
await page.mouse.move(W / 2, H / 2);

await cardV(`<h1>◆ HireReady Agent</h1><p>An AI agent that tailors your CV to any job,<br/>fact-checks its own work, and preps you for the interview.</p>`, 4500, "intro");
await cardV(`<h1>The problem</h1><ul>
  <li>Early-career job seekers send the same generic CV everywhere</li>
  <li>Keyword (ATS) screening rejects most of them before a human reads it</li>
  <li>Generic AI rewriters are fast, but they <b>invent</b> skills and numbers</li></ul>`, 7000, "problem");

await caption("Paste a job post and your CV", "Here: a Junior Full-Stack Developer job and a fresh graduate's CV");
let end = say("paste");
await sleep(1500);
await click("button:has-text('Load sample')");
await sleep(1200);
await page.evaluate(() => document.querySelectorAll("textarea").forEach((t) => t.scrollTo({ top: 260, behavior: "smooth" })));
await until(end, 2500);
await caption("One click starts the agent", "Output language: English · Vietnamese · Bangla");
end = say("run");
await sleep(600);
await click("button:has-text('Run agent')");
await until(end);
const runStart = t();

// Follow the agent trace and caption each step as it completes.
const CAPS = [
  [/^Reading/, "Step 1 · Parse — job and CV are read in parallel into structured data", "parse"],
  [/^Analyzing/, "Step 2 · Gap analysis — matched skills, gaps, transferable strengths", "gap"],
  [/^Writing a tailored CV/, "Step 3 · Writer agent drafts a tailored CV (original is scored with the same rubric)", "draft"],
  [/^Critic agent reviewing draft #1/, "Step 4 · A separate critic agent scores the draft and fact-checks every claim", "critic1"],
  [/^Critic agent reviewing draft #[2-9]/, "Critic re-checks the revised draft", "critic2"],
  [/^Revising/, "Critic found problems → writer revises with minimal edits", "revise"],
  [/^Selecting/, "Agent keeps the best draft: no fabrication first, then highest score", "select"],
  [/^Writing cover letter/, "Step 5 · Cover letter + predicted interview questions", "extras"],
];
await page.waitForSelector(".grid", { timeout: 60000 }).catch(() => {});
await sleep(400);
await scrollIntoView(".grid", 16);
await caption("The agent works through a multi-step workflow — watch the live trace", "Waiting on the model is sped up in this video");
await until(say("trace"), 800);
let seen = 0, idleFrom = t();
while (true) {
  const done = await page.evaluate(() => [...document.querySelectorAll(".timeline li.done, .timeline li.error")].map((li) => ({
    label: li.querySelector(".step-label")?.firstChild?.textContent || "",
    detail: li.querySelector(".step-detail")?.textContent || "",
  })));
  const errorBox = await page.locator(".error").count();
  if (done.length > seen) {
    const now = t();
    if (now - idleFrom > 1) marks.push([idleFrom, now]);
    for (const s of done.slice(seen)) {
      const hit = CAPS.find(([re]) => re.test(s.label));
      await caption(hit ? hit[1] : s.label, s.detail);
      await until(hit ? say(hit[2]) : t(), 2500);
    }
    seen = done.length;
    idleFrom = t();
  }
  const finished = await page.evaluate(() => !document.querySelector("button.primary")?.textContent?.includes("working"));
  if (finished) break;
  if (errorBox) break;
  await sleep(300);
}
const runEnd = t();
if (await page.locator(".error").count()) {
  console.error("AGENT ERROR:", await page.locator(".error").innerText());
}

// Results walkthrough
await caption("Match report — same rubric before and after", "Original CV vs. tailored CV, plus the critic's verdict");
end = say("report");
await scrollIntoView(".results");
await until(end, 3000);
await caption("Real gaps, with concrete ways to close them", "…and transferable strengths the candidate didn't highlight");
end = say("gaps");
await scrollIntoView(".cols", 120);
await until(end, 3000);

await scrollIntoView(".results");
await click(".tabs button:nth-child(2)");
await caption("The tailored CV — rewritten for the role, no invented facts", "Unknown metrics become [X%] placeholders · copy, download, or print to PDF");
end = say("cv");
await sleep(2500);
await smoothScrollTo(await page.evaluate(() => scrollY + 380), 2500);
await until(end, 1000);

await scrollIntoView(".results");
await click(".tabs button:nth-child(3)");
await caption("A targeted cover letter citing real achievements");
await until(say("letter"), 3500);

await click(".tabs button:nth-child(4)");
await caption("Predicted interview questions — including ones that probe the gaps", "Each with a STAR answer outline built from the candidate's real experience");
end = say("prep");
await sleep(2500);
await page.evaluate(() => document.querySelectorAll(".prep details")[1]?.setAttribute("open", ""));
await until(end, 2000);
await caption("");

await cardV(`<h1>◆ HireReady Agent</h1>
  <p>Parse → Gap analysis → Draft → <b>Critic ⇄ Revise loop</b> → Cover letter & interview prep</p>
  <p style="font-size:20px;opacity:.8;margin-top:28px">Next.js · TypeScript · Meta Model API (muse-spark-1.3) · streamed agent trace<br/>Built for the Agentic Hackathon</p>`, 6000, "outro");

await ctx.close();
await browser.close();
mockServer?.close();

const video = fs.readdirSync(OUT).filter((f) => f.endsWith(".webm")).map((f) => path.join(OUT, f))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
fs.writeFileSync(path.join(OUT, "marks.json"), JSON.stringify({ video, duration: t(), runStart, runEnd, idle: marks, voice }, null, 2));
console.log(JSON.stringify({ video, duration: t().toFixed(1), idle: marks.map(([a, b]) => [+a.toFixed(1), +b.toFixed(1)]) }));

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]); }
