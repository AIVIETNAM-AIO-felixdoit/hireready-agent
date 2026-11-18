// Devpost thumbnail + gallery images (3:2, 1800x1200) from the real app,
// replaying a recorded real agent run so no API calls are made.
// Usage: node shots.mjs <outDir> <replay.ndjson>
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const [, , OUT, REPLAY] = process.argv;
fs.mkdirSync(OUT, { recursive: true });
const lines = fs.readFileSync(REPLAY, "utf8").trim().split("\n");
let delay = 0;
const srv = http.createServer(async (req, res) => {
  req.resume();
  res.writeHead(200, { "Content-Type": "application/x-ndjson" });
  for (const l of lines) {
    const e = JSON.parse(l);
    if (delay && e.type === "step" && e.status === "done") await new Promise((r) => setTimeout(r, delay));
    res.write(l + "\n");
  }
  res.end();
}).listen(3999);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1.5, colorScheme: "light" });
const page = await ctx.newPage();
await page.route("**/api/agent", (r) => (r.request().method() === "POST" ? r.continue({ url: "http://localhost:3999/" }) : r.continue()));
const shot = (name) => page.screenshot({ path: path.join(OUT, name) });
const scrollTo = (sel, off = 16) => page.evaluate(([s, o]) => scrollTo(0, document.querySelector(s).getBoundingClientRect().top + scrollY - o), [sel, off]);
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto("http://localhost:3123", { waitUntil: "networkidle" });
await page.click("button:has-text('Load sample')");
await sleep(300);
await shot("02-input.png");

// Mid-run: trace partially done
delay = 7000;
await page.click("button:has-text('Run agent')");
await page.waitForSelector(".timeline li.done >> nth=4", { timeout: 120000 });
await sleep(200);
await scrollTo(".grid");
await sleep(300);
await shot("03-agent-running.png");

await page.waitForSelector(".prep, button.primary:not(:disabled)", { timeout: 120000 });
await page.waitForFunction(() => !document.querySelector("button.primary")?.textContent?.includes("working"));
await sleep(500);
await scrollTo(".grid");
await sleep(200);
await shot("04-match-report.png");
await scrollTo(".cols", 30);
await shot("05-gaps.png");

await scrollTo(".grid");
await page.click(".tabs button:nth-child(2)");
await sleep(300);
await shot("06-tailored-cv.png");
await page.click(".tabs button:nth-child(4)");
await page.evaluate(() => document.querySelectorAll(".prep details")[1]?.setAttribute("open", ""));
await sleep(300);
await shot("07-interview-prep.png");

// Thumbnail + architecture use a small screenshot of the match report as an inset.
await page.click(".tabs button:nth-child(1)");
await scrollTo(".grid");
await sleep(300);
const inset = (await page.screenshot({ type: "jpeg", quality: 88 })).toString("base64");

const base = `*{box-sizing:border-box}body{margin:0;width:1200px;height:800px;overflow:hidden;font-family:"Segoe UI",system-ui,sans-serif;
  background:linear-gradient(135deg,#1e1b4b 0%,#3730a3 55%,#4f46e5 100%);color:#fff}`;

await page.setContent(`<!doctype html><html><head><style>${base}
  .wrap{display:flex;height:100%;padding:70px 64px;gap:40px;align-items:center}
  .l{flex:0 0 470px} .brand{font-size:22px;font-weight:700;opacity:.85;letter-spacing:.04em}
  h1{font-size:64px;line-height:1.05;margin:18px 0 22px;letter-spacing:-.02em}
  p{font-size:25px;line-height:1.4;opacity:.92;margin:0 0 30px}
  .pills{display:flex;flex-wrap:wrap;gap:10px}.pill{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.25);
  padding:8px 14px;border-radius:999px;font-size:18px;font-weight:600}.pill.hl{background:#fff;color:#3730a3}
  .r{flex:1;position:relative}.r img{width:100%;border-radius:14px;box-shadow:0 30px 70px rgba(0,0,0,.45);transform:rotate(1.5deg)}
  .badge{position:absolute;left:-26px;bottom:-22px;background:#16a34a;color:#fff;font-weight:700;font-size:20px;padding:12px 18px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.3)}
</style></head><body><div class="wrap"><div class="l">
  <div class="brand">◆ HIREREADY AGENT</div>
  <h1>Tailor your CV.<br/>No made-up facts.</h1>
  <p>An AI agent that rewrites your CV for any job, fact-checks itself, and preps you for the interview.</p>
  <div class="pills"><span class="pill">Parse</span><span class="pill">Gap analysis</span><span class="pill">Draft</span>
  <span class="pill hl">Critic ⇄ Revise</span><span class="pill">Interview prep</span></div>
</div><div class="r"><img src="data:image/jpeg;base64,${inset}"/><div class="badge">✓ Fact-checked by a critic agent</div></div></div></body></html>`);
await sleep(300);
await shot("01-thumbnail.png");

await page.setContent(`<!doctype html><html><head><style>${base}
  .wrap{padding:60px 64px}h2{font-size:44px;margin:0 0 8px}.sub{font-size:22px;opacity:.85;margin:0 0 44px}
  .flow{display:flex;align-items:center;gap:14px}.box{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.28);border-radius:16px;
  padding:20px 18px;width:180px;min-height:150px}.box b{display:block;font-size:22px;margin-bottom:8px}.box span{font-size:16px;opacity:.88;line-height:1.4}
  .box.k{background:#fff;color:#1e1b4b;width:230px}.arr{font-size:30px;opacity:.7}
  .loop{margin:34px 0 0 0;display:flex;gap:24px}.card{flex:1;background:rgba(0,0,0,.2);border-radius:16px;padding:22px 24px;font-size:19px;line-height:1.5}
  .card b{font-size:21px}
</style></head><body><div class="wrap">
  <h2>How the agent works</h2><p class="sub">Every step streams live to the UI · Meta Model API (muse-spark-1.3) · Next.js on Vercel</p>
  <div class="flow">
    <div class="box"><b>1 · Parse</b><span>Job + CV → structured data, in parallel</span></div><div class="arr">→</div>
    <div class="box"><b>2 · Gap analysis</b><span>Matched skills, gaps, transferable strengths</span></div><div class="arr">→</div>
    <div class="box"><b>3 · Draft</b><span>Writer agent tailors the CV; original scored on the same rubric</span></div><div class="arr">→</div>
    <div class="box k"><b>4 · Critic ⇄ Revise</b><span>Critic agent scores the draft and flags any claim not in the original CV. Writer revises (max 2 rounds); best draft is kept.</span></div><div class="arr">→</div>
    <div class="box"><b>5 · Prepare</b><span>Cover letter + predicted interview questions</span></div>
  </div>
  <div class="loop">
    <div class="card"><b>Why a critic agent?</b><br/>Prompting a writer "don't invent facts" isn't enough. A separate fact-checker compares every claim with the original CV.</div>
    <div class="card"><b>Stopping rule</b><br/>Stop when score ≥ 85 and 0 fabrication flags, or after 2 revisions. Keep the draft with the fewest flags, then the highest score.</div>
  </div>
</div></body></html>`);
await sleep(300);
await shot("08-how-it-works.png");

await browser.close();
srv.close();
console.log(fs.readdirSync(OUT).join("\n"));
