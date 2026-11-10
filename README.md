# Mock Interview

Voice-based mock interview practice. You describe the interview you're preparing for, an AI interviewer asks you questions out loud one at a time (with follow-ups), you answer by voice, and at the end you get a structured feedback report.

**Status: Phase 5 (guardrails and deployment).** Access code, rate limits, signed interview state, privacy-safe logging. Deployment steps are below.

## Stack

- Next.js (App Router, TypeScript, Tailwind)
- Anthropic API (`claude-sonnet-5-5`), called only from server-side API routes
- Speech-to-text: browser Web Speech API (`en-GB`), so **use Chrome or Edge**
- Text-to-speech: the browser's `speechSynthesis` (Chrome's Google UK English Male / Female voices) by default. ElevenLabs streaming via a server route is still supported, and is used only if both ElevenLabs env vars are set

## Local setup

Requires Node.js 20+.

```bash
npm install
cp .env.example .env.local   # then fill in the keys
npm run dev
```

Open http://localhost:3000 in Chrome or Edge and allow microphone access when asked. (Browsers only allow the mic on `localhost` or HTTPS.)

Locally, only `ANTHROPIC_API_KEY` is required. If `ACCESS_CODE` is unset, any code (even an empty one) gets you in. If `TURN_SECRET` is unset, a built-in development secret is used. The terminal warns about both. In production both are **required**: without them the API refuses requests.

## Using it

**Setup:** describe the interview (role, company, job description, interview type, seniority). You can also paste your background or CV, which the interviewer uses privately to ask sharper follow-ups; it's never read back. Then pick a mode:

- **Full interview:** uninterrupted, with the full report at the end.
- **Practice:** the interview pauses after each question (once its follow-ups are done) and shows a feedback card: score /5, what worked, the biggest weakness, what a stronger answer would include, and a short rewrite that uses only what you said. Choose **Retry this question** (earlier attempts stay in the transcript, labelled by attempt) or **Next question**. At the end you can still get the full report, based on your final attempt at each question.

**Difficulty:**

| Level | Follow-ups per question | Notes |
|---|---|---|
| Easy | none | One interviewer turn per question. |
| Medium (default) | exactly one | |
| Hard | 0–2, chosen by the model | Tougher (still professional) interviewer; stricter feedback scoring. The server forces the question to end after the 2nd follow-up. |

Question 1 is always a "tell me about yourself / walk me through your background" variant.

## Browser support

| Browser | Voice answers | Interviewer voice |
|---|---|---|
| Chrome / Edge (desktop) | Yes | Google UK English Male / Female (Chrome), Microsoft voices (Edge) |
| Safari 14.1+ (Mac) | Yes (`webkitSpeechRecognition`) | Best British voice on the Mac, e.g. Daniel or Serena |
| iPhone / iPad (any browser: all use Safari's engine) | Usually yes (Safari 14.1+, needs Dictation enabled) | Best British voice on the device |
| Firefox | No, typed answers are the main input | Best English voice available |

Safari and iOS details:
- **Audio unlock:** iOS blocks speech and Web Audio until a tap. "Start interview" (and "Practise again") unlock audio inside the tap, so the first question plays.
- **Microphone permission:** if it's blocked, the app explains where to allow it (Safari > Settings for This Website on Mac; Settings > Safari > Microphone on iPhone). "Speech recognition is turned off" means Dictation is disabled.
- **Listening that stops early:** Safari can end recognition by itself. If it can't be resumed, listening stops, your words so far go into the type box, and the mic button resets.
- **Your trace:** on Safari/iOS the dim waveform while you speak follows the recognised words instead of opening the microphone a second time.
- **Voices:** the picker lists the device's good English voices, British first, and skips novelty voices. On iPhone you can download better voices under Settings > Accessibility > Spoken Content > Voices > English, e.g. "Daniel (Enhanced)".

## How the interview structure works

The **server** controls the interview, not the model. Each interviewer turn carries metadata issued by the server: what kind of turn it was, which question, follow-ups used, and the instruction that produced it. The browser sends that back with the conversation. On every request `lib/interviewFlow.ts` rebuilds the state from it, checks it against the difficulty rules, and decides what happens next. The model then gets one explicit instruction as a system message, such as "Ask main question 3 of 6", "Ask exactly one follow-up", or "Deliver the closing line". It never counts questions or decides when the interview ends. In practice mode the server pauses after every finished question with a fixed "Thank you." (no model call).

On Hard, each turn after an answer returns a structured `{ action: "follow_up" | "question_done", text }`. The spoken `text` is streamed out of the JSON as it arrives, so voice latency doesn't change.

**Debug strip (local dev only):** under `npm run dev` a small readout in the bottom-right corner shows the difficulty, the question number, follow-ups used and the last action. It never appears in production builds. The terminal also prints one `[interview]` line per turn.

**Feedback report** (after **Get feedback**): an overall score /10 and a two-sentence verdict; per question, a one-line summary, score /5, the biggest weakness, what a stronger answer would include, and your actual answer (collapsed); a rewrite of your weakest answer using only facts you stated; and the top three patterns to fix. Use **Copy report**, **Practise again with the same context**, or **New interview**. Feedback isn't spoken aloud.

- **Answering:** tap the round mic button (or press **Space**) to start talking, and tap again (or press **Space**) to stop. Your answer is sent when you stop, and your words appear live while you speak.
- The mic is disabled while the interviewer is speaking.
- **Typing instead:** the text box under the mic always works, in case the mic doesn't. Enter sends.
- **Interrupting:** press **Space** or tap **Skip** while the interviewer is speaking to cut them off and take your turn.
- **Voice:** choose *Google UK English Male* (default) or *Female* on the setup screen or in the top bar. Your choice is remembered. These voices exist only in Chrome. In other browsers the app uses another en-GB (or English) voice and shows "For the best voice, use Chrome."
- **Transcript:** hidden by default. Use **Show transcript** at the bottom, and lines type out as they arrive.

## The visualiser

The red trace in the middle shows whose turn it is:

| State | Trace | Status readout |
|---|---|---|
| Waiting for you | flat line, slow breathing glow | YOUR TURN |
| Interviewer thinking | flat line, gentle brightness pulse | PROCESSING |
| Interviewer speaking | bright red waveform following the speech | SPEAKING |
| You speaking | dimmer, desaturated waveform driven by your mic | LISTENING |

Browser speech exposes no audio stream, so the interviewer's waveform is driven by a **simulated amplitude** (`lib/viz/amplitude.ts`). Each word makes a pulse with a quick rise and a decay. The pulses are timed from the utterance's `boundary` events, or estimated from the text when the voice doesn't fire them (Chrome's Google voices may not). If ElevenLabs is turned on, a real `AnalyserNode` on the playback drives it instead. Both are plugged in through the same `AmplitudeSource` interface. With *reduce motion* enabled in your OS, the trace is a static glowing line.

