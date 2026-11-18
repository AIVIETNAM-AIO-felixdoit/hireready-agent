# Demo recording scripts

These scripts produced the demo video and the Devpost/README images. They drive the real app with Playwright.

Setup, done once, in a separate folder so the app's dependencies stay clean:

```bash
mkdir ../demo-tools && cd ../demo-tools
npm init -y && npm i playwright && npx playwright install chromium
pip install edge-tts          # voice-over (Microsoft neural TTS, free)
# ffmpeg and ffprobe must be on PATH
```

The app must be running at `http://localhost:3123` (`npm run build && npx next start -p 3123`).

| Script | Usage | Output |
| --- | --- | --- |
| `narration.mjs` | `node narration.mjs <voiceDir> [voice]` | One mp3 per line + `narration.json` (default voice `en-US-AndrewNeural`) |
| `record.mjs` | `VOICE_JSON=<voiceDir>/narration.json node record.mjs live <outDir>` | Raw `.webm` + `marks.json` (idle segments and voice timestamps) |
| `record.mjs` (rehearsal) | `node record.mjs mock <outDir> <run.ndjson>` | Same, replaying a saved agent run. **Uses no API calls** |
| `post.mjs` | `node post.mjs <outDir> <final.mp4> [speed=8]` | MP4 with model-wait segments sped up and voice mixed in |
| `shots.mjs` | `node shots.mjs <outDir> <run.ndjson>` | 3:2 images at 1800×1200: thumbnail, screenshots, "how it works" diagram |

To save an agent run as `run.ndjson`, run:

```bash
curl -sN -X POST localhost:3123/api/agent -H "Content-Type: application/json" \
  --data-binary '{"jd":"...","cv":"...","language":"English"}' > run.ndjson
```

Copy the scripts into the folder where Playwright is installed (`cp ../hireready-agent/scripts/demo/*.mjs .`) and run them there. Node resolves `import "playwright"` relative to the script file, not the current folder. Playwright is not in the app's `package.json` on purpose.
