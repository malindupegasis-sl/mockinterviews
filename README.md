# Mock Interview

Voice-based mock interview practice. You describe the interview you're preparing for, an AI interviewer asks you questions out loud one at a time (with follow-ups), you answer by voice, and at the end you get a structured feedback report.

**Status: Phase 4 (feedback report).** Guardrails and deployment come in Phase 5.

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

See `.env.example`.

| Variable | Needed from | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | Phase 1 | Required. |
| `ELEVENLABS_API_KEY` | Phase 2 | Optional. ElevenLabs is used only if both of these are set. |
| `ELEVENLABS_VOICE_ID` | Phase 2 | Optional. See "Choosing an ElevenLabs voice". |
| `ACCESS_CODE` | Phase 5 | |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Phase 5 | Optional. |

## Model settings

Both routes use `claude-sonnet-5-5` (`lib/anthropic.ts`). The interviewer runs at `effort: "low"` for fast conversational turns (Hard-mode decision turns add a JSON schema). Feedback runs at `effort: "high"`, because quality matters more than speed there, so a report can take up to a minute.

## Troubleshooting feedback

Every feedback request prints `[feedback]` lines in the terminal running `npm run dev` (on Vercel, in the function logs):

| Line | Meaning |
|---|---|
| `[feedback] full report: reviewing 14 turns (medium)…` | Request started. |
| `[feedback] full report OK in 24.1s (input …, output … tokens)` | Success. |
| `[feedback] … FAILED …: Anthropic API 401 AuthenticationError …` | Bad or missing `ANTHROPIC_API_KEY`. Check `.env.local` and restart the dev server. |
| `… FAILED …: Anthropic API 429 RateLimitError …` | Rate limited or out of credit. Wait, or check your Anthropic console. |
| `… FAILED …: Anthropic API 400 BadRequestError …` | The request was rejected. The message says why. Include the request id if you report it. |
| `… FAILED …: Anthropic API connection APIConnectionError …` | No network route to the Anthropic API. |
| `… UNUSABLE …: hit max_tokens before finishing` | The report was too long to finish. Try fewer questions. |
| `… UNUSABLE …: model declined (…)` | The model refused (rare). The category is shown in brackets. |
| `… cancelled after …s (the browser left the page)` | You navigated away mid-review. Harmless. |

If nothing prints at all, the browser never reached `/api/feedback`. Check the browser console and Network tab.
