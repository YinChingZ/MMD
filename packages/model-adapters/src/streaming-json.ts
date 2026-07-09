import type { z } from "zod";

export type ArrayItemHandler = (rawItemJson: string) => void;

type StructuralToken = "{" | "}" | "[" | "]" | "," | ":" | null;
type WatcherMode = "seek_field" | "in_array" | "done";

interface WatcherState {
  buffer: string;
  pos: number;
  depth: number;
  inString: boolean;
  escapeNext: boolean;
  lastStructuralToken: StructuralToken;
  mode: WatcherMode;
  keyCandidateStart: number | null;
  expectColonForField: boolean;
  expectArrayOpenForField: boolean;
  arrayDepth: number;
  itemStart: number | null;
}

function initState(): WatcherState {
  return {
    buffer: "",
    pos: 0,
    depth: 0,
    inString: false,
    escapeNext: false,
    lastStructuralToken: null,
    mode: "seek_field",
    keyCandidateStart: null,
    expectColonForField: false,
    expectArrayOpenForField: false,
    arrayDepth: -1,
    itemStart: null,
  };
}

/**
 * Tracks string-escape state and {}/[] nesting depth over a stream of JSON
 * text deltas, and calls `onItem` with the raw JSON substring of each array
 * element of `targetField` the instant it's syntactically complete. Only
 * tracks depth-1 keys (targetField is always a direct field of the response
 * object for every phase this is used with) — never assumes targetField
 * appears first or in any fixed position among its sibling keys, since
 * JSON-mode models don't guarantee key order.
 *
 * Item boundaries are always `{...}` (every phase's array-element schema is
 * a plain object) — "item complete" is defined as the specific `}` that
 * brings depth back down from arrayDepth+1 to arrayDepth, so nested
 * arrays/objects inside one item (e.g. Claim.conditions: string[]) never
 * cause a false positive: their own open/close brackets push depth deeper
 * and return before that point.
 */
export function createArrayItemWatcher(
  targetField: string,
  onItem: ArrayItemHandler
): { feed: (delta: string) => void } {
  const s = initState();

  function feed(delta: string): void {
    s.buffer += delta;
    while (s.pos < s.buffer.length) {
      const ch = s.buffer[s.pos];

      if (s.inString) {
        if (s.escapeNext) {
          s.escapeNext = false;
        } else if (ch === "\\") {
          s.escapeNext = true;
        } else if (ch === '"') {
          s.inString = false;
          if (
            s.mode === "seek_field" &&
            s.keyCandidateStart !== null &&
            s.depth === 1
          ) {
            const key = s.buffer.slice(s.keyCandidateStart + 1, s.pos);
            if (key === targetField) s.expectColonForField = true;
            s.keyCandidateStart = null;
          }
        }
        s.pos++;
        continue;
      }

      if (ch === '"') {
        s.inString = true;
        // A depth-1 string immediately after `{` or `,` is a key candidate;
        // a depth-1 string immediately after `:` is a value — never
        // mistaken for a key even though it's at the same depth.
        if (
          s.mode === "seek_field" &&
          s.depth === 1 &&
          (s.lastStructuralToken === "{" || s.lastStructuralToken === ",")
        ) {
          s.keyCandidateStart = s.pos;
        }
        s.pos++;
        continue;
      }

      if (/\s/.test(ch)) {
        s.pos++;
        continue;
      }

      if (s.mode === "seek_field" && s.expectColonForField && ch === ":") {
        s.expectColonForField = false;
        s.expectArrayOpenForField = true;
        s.lastStructuralToken = ":";
        s.pos++;
        continue;
      }
      if (s.mode === "seek_field" && s.expectArrayOpenForField) {
        s.expectArrayOpenForField = false;
        if (ch === "[") {
          s.depth++;
          s.mode = "in_array";
          s.arrayDepth = s.depth;
          s.lastStructuralToken = "[";
          s.pos++;
          continue;
        }
        // Matched field's value wasn't an array — give up on this match and
        // fall through to normal structural-token handling below so depth
        // tracking stays correct.
      }

      switch (ch) {
        case "{":
        case "[":
          s.depth++;
          if (s.mode === "in_array" && ch === "{" && s.depth === s.arrayDepth + 1) {
            s.itemStart = s.pos;
          }
          s.lastStructuralToken = ch;
          break;
        case "}":
        case "]": {
          const fromDepth = s.depth;
          s.depth--;
          if (
            s.mode === "in_array" &&
            ch === "}" &&
            fromDepth === s.arrayDepth + 1 &&
            s.itemStart !== null
          ) {
            onItem(s.buffer.slice(s.itemStart, s.pos + 1));
            s.itemStart = null;
          }
          if (s.mode === "in_array" && ch === "]" && s.depth === s.arrayDepth - 1) {
            s.mode = "done";
          }
          s.lastStructuralToken = ch;
          break;
        }
        case ",":
          s.lastStructuralToken = ",";
          break;
        case ":":
          s.lastStructuralToken = ":";
          break;
        default:
          break; // digits/true/false/null literal chars — no structural meaning
      }
      s.pos++;
    }
  }

  return { feed };
}

/**
 * Layers zod validation on top of createArrayItemWatcher — parse/validate
 * failures (shouldn't happen given well-formed JSON prefixes, but defensive)
 * are dropped silently. This is a preview only, never the authoritative
 * result: the final full-response callStructured validation is unchanged.
 */
