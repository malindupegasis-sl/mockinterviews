// Shared between client and server.

export type Role = "user" | "assistant";

/** One turn in the visible transcript (plain text only). */
export interface ChatMessage {
  role: Role;
  content: string;
}

export interface InterviewRequest {
  context: string;
  numQuestions: number;
  messages: ChatMessage[];
}

export const LIMITS = {
  contextMaxChars: 4000,
  answerMaxChars: 5000,
  minQuestions: 1,
  maxQuestions: 15,
  defaultQuestions: 6,
} as const;
