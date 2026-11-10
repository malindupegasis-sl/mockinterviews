/**
 * Incrementally extracts one top-level string field from a JSON object that is
 * still streaming in, so its value can be spoken before the JSON is complete.
 *
 *   const s = new JsonStringFieldStream("text");
 *   s.push('{"action":"follow_up","te');  // → ""
 *   s.push('xt":"What did you');           // → "What did you"
 *   s.push(' do?"}');                      // → " do?"
 */
export class JsonStringFieldStream {
  private raw = "";
  private start = -1; // index in `raw` where the string value begins
  private pos = 0; // next unread index inside the value
  private done = false;

  constructor(private field: string) {}

  /** Feed the next chunk; returns any newly decoded characters of the field's value. */
  push(chunk: string): string {
    this.raw += chunk;
    if (this.done) return "";
    if (this.start < 0) {
      const m = new RegExp(`"${this.field}"\\s*:\\s*"`).exec(this.raw);
      if (!m) return "";
      this.start = this.pos = m.index + m[0].length;
    }
    let out = "";
    while (this.pos < this.raw.length) {
      const c = this.raw[this.pos];
      if (c === '"') {
        this.done = true;
        break;
      }
      if (c !== "\\") {
        out += c;
        this.pos++;
        continue;
      }
      // Escape sequence: wait until it's complete.
      const next = this.raw[this.pos + 1];
      if (next === undefined) break;
      if (next === "u") {
        const hex = this.raw.slice(this.pos + 2, this.pos + 6);
        if (hex.length < 4) break;
        out += String.fromCharCode(parseInt(hex, 16));
        this.pos += 6;
        continue;
      }
      const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };
      out += map[next] ?? next; // \" \\ \/ and friends map to themselves
      this.pos += 2;
    }
    return out;
  }

  /** The complete raw JSON received so far. */
  get json(): string {
    return this.raw;
  }
}