export function createValidatedArrayItemWatcher<T>(
  targetField: string,
  itemSchema: z.ZodType<T, z.ZodTypeDef, unknown>,
  onItem: (item: T) => void
): { feed: (delta: string) => void } {
  return createArrayItemWatcher(targetField, (rawItemJson) => {
    try {
      const result = itemSchema.safeParse(JSON.parse(rawItemJson));
      if (result.success) onItem(result.data);
    } catch {
      // drop — malformed extraction, next item still gets a fresh attempt
    }
  });
}

const ESCAPE_CHARS: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  '"': '"',
  "\\": "\\",
  "/": "/",
};

type StringFieldMode = "seek_field" | "in_value" | "done";

interface StringFieldState {
  buffer: string;
  pos: number;
  depth: number;
  inString: boolean;
  escapeNext: boolean;
  lastStructuralToken: StructuralToken;
  mode: StringFieldMode;
  keyCandidateStart: number | null;
  expectColonForField: boolean;
  expectValueQuoteForField: boolean;
  /** Accumulates a partial escape sequence across feed() calls, e.g. a lone
   * trailing "\" or a "\u12" missing its last two hex digits. */
  pendingEscape: string;
}

/**
 * Sibling to createArrayItemWatcher: finds a top-level string field
 * (key-position-aware, same seek technique) and relays its *unescaped*
 * string-content characters via onChars as they arrive — never the
 * surrounding JSON syntax (quotes, other field names, braces). Stops
 * relaying at the field's own closing (unescaped) quote. No schema
 * validation applies here — a partial prose string can't be meaningfully
 * validated against z.string() mid-stream; the final full text is still
 * validated via the normal callStructured path once the whole response is in.
 */
export function createStringFieldWatcher(
  targetField: string,
  onChars: (text: string) => void
): { feed: (delta: string) => void } {
  const s: StringFieldState = {
    buffer: "",
    pos: 0,
    depth: 0,
    inString: false,
    escapeNext: false,
    lastStructuralToken: null,
    mode: "seek_field",
    keyCandidateStart: null,
    expectColonForField: false,
    expectValueQuoteForField: false,
    pendingEscape: "",
  };

  function decodeEscape(): void {
    const esc = s.pendingEscape;
    if (esc[1] === "u") {
      if (esc.length < 6) return; // wait for the remaining hex digits
      const code = parseInt(esc.slice(2), 16);
      onChars(String.fromCharCode(code));
      s.pendingEscape = "";
      return;
    }
    const decoded = ESCAPE_CHARS[esc[1]];
    onChars(decoded ?? esc[1]);
    s.pendingEscape = "";
  }

  function feedValueChar(ch: string): void {
    if (s.pendingEscape) {
      s.pendingEscape += ch;
      decodeEscape();
      return;
    }
    if (ch === "\\") {
      s.pendingEscape = "\\";
      return;
    }
    if (ch === '"') {
      s.mode = "done";
      return;
    }
    onChars(ch);
  }

  function feed(delta: string): void {
    s.buffer += delta;
    while (s.pos < s.buffer.length) {
      const ch = s.buffer[s.pos];

      if (s.mode === "in_value") {
        feedValueChar(ch);
        s.pos++;
        continue;
      }

      if (s.inString) {
        if (s.escapeNext) {
          s.escapeNext = false;
        } else if (ch === "\\") {
          s.escapeNext = true;
        } else if (ch === '"') {
          s.inString = false;
          if (
            s.mode === "seek_field" &&
            s.keyCandidateStart !== null &&
            s.depth === 1
          ) {
            const key = s.buffer.slice(s.keyCandidateStart + 1, s.pos);
            if (key === targetField) s.expectColonForField = true;
            s.keyCandidateStart = null;
          }
        }
        s.pos++;
        continue;
      }

      if (ch === '"') {
        if (
          s.mode === "seek_field" &&
          s.depth === 1 &&
          (s.lastStructuralToken === "{" || s.lastStructuralToken === ",")
        ) {
          s.keyCandidateStart = s.pos;
        }
        if (s.mode === "seek_field" && s.expectValueQuoteForField) {
          s.expectValueQuoteForField = false;
          s.mode = "in_value";
          s.pos++;
          continue;
        }
        s.inString = true;
        s.pos++;
        continue;
      }

      if (/\s/.test(ch)) {
        s.pos++;
        continue;
      }

      if (s.mode === "seek_field" && s.expectColonForField && ch === ":") {
        s.expectColonForField = false;
        s.expectValueQuoteForField = true;
        s.lastStructuralToken = ":";
        s.pos++;
        continue;
      }
      // Matched field's value wasn't a string (ch would have been handled
      // above if it were an opening quote) — give up on this match and fall
      // through to normal structural-token handling below.
      s.expectValueQuoteForField = false;

      switch (ch) {
        case "{":
        case "[":
          s.depth++;
          s.lastStructuralToken = ch;
          break;
        case "}":
        case "]":
          s.depth--;
          s.lastStructuralToken = ch;
          break;
        case ",":
          s.lastStructuralToken = ",";
          break;
        case ":":
          s.lastStructuralToken = ":";
          break;
        default:
          break;
      }
      s.pos++;
    }
  }

  return { feed };
}
