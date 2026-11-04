# News Shorts — developer notes

Everything a developer (or a fresh coding session) needs to continue the project: why it's built this way, how to run it, what's configured, what's broken, and what's next.

---

## 1. Approach analysis: how do we make "Shorts for news" cheaply?

Goal: a vertical, swipeable feed of 60–90 second narrated explainers that *feels* like Shorts/Reels, refreshed several times a day across 7 tracks (≈20–30 stories per refresh).

| Approach | Cost per 75 s short* | Quality | Feasibility / risk |
|---|---|---|---|
| **A. Generative AI video** (Veo, Sora, Runway, Kling, Luma) | **~$10–$55** (published API prices have been roughly $0.15–$0.75 per generated second; clips are 5–10 s, so a 75 s short needs 8–15 stitched clips) | Looks impressive, but **invents footage of real events**: synthetic "news footage" is a misinformation risk and would mislead viewers. Text/numbers in frames are unreliable. | Minutes of render time per clip, strict quotas, no meaningful free tier. 25 shorts × 4 refreshes/day ≈ **$1,000–$5,000/day**. Not viable for v1, and editorially wrong for news. |
| **B. AI presenter avatar** (HeyGen, D-ID, Synthesia) | ~$1–$4 per minute on paid plans; free tiers are a few minutes per month with watermarks | Talking head is familiar but uncanny; still needs visuals for numbers/maps | Free tiers can't sustain a daily feed. |
| **C. Narrated animated story cards (chosen)** | **≈ $0** — LLM script + TTS on free tiers; visuals rendered *in the browser* | Kinetic captions, count-up numbers, charts, a spinning globe and timelines are *more informative* than stock footage, and every pixel is derived from verified text. Natural voice from Gemini TTS. | Fully feasible on free tiers. Audio files are ~450 KB each (48 kbps MP3). No publisher imagery used. |
| D. Stock footage/photos (Pexels/Pixabay APIs) + TTS | Free with attribution | Generic B-roll rarely matches a specific story; it reads as filler | Easy add-on for motion backgrounds later; low value. |
| E. AI-generated illustrations per scene (Gemini image models) | Free tier exists but is small | Photoreal images of real events are misleading; abstract art is OK but slow and adds little | Possible later for *abstract* section art only. |
| F. Server-rendered MP4 of the cards (Remotion / ffmpeg) | Compute only (free on GitHub Actions) | Same look as C, but exportable to real YouTube Shorts / Reels | Good **v2** feature: reuse the same scene data. Remotion requires a company licence above a small team size. |
| G. Audio-only "news podcast" | ≈ $0 | Cheapest; loses the visual hook | Falls out of C for free (the narration files exist). |

\*Video prices change quickly; figures are order-of-magnitude, from last-known public API pricing, and should be re-checked before relying on them.

**Decision:** build **C** (narrated animated cards rendered client-side) with real-time caption sync, generated visuals, and Gemini TTS + Web Speech fallback. It's essentially free, fast to refresh, accessible (captions are the primary channel), editorially safe (no fabricated footage), and leaves a clean path to **F** (MP4 export) later.

### Free-tier reality check (verified 2026-11-04 with the provided keys)

- `models` list on the Gemini API showed these TTS models: `gemini-3.8-flash-tts`, `gemini-3.8-flash-lite-tts`, `gemini-3.1-flash-tts-preview`, `gemini-2.5-flash-preview-tts`, `gemini-2.5-pro-preview-tts`. The 3.8 models return `audio/wav` directly; 2.5 returns raw 24 kHz PCM (we handle both).
- In practice the free key produced **5 narrations on `gemini-3.8-flash-lite-tts` and 3 on `gemini-3.8-flash-tts`** before HTTP 429, and `gemini-2.5-flash-preview-tts` was already 429. Google's rate-limit page is ambiguous on daily TTS caps; community reports mention ~10 requests/day for newer TTS models. So: **budget ≈ 8–10 narrations/day per key**. The pipeline rotates through the model list, marks a model exhausted on 429, caches audio by content hash, and narrates the highest-ranked stories first. Everything else falls back to the browser's Web Speech API.
- Text: `gemini-3.5-flash-lite` worked reliably (~3 s per script). `gemini-flash-latest`, `gemini-3.5-flash` and `gemini-3.8-flash` returned 503 (overloaded) or 429 during testing. Groq (`openai/gpt-oss-120b`) works as the fallback provider.

---

## 2. Architecture

