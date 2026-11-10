// Splits streaming text into complete sentences so each can be spoken as soon as it's done.

const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "approx", "inc", "ltd", "co",
]);

// Sentence-ending punctuation, optional closing quotes/brackets, then whitespace.
const BOUNDARY = /[.!?]+["'”’)\]]*\s+/g;

export class SentenceSplitter {
  private consumed = 0;

  /**
   * Pass the full text received so far (it must only ever grow).
   * Returns any sentences completed since the last call.
   */
  push(textSoFar: string): string[] {
    const out: string[] = [];
    BOUNDARY.lastIndex = this.consumed;
    let match: RegExpExecArray | null;
    while ((match = BOUNDARY.exec(textSoFar))) {
      const end = match.index + match[0].length;
      const candidate = textSoFar.slice(this.consumed, end).trim();
      const lastWord = candidate.split(/\s+/).pop()?.replace(/[.!?"'”’)\]]+$/, "").toLowerCase();
      if (lastWord && ABBREVIATIONS.has(lastWord)) continue; // "Dr. Smith" is not a sentence end
      if (candidate) out.push(candidate);
      this.consumed = end;
    }
    return out;
  }

  /** Call once the stream has finished: returns whatever is left over. */
  flush(textSoFar: string): string[] {
    const rest = textSoFar.slice(this.consumed).trim();
    this.consumed = textSoFar.length;
    return rest ? [rest] : [];
  }
}

/**
 * Chrome's Google voices can cut off on long utterances, so split any sentence
 * longer than `max` characters: at the last comma before the limit, else the last space.
 */
export function splitLongSentence(text: string, max = 200): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = window.lastIndexOf(",");
    if (cut < max * 0.25) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = max - 1;
    parts.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}
