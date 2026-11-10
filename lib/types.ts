// Shared between client and server.

export type Role = "user" | "assistant";
export type InterviewMode = "full" | "practice";

/** Practice-mode instruction from the app to the interviewer (sent as a hidden user turn). */
export interface Control {
  type: "next" | "retry" | "finish";
  question: number; // 1-based main question number
}

/** One turn in the conversation. Control turns are hidden from the transcript. */
export interface ChatMessage {
  role: Role;
  content: string;
  control?: Control;
}

export interface InterviewConfig {
  context: string;
  cv: string;
  numQuestions: number;
  mode: InterviewMode;
}

export interface InterviewRequest extends InterviewConfig {
  messages: ChatMessage[];
}

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
  /** Visible transcript turns (no control turns). */
  transcript: { role: Role; content: string }[];
}

export const LIMITS = {
  contextMaxChars: 4000,
  cvMaxChars: 4000,
  answerMaxChars: 5000,
  minQuestions: 1,
  maxQuestions: 15,
  defaultQuestions: 6,
  maxTranscriptTurns: 120,
} as const;