```
pipeline/ (Node, run by cron)                       src/ (Next.js app, static)
  feeds.ts   ─ outlets per track                       app/page.tsx       ─ feed  (/)
  rss.ts     ─ fetch + parse RSS 2.0 / RDF / Atom      app/catch-up       ─ 3-min playlist
  cluster.ts ─ dedupe, union-find clustering,          app/s/[id]         ─ share deep link
               cross-feed enrichment, ranking          app/saved          ─ saved list
  llm/       ─ provider abstraction (Gemini, Groq)     app/api/shorts     ─ JSON feed
  script.ts  ─ prompt, zod schema, originality         components/        ─ FeedApp, ShortCard, Scene,
               guard, number grounding, mock writer                         GlobeMap, Captions, Sheet…
  tts.ts     ─ Gemini TTS → wav → mp3 (ffmpeg), cache  hooks/usePlayback  ─ one clock, 3 narration engines
  run.ts     ─ orchestrates → data/shorts.json         lib/timeline       ─ caption/word timing
                         + public/audio/*.mp3          lib/playlist       ─ feed order, catch-up selection
                                                       public/sw.js       ─ offline cache (PWA)
```

- **Data contract:** `src/lib/types.ts` (`Short`, `Segment`, `Visual`, …). The pipeline writes `data/shorts.json`; the app reads it at build time (`src/lib/data.ts`) and falls back to `data/mock-shorts.json`.
- **Script safety rails** (`pipeline/script.ts`):
  - the LLM gets only headlines plus ≤500-char RSS snippets, and is told to write original narration;
  - **originality guard:** rejects any 8-word run copied from a source, or more than 12% shared 5-grams; the model is re-prompted with the reason, up to 3 attempts, and the offline writer is the last resort;
  - **number grounding:** on-screen figures, charts and comparisons are dropped unless every number appears in the source text;
  - zod schema validation and a word-count window (120–260 words, aiming for 160–210);
  - politics prompts enforce neutral framing, attribution, and a per-outlet `coverage` list (paraphrased angle, never quoted).
- **Caption sync:** TTS returns no timestamps, so `buildTimeline` spreads the real audio duration over segments and words by "speaking cost" (characters, plus pauses at punctuation, plus extra time for numbers). Web Speech mode speaks one segment at a time. The clock *holds* at segment boundaries until the utterance ends and uses `onboundary` events to refine word position, so captions stay locked to the device voice.
- **Visuals:** kinetic headline, count-up number, bar chart, compare, timeline, and an orthographic globe (d3-geo + Natural Earth `world-atlas`, lazy-loaded) that spins to the story location and highlights the country. Backgrounds are generative per-story colour fields plus grain (CSS only). No publisher photos.

---

## 3. Setup & running locally

Requirements: **Node 22+**, npm. Optional: **ffmpeg** (compresses narration to MP3; otherwise WAV is kept).

```bash
npm install
cp .env.example .env        # add keys (optional — the app runs on the mock dataset without them)
npm run dev                 # http://localhost:3000
```

Pipeline:

```bash
npm run pipeline                       # live: feeds → LLM scripts → TTS → data/shorts.json
npm run pipeline -- --no-tts           # skip narration (device voice fallback)
npm run pipeline -- --tracks=tech,india --max=2
npm run pipeline -- --fresh            # ignore cached scripts (<36 h) and rewrite
npm run pipeline:mock                  # live feeds, no API calls (offline writer)
```

Quality gates: `npm run typecheck`, `npm run lint`, `npm test` (vitest, 39 tests), `npm run build`.

Other scripts: `npm run icons` (re-renders PWA icons with Playwright), `npm run screenshots` (captures README screenshots from a running server; `BASE_URL` overrides the URL).

> **Proxy note:** Node's built-in `fetch` ignores `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21). The npm pipeline scripts set it; harmless when there's no proxy.

### Environment variables

| Variable | Required | Where to get it | Purpose |
|---|---|---|---|
| `GEMINI_API_KEY` | optional (recommended) | <https://aistudio.google.com/apikey> (free) | Scripts (`gemini-3.5-flash-lite`) and narration (Gemini TTS) |
| `GROQ_API_KEY` | optional | <https://console.groq.com/keys> (free) | Fallback LLM (`openai/gpt-oss-120b`) |
| `LLM_PROVIDER` | no | — | `auto` (default: Gemini → Groq), `gemini`, `groq`, `mock` |
| `GEMINI_TEXT_MODEL` | no | — | Comma-separated fallback list; default `gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-2.5-flash-lite` |
| `GROQ_MODEL` | no | — | default `openai/gpt-oss-120b` |
| `TTS_PROVIDER` | no | — | `gemini` (default) or `none` |
| `GEMINI_TTS_MODELS` | no | — | Rotation list; default `gemini-3.8-flash-lite-tts,gemini-3.8-flash-tts,gemini-3.1-flash-tts-preview,gemini-2.5-flash-preview-tts` |
| `GEMINI_TTS_VOICE` | no | — | Prebuilt voice, default `Kore` |
| `TTS_MAX_PER_RUN` | no | — | Narration budget per run (default 10; CI uses 4) |
| `PIPELINE_MAX_STORIES_PER_TRACK` | no | — | default 4 |
| `NEWS_SHORTS_DATA` | no | — | `mock` forces the app to use `data/mock-shorts.json` |

