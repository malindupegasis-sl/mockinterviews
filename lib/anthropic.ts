import Anthropic from "@anthropic-ai/sdk";

// Server-side Anthropic client. Only import this from API routes (app/api/*):
// it reads ANTHROPIC_API_KEY from the environment, which is never sent to the browser.
export const anthropic = new Anthropic();

export const MODEL = "claude-sonnet-5-5";
