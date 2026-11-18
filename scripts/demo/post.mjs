// Speeds up idle (waiting-on-model) segments and exports an MP4 for YouTube.
// Usage: node post.mjs <outDir> <final.mp4> [speed=8]
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const [, , OUT, FINAL, SPEED = "8"] = process.argv;
const { video, idle, voice = [] } = JSON.parse(fs.readFileSync(`${OUT}/marks.json`, "utf8"));
const dur = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video]).toString());

// Build alternating normal / fast segments.
const segs = [];
let cur = 0;
for (const [a, b] of idle.filter(([a, b]) => b - a > 1.5)) {
  if (a > cur) segs.push([cur, a, 1]);
  segs.push([a, b, Number(SPEED)]);
  cur = b;
}
segs.push([cur, dur, 1]);

const parts = segs.map(([a, b, s], i) =>
  `[0:v]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=(PTS-STARTPTS)/${s}[v${i}]`);
const filter = parts.join(";") + ";" + segs.map((_, i) => `[v${i}]`).join("") + `concat=n=${segs.length}:v=1:a=0,fps=30[out]`;

// Map a raw-recording time to the final (sped-up) timeline.
const mapT = (x) => {
  let acc = 0;
  for (const [a, b, sp] of segs) {
    if (x <= b) return acc + (Math.max(x, a) - a) / sp;
    acc += (b - a) / sp;
  }
  return acc;
};
const args = ["-y", "-v", "error", "-i", video];
voice.forEach((v) => args.push("-i", v.file));
let fc = filter;
if (voice.length) {
  const delays = voice.map((v, i) => {
    const ms = Math.round(mapT(v.t) * 1000);
    return "[" + (i + 1) + ":a]adelay=" + ms + "|" + ms + ",aformat=sample_rates=48000:channel_layouts=stereo[a" + i + "]";
  });
  fc += ";" + delays.join(";") + ";" + voice.map((_, i) => "[a" + i + "]").join("") +
    "amix=inputs=" + voice.length + ":normalize=0:dropout_transition=0,volume=1.6,apad[aout]";
  args.push("-filter_complex", fc, "-map", "[out]", "-map", "[aout]", "-shortest", "-c:a", "aac", "-b:a", "160k");
} else {
  args.push("-filter_complex", fc, "-map", "[out]");
}
args.push("-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", FINAL);
execFileSync("ffmpeg", args, { stdio: "inherit" });
voice.forEach((v) => console.log("voice", v.id.padEnd(8), "at", mapT(v.t).toFixed(1) + "s"));

const out = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", FINAL]).toString());
console.log(`raw ${dur.toFixed(1)}s -> final ${out.toFixed(1)}s (${segs.filter((s) => s[2] > 1).length} sped-up segments)`);