No keys? Everything still works: the app ships with `data/mock-shorts.json` (21 real, AI-written shorts from 2026-11-04; 8 with Gemini narration), and the pipeline's offline writer produces link-out cards with no API calls.

---

## 4. Deploying (free tiers)

**App — Vercel Hobby (recommended):** import the repo, framework preset Next.js, no env vars needed at build (the pipeline runs separately). Every push to `main` redeploys. Netlify or Cloudflare Pages also work: every route is prerendered statically.

**Scheduled pipeline — GitHub Actions** (`.github/workflows/pipeline.yml`):
1. Repo → Settings → Secrets and variables → Actions → add `GEMINI_API_KEY` and (optionally) `GROQ_API_KEY`.
2. Settings → Actions → General → Workflow permissions → **Read and write**.
3. The workflow runs every 6 hours (and on demand via *Run workflow*), commits `data/shorts.json` + new MP3s to the default branch, which triggers a redeploy.

Free-minute budget: each run is ~3–6 minutes; public repos have unlimited minutes, private repos get 2,000/month (4 runs/day × 5 min × 30 ≈ 600 min).

CI (`.github/workflows/ci.yml`) runs typecheck, lint, tests and build on PRs.

---

## 5. Known issues & limitations

- **TTS quota is tiny** (~8–10/day/key). Most shorts use the device voice. Ideas: let users tap "Generate AI voice" on demand (server route), add another free TTS (e.g. Groq's `canopylabs/orpheus-v1-english` showed up in the models list — untested), or pre-narrate only the catch-up playlist.
- **Caption timing is estimated**, not forced-aligned. It's usually within a few hundred ms, but drift can reach ~1 s on number-heavy sentences. Fix: run Whisper (Groq `whisper-large-v3-turbo` supports word timestamps) on each MP3 in the pipeline and store word timings.
- **Clustering is lexical** (token Jaccard + union-find). It under-merges paraphrased headlines, so many stories cite 1–2 outlets. Next step: embeddings (`gemini-embedding-001`) with cosine similarity.
- **Committing MP3s to git** grows the repo (~4 MB per full refresh; the pipeline prunes files that are no longer referenced, but history keeps them). For production, move audio to free object storage (Cloudflare R2 free tier / Supabase storage) and store only URLs.
- **Web Speech quality varies by device**: iOS and Android have good voices, some Linux browsers have robotic ones or none at all. Without a voice, the short plays in captions-only mode.
- **Autoplay policy:** browsers need a tap before sound, so there is a "Tap to play" gate on first load. After that, autoplay continues as you swipe.
- Some feeds are rate-limited or block bots (CNBC 403 and Phys.org 429 were replaced with NPR). Failing feeds are logged and skipped.
- iOS Safari's `speechSynthesis.pause()` is unreliable, so pausing cancels and the current segment restarts on resume.

---

## 6. Decisions

- **Branch:** the brief asked for `claude/v1`. This cloud session is provisioned to push only to `claude/news-shorts-pwa-bs4t1d`, so all work is on that branch and the PR targets `main` from it.
- **Next.js 16.4 (latest stable) + React 19, TypeScript 6, ESLint 9 flat config**, Vitest 5. All pages are statically prerendered from the JSON dataset, so it's cheap to host and works offline.
- **Fonts self-hosted** via `@fontsource` (Bricolage Grotesque variable + JetBrains Mono) instead of `next/font/google`, so builds don't need Google Fonts network access and the PWA works offline.
- **Design direction** ("vibrant", after vibrant.design's curated gallery style): near-black ink canvas; one saturated two-colour gradient identity per track; a heavy, condensed variable grotesque for kinetic type; mono for metadata; a karaoke caption pill in the track accent. Desktop shows the feed in a phone-shaped frame with an ambient glow in the current track colour.
- **Catch me up in 3 minutes** plays the first 4 beats of each story (the hook plus what happened, ~30–40 s). It leads with the top story from each chosen track, then fills greedily up to 3 minutes. A "Full story" button continues the current short. Playing full 75 s shorts would fit only 2 stories, which defeats the purpose.
- **Visual hold:** a segment with no visual keeps the previous visual on screen, avoiding flicker between beats.
- **Mock dataset = a frozen real pipeline run** (labelled `mode: "mock"`), not invented news. The deterministic offline writer never paraphrases article text. It shows the shortest outlet headline as the topic and links out.
- **Script caching:** the pipeline reuses a story's script if it's under 36 hours old (cluster IDs are stable hashes of the member URLs), and audio is cached by a hash of the text and voice. This saves quota on 6-hourly runs.
- **Coverage comparison** is generated for every multi-outlet story, but labelled "How outlets framed it" for politics. It's paraphrased and links to each outlet.
- **No user accounts:** tracks, saved items, seen items and preferences live in `localStorage` (per device). Share uses the Web Share API and falls back to copying a `/s/[id]` deep link.
- **Feed sources:** BBC, Guardian, NPR, Al Jazeera, DW, The Verge, Ars Technica, TechCrunch, ESPN, BBC Sport, MarketWatch, Politico, Fox News, The Hindu, Indian Express, NDTV, Times of India, ScienceDaily and NASA. The mix spans editorial leanings so the politics coverage comparison is meaningful.

---

## 7. Blockers & workarounds

| What failed | What I tried | Outcome / what you need to do |
|---|---|---|
| Node `fetch` got HTTP 403 for most feeds in the cloud sandbox, though `curl` worked | Different User-Agents; read the sandbox proxy docs | Node's fetch ignores `HTTPS_PROXY`. Fixed with `NODE_USE_ENV_PROXY=1` in the npm scripts. **Nothing needed** on a normal machine or in GitHub Actions. |
| `gemini-2.5-flash-preview-tts` returned 429 immediately; 3.8 TTS models hit 429 after 5 and 3 calls | Model rotation and per-run exhaustion tracking | 8 shorts narrated today. **You:** run `npm run pipeline` again after the quota resets (midnight Pacific); cached audio is reused. |
| `gemini-flash-latest`, `gemini-3.5-flash`, `gemini-3.8-flash` returned 503/429 | Benchmarked models | Using `gemini-3.5-flash-lite` (reliable), with Groq fallback. |
| flash-lite wrote scripts that were too short (~100 words) | Stricter prompt; rejection feedback loop | Fixed by prescribing an 8-beat structure (hook → what happened → background → why it matters → what's next). Scripts are now 150–210 words / 60–90 s. |
| CNBC RSS 403, Phys.org 429 | — | Replaced with NPR Business / NPR Science feeds. |

---

## 8. Progress

### Done
- Approach analysis and architecture (this file).
- Pipeline:
  - RSS/Atom/RDF ingest across 7 tracks and 30+ feeds;
  - dedupe, clustering, cross-feed enrichment and ranking;
  - Gemini/Groq LLM abstraction with retries and fallback;
  - original-script generation with originality guard, number grounding and schema validation;
  - Gemini TTS with model rotation, MP3 compression and caching;
  - offline writer;
  - audio pruning.
- App:
  - vertical snap feed with autoplay and auto-advance;
  - 3 narration engines (Gemini audio, device voice, silent) on one clock;
  - karaoke captions;
  - 6 visual scene types including the generated globe map;
  - generative motion backgrounds;
  - "Why it matters", "New to this?", outlet coverage and sources sheet;
  - save, share, mute and captions toggles;
  - keyboard shortcuts;
  - track onboarding and picker;
  - catch-up 3-minute playlist;
  - saved page and share deep links;
  - PWA manifest, icons and service worker (offline shell, feed and audio).
- Mock dataset (21 shorts, 8 narrated).
- Tests: 39 vitest tests covering RSS parsing, clustering, the script guards, timeline, playlist, the LLM fallback and WAV helpers. Typecheck and lint are clean; the production build passes.
- GitHub Actions: scheduled pipeline (every 6 h, commits data) and CI.

- README with real screenshots (`docs/screenshots`, captured via `npm run screenshots`) and a Mermaid architecture diagram.
- PR opened from `claude/news-shorts-pwa-bs4t1d` to `main` (not merged).

### In progress
- Nothing. v1 is complete; pick up from "Next" below.

### Next (roadmap)
1. Forced alignment with Groq Whisper word timestamps for exact captions.
2. Embedding-based clustering to get more multi-outlet stories.
3. On-demand AI narration route plus audio on object storage instead of git.
4. MP4 export of shorts (Remotion/ffmpeg) for posting to YouTube Shorts / Reels.
5. Per-user language and voice choice (Hindi narration for the India track: Gemini TTS supports it).
6. "Seen" sync and push notifications for breaking stories.
