// Shared between client and server.

export type Role = "user" | "assistant";
export type InterviewMode = "full" | "practice";
export type Difficulty = "easy" | "medium" | "hard";

/** Practice-mode instruction from the candidate's buttons (sent as a hidden user turn). */
export type Control = "next" | "retry";

/**
 * What the server told the model to do for one interviewer turn. Stored with the
 * turn and sent back, so the server can rebuild the conversation (and its own
 * instructions) on every request without keeping session state.
 */
export type Directive =
  | { type: "open" } // intro + main question 1
  | { type: "ask"; question: number; after: "answer" | "next" } // main question N
  | { type: "retry"; question: number } // practice: re-ask the same question
  | { type: "follow_up"; question: number } // exactly one follow-up
  | { type: "closing"; after: "answer" | "next" } // closing line
  | { type: "ack" } // practice: fixed "Thank you." (no model call)
  | { type: "hard_decide"; question: number; followUps: number; then: "ask_next" | "closing" | "ack" }; // Hard: model chooses

export type TurnKind = "question" | "follow_up" | "ack" | "closing";

/** Server-issued description of an interviewer turn. */
export interface TurnMeta {
  kind: TurnKind;
  question: number; // main question this turn belongs to
  followUps: number; // follow-ups used on this question, including this turn
  directive: Directive;
  /** Hard mode only: the model's structured decision, and whether the server forced it. */
  action?: "follow_up" | "question_done";
  forced?: boolean;
}

/** One turn in the conversation. Control turns are hidden from the transcript. */
export interface ChatMessage {
  role: Role;
  content: string;
  meta?: TurnMeta; // interviewer turns
  control?: Control; // practice-mode button presses
}

export interface InterviewConfig {
  context: string;
  cv: string;
  numQuestions: number;
  mode: InterviewMode;
  difficulty: Difficulty;
}

export interface InterviewRequest extends InterviewConfig {
  messages: ChatMessage[];
}

/** Events streamed back by /api/interview (newline-delimited JSON). */
export type InterviewEvent =
  | { type: "text"; text: string }
  | { type: "done"; text: string; meta: TurnMeta };

/** Per-question feedback card (practice mode). */
export interface QuestionFeedback {
  score: number; // 1-5
  what_worked: string;
  biggest_weakness: string;
  stronger_answer: string;
  rewrite: string;
}

/** Full end-of-interview report. */
export interface FullReport {
  overall_score: number; // 1-10
  verdict: string;
  questions: {
    question: string;
    answer_turns: number[]; // 1-based indices into the transcript that was sent
    answer_summary: string;
    score: number; // 1-5
    biggest_weakness: string;
    stronger_answer: string;
  }[];
  weakest_answer: { question_index: number; rewrite: string };
  patterns: { title: string; detail: string }[];
}

export interface FeedbackRequest {
  kind: "question" | "full";
  context: string;
  cv: string;
  difficulty: Difficulty;
  /** Visible transcript turns (no control turns). */
  transcript: { role: Role; content: string }[];
}

export const MAX_FOLLOW_UPS: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2 };

export const LIMITS = {
  contextMaxChars: 4000,
  cvMaxChars: 4000,
  answerMaxChars: 5000,
  minQuestions: 1,
  maxQuestions: 15,
  defaultQuestions: 6,
  maxTranscriptTurns: 120,
} as const;
