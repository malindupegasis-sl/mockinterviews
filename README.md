# Mock Interview

Voice-based mock interview practice. You describe the interview you're preparing for, an AI interviewer asks you questions out loud one at a time (with follow-ups), you answer by voice, and at the end you get a structured feedback report.

**Status: Phase 2 (voice).** Visual design, the feedback report and guardrails come in later phases.

## Stack

- Next.js (App Router, TypeScript, Tailwind)
- Anthropic API (`claude-sonnet-5-5`), called only from server-side API routes
- Speech-to-text: browser Web Speech API (`en-GB`), so **use Chrome or Edge**
- Text-to-speech: ElevenLabs streaming API via a server route, with the browser's built-in `speechSynthesis` as a fallback

## Local setup

Requires Node.js 20+.

```bash
npm install
cp .env.example .env.local   # then fill in the keys
npm run dev
```

Open http://localhost:3000 in Chrome or Edge and allow microphone access when asked. (Browsers only allow the mic on `localhost` or HTTPS.)

## Using it

- **Answering:** tap the round mic button (or press **Space**) to start talking, and tap again (or press **Space**) to stop. Your answer is sent when you stop, and your words appear live while you speak.
- The mic is disabled while the interviewer is speaking.
- **Typing instead:** the text box under the mic always works, in case the mic doesn't. Enter sends.
- **Voice:** if ElevenLabs isn't configured, or a request to it fails, the app switches to your browser's built-in voice. A "Browser voice" picker then appears in the top bar (English GB/US voices), and your choice is remembered.

## Choosing an ElevenLabs voice (deep, calm, American male)

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
| `lib/prompts.ts` | **All system prompts.** Edit here to change interviewer behaviour. |
| `app/api/interview/route.ts` | Validates the request, sends the transcript + system prompt to Claude, streams the reply back as plain text. |
| `app/api/tts/route.ts` | `GET`: is ElevenLabs configured? `POST`: proxies ElevenLabs streaming TTS (audio/mpeg). |
| `lib/tts.ts` | ElevenLabs model and voice settings. |
| `lib/anthropic.ts` | Server-side Anthropic client and model name. |
| `lib/sentences.ts` | Splits streaming text into sentences. |
| `lib/speech/Speaker.ts` | Ordered TTS playback queue + browser-voice fallback. |
| `lib/speech/useSpeechRecognition.ts` | Push-to-talk speech recognition hook. |
| `lib/completion.ts` | Detects and hides the `[INTERVIEW_COMPLETE]` token. |
| `components/InterviewScreen.tsx` | Interview UI: transcript, mic button, text fallback. |
| `components/SetupForm.tsx` | Setup screen (context + number of questions). |
| `components/VoicePicker.tsx` | Browser-voice picker for the fallback. |

## Environment variables

See `.env.example`.

| Variable | Needed from | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | Phase 1 | Required. |
| `ELEVENLABS_API_KEY` | Phase 2 | Optional: without it the browser voice is used. |
| `ELEVENLABS_VOICE_ID` | Phase 2 | Optional: see "Choosing an ElevenLabs voice". |
| `ACCESS_CODE` | Phase 5 | |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Phase 5 | Optional. |