## Optional: ElevenLabs voices

Browser speech is the default. To use ElevenLabs instead, set **both** `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`. If a sentence fails, it's retried once. Auth or quota errors switch to browser speech immediately.

### Choosing an ElevenLabs voice (deep, calm, American male)

1. Sign in at [elevenlabs.io](https://elevenlabs.io) and open **Voices → Voice Library** (sometimes labelled "Explore").
2. Filter by **Gender: Male**, **Accent: American**, and **Age: Middle-aged** or **Old** (these tend to sound deeper). Category filters such as *Narrative & Story*, *Conversational* or *Informative & Educational* tend to produce calm, even delivery. You can also search for words like "deep", "calm" or "baritone".
3. Preview a few. Listen for a low pitch, a steady pace and little emotional swing. Avoid voices described as "energetic" or "excited".
4. Click **Add to my voices** (or **Add to VoiceLab**) on the one you like.
5. Under **My Voices**, open the voice's menu (⋯) and choose **Copy voice ID**. It's a string of about 20 letters and digits.
6. Put it in `.env.local` (or in Vercel's environment variables):
   ```
   ELEVENLABS_VOICE_ID=<the ID you copied>
   ```
7. Restart `npm run dev`.

The exact menu names on ElevenLabs change from time to time. If you can't find "Copy voice ID", the ID is also shown on the voice's details page, and `GET https://api.elevenlabs.io/v1/voices` (with your `xi-api-key` header) lists every voice in your account with its `voice_id`.

If speech still comes from the browser voice after you've set the ID, check the server log for an `[tts] ElevenLabs error` line. A 401 means a bad API key. A 4xx on a Voice Library voice can mean your ElevenLabs plan doesn't allow that voice over the API.

Voice settings and the model (`eleven_flash_v2_5`, chosen for low latency) are in `lib/tts.ts`: stability 0.7, similarity 0.6, style 0.1, speed 0.95.

## How the low-latency voice pipeline works

1. Claude's reply streams from `/api/interview`.
2. As the text arrives, `lib/sentences.ts` cuts out each completed sentence.
3. Each sentence is sent to `/api/tts` right away. Later sentences download while earlier ones play.
4. `lib/speech/Speaker.ts` plays the clips strictly in order through Web Audio. Each request includes the earlier sentences so intonation flows naturally between clips.
5. When the last clip finishes, it's your turn and the mic is enabled.

## Project layout

| Path | What it does |
|---|---|
| `lib/prompts.ts` | **All prompts:** interviewer system prompt and difficulty tones, per-turn directives, per-question and full feedback. |
| `app/api/interview/route.ts` | Validates the request, sends the transcript + system prompt to Claude, streams the reply back as plain text. |
| `app/api/tts/route.ts` | `GET`: is ElevenLabs configured? `POST`: proxies ElevenLabs streaming TTS (audio/mpeg). |
| `lib/tts.ts` | ElevenLabs model and voice settings. |
| `lib/anthropic.ts` | Server-side Anthropic client and model name. |
| `lib/sentences.ts` | Splits streaming text into sentences. |
| `lib/speech/Speaker.ts` | Ordered TTS playback queue + browser-voice fallback. |
| `lib/speech/useSpeechRecognition.ts` | Push-to-talk speech recognition hook. |
| `lib/interviewFlow.ts` | **Interview structure:** state from turn metadata, difficulty rules, next step, API message building. |
| `lib/jsonStream.ts` | Streams a string field out of JSON as it arrives (Hard-mode spoken text). |
| `components/DebugStrip.tsx` | Dev-only state readout. |
| `lib/server/access.ts` | Access-code check used by every API route. |
| `lib/server/ratelimit.ts` | Per-IP daily limits (Upstash REST, or in-memory fallback). |
| `lib/server/turnSigning.ts` | HMAC signing and verification of interview turn records. |
| `lib/server/log.ts` | Privacy-safe error descriptions for logs. |
| `lib/api.ts` | Browser helper: sends the access code, handles a rejected code. |
| `app/api/access/route.ts` | Checks an access code (rate-limited). |
| `components/AccessGate.tsx` | Access-code screen and the "Best in Chrome." footer. |
| `lib/speech/voices.ts` | Google UK voice options, loading, and fallback selection. |
| `lib/viz/amplitude.ts` | Amplitude sources: simulated speech, AnalyserNode, mic. |
| `components/Oscilloscope.tsx` | Canvas trace (60fps, glow, persistence, reduced motion). |
| `components/Transcript.tsx` | Typewriter transcript drawer. |
| `components/MicButton.tsx` | Ring-style push-to-talk button. |
| `components/InterviewScreen.tsx` | Interview UI: trace, status, controls, transcript. |
| `components/SetupForm.tsx` | Setup screen: context, CV, mode, number of questions, voice. |
| `app/api/feedback/route.ts` | Per-question and full-report feedback, as structured JSON (schema-constrained). |
| `lib/feedbackClient.ts` | Browser helpers for `/api/feedback`. |
| `components/QuestionFeedbackCard.tsx` | Practice-mode feedback card. |
| `components/ReportScreen.tsx` | Full feedback report. |
| `components/VoicePicker.tsx` | Voice picker (Google UK English Male / Female). |

## Environment variables

| Variable | Required? | What it's for |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Yes** | Claude API key, from the Claude Console → API keys. |
| `ACCESS_CODE` | **Yes (production)** | The code people type to use the app. Change it to cut off access (see below). |
| `TURN_SECRET` | **Yes (production)** | Random secret (16+ characters) used to sign interview state. Generate with `openssl rand -base64 32`. Changing it invalidates interviews in progress. |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | No | ElevenLabs voice instead of browser speech (both must be set). |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | No | Durable rate limiting. `KV_REST_API_URL` / `KV_REST_API_TOKEN` (Vercel's Upstash integration) also work. |

## Guardrails and privacy

- **Access code:** every API route checks `ACCESS_CODE` on the server. The browser keeps the code in `sessionStorage`, so it's forgotten when the tab closes.
- **Rate limits (per IP, per UTC day):** 5 new interviews, 300 interviewer turns, 60 feedback requests, 1,500 ElevenLabs sentences, and 20 wrong access codes per hour. With Upstash configured the counts are shared and durable. Without it they're kept in memory per server instance, so they reset on restart and aren't shared (a warning is logged). IP addresses are stored only as salted hashes.
- **Turn cap:** an interview never exceeds 40 spoken turns. Close to the cap, the interviewer wraps up and says you're out of time.
- **Signed interview state:** the server is stateless. Each interviewer turn carries a record (question number, follow-ups used, turn type) signed with HMAC-SHA256 using `TURN_SECRET`. The signature also covers the difficulty, mode, question count, the turn's text and position, and the previous signature. The server rejects any history that doesn't verify, so the browser can't change question counts or difficulty, or edit, insert or reorder interviewer turns.
- **Errors:** if a model call fails after an answer, the app says and shows "Sorry, something went wrong. Try that answer again.", withdraws the answer, and gives you the turn back.
- **Privacy:** nothing is stored server-side. There's no database, and request bodies are never logged. The `[interview]` and `[feedback]` log lines contain only counts, timings, statuses and request ids, never the context, CV, questions or answers. API error messages that could echo request content are left out of the logs. Prompts and answers are sent to Anthropic (and spoken text to ElevenLabs, if configured) to generate responses.

## Deploying to Vercel

### 1. Get the code on GitHub
The code lives at `github.com/malindupegasis-sl/mockinterviews`. After local changes:
```bash
git add -A && git commit -m "Describe the change" && git push
```
Once the project is imported (step 2), Vercel redeploys automatically on every push to `main`.

### 2. Import the project
1. Go to vercel.com and sign up with **Continue with GitHub** (the free **Hobby** plan is fine).
2. **Add New… → Project**, find `mockinterviews` and click **Import**. If it isn't listed, use **Adjust GitHub App Permissions** to give Vercel access to that repo.
3. Leave the framework preset as **Next.js** and the build settings as default.
4. Open **Environment Variables** and add `ANTHROPIC_API_KEY`, `ACCESS_CODE` and `TURN_SECRET` (plus any optional ones from the table above).
5. Click **Deploy**. After a minute or two you get a URL like `mockinterviews-xxxx.vercel.app`. That's the app.

### 3. Optional: durable rate limits with Upstash
In the Vercel project, open **Storage** (or the **Marketplace**), add **Upstash Redis** (free tier) and connect it to this project. That adds `KV_REST_API_URL` / `KV_REST_API_TOKEN` automatically. Redeploy. Alternatively, create a database at upstash.com and paste its REST URL and token as `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`.

### 4. Set a monthly spend limit in the Claude Console
In the Claude Console (platform.claude.com), go to **Settings → Limits** (on some accounts **Settings → Billing**), find **Spend limits**, and set a monthly limit you're comfortable with. When it's reached, Claude API calls fail (the log shows a 400 mentioning the limit) until the next month or until you raise it. Consider a separate API key just for this app (**API keys → Create key**) so you can revoke it independently. If you use ElevenLabs, its plan has its own monthly character quota.

### 5. Cut off access: change `ACCESS_CODE`
Vercel → your project → **Settings → Environment Variables** → edit `ACCESS_CODE` → save. Environment changes apply only to new deployments, so go to **Deployments**, open the ⋯ menu on the latest one and choose **Redeploy**. Everyone using the old code is sent back to the access screen on their next request. To shut the app off completely, set `ACCESS_CODE` to a long random value nobody has, or revoke the Anthropic API key in the Claude Console.

### 6. Check usage
- **Claude API spend:** Claude Console → **Usage** (tokens and cost by day and model). Interview turns are small, and feedback reports are the bigger calls.
- **Vercel:** project → **Usage** for function invocations and duration. Project → **Logs** for the `[interview]` / `[feedback]` / `[ratelimit]` lines.
- **Upstash** (if used): the database page shows command counts.
- **ElevenLabs** (if used): the subscription page shows characters used.

### Function time limits
On the Hobby plan Vercel functions can run for up to 300 seconds (also the default). The routes declare their own limits: `/api/interview` 60 s (one streamed turn) and `/api/feedback` 120 s (a full report at high effort usually takes well under a minute). Both are within the Hobby limit, so no effort changes were needed.

## Model settings

Both routes use `claude-sonnet-5-5` (`lib/anthropic.ts`). The interviewer runs at `effort: "low"` for fast conversational turns (Hard-mode decision turns add a JSON schema). Feedback runs at `effort: "high"`, because quality matters more than speed there, so a report can take up to a minute.

## Troubleshooting feedback

Every feedback request prints `[feedback]` lines in the terminal running `npm run dev` (on Vercel, in the function logs):

| Line | Meaning |
|---|---|
| `[feedback] full report: reviewing 14 turns (medium)…` | Request started. |
| `[feedback] full report OK in 24.1s (input …, output … tokens)` | Success. |
| `[feedback] … FAILED …: Anthropic API 401 authentication_error …` | Bad or missing `ANTHROPIC_API_KEY`. Check `.env.local` (or the Vercel env vars), then restart or redeploy. |
| `… FAILED …: Anthropic API 429 rate_limit_error …` | Anthropic rate limit. Wait a minute. |
| `… FAILED …: Anthropic API 400 invalid_request_error …` | The request was rejected. If the message mentions a spend limit or credit, see "Set a monthly spend limit". Otherwise note the request id. |
| `… FAILED …: Anthropic API connection APIConnectionError …` | No network route to the Anthropic API. |
| `… UNUSABLE …: hit max_tokens before finishing` | The report was too long to finish. Try fewer questions. |
| `… UNUSABLE …: model declined (…)` | The model refused (rare). The category is shown in brackets. |
| `… cancelled after …s (the browser left the page)` | You navigated away mid-review. Harmless. |
| `[ratelimit] feedback limit reached for one client` | That IP hit the daily feedback limit. |
| `[access] ACCESS_CODE is not set…` / `[interview] TURN_SECRET is not set…` | Add the missing environment variable in Vercel and redeploy. |

If nothing prints at all, the browser never reached `/api/feedback`. Check the browser console and Network tab.
