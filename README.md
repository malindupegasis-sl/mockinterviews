# Mock Interview

Voice-based mock interview practice. You describe the interview you're preparing for, an AI interviewer asks you questions one at a time (with follow-ups), and at the end you get a structured feedback report.

**Status: Phase 1 (text-only interview loop).** Voice, visual design, the feedback report and guardrails come in later phases.

## Stack

- Next.js (App Router, TypeScript, Tailwind)
- Anthropic API (`claude-sonnet-5-5`), called only from server-side API routes
- Planned: Web Speech API (speech-to-text), ElevenLabs (text-to-speech), Upstash Redis (rate limiting)

## Local setup

Requires Node.js 20+.

```bash
npm install
cp .env.example .env.local   # then set ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000.

## Project layout

| Path | What it does |
|---|---|
| `lib/prompts.ts` | **All system prompts.** Edit here to change interviewer behaviour. |
| `app/api/interview/route.ts` | Validates the request, sends the transcript + system prompt to Claude, streams the reply back as plain text. |
| `lib/anthropic.ts` | Server-side Anthropic client and model name. |
| `lib/completion.ts` | Detects and hides the `[INTERVIEW_COMPLETE]` token. |
| `lib/interviewClient.ts` | Browser helper that reads the streamed reply. |
| `components/SetupForm.tsx` | Setup screen (context + number of questions). |
| `components/InterviewScreen.tsx` | Transcript and answer box. |

## Environment variables

See `.env.example`. Phase 1 only needs `ANTHROPIC_API_KEY`.
