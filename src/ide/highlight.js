// Syntax colouring for sketches. Splits Arduino-style C++ into tokens, each with a kind the editor colours:
// comment, string, number, preproc, keyword, type, builtin (Arduino functions), constant, object (Serial, display …),
// func (the student's own functions), var (variables), op (operators), punct (brackets, ; and ,).
import { SKETCH_NAMES } from './runtime.js';

const KEYWORDS = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'goto', 'sizeof', 'new', 'delete', 'true', 'false', 'nullptr', 'NULL']);
const TYPES = new Set(['void', 'int', 'long', 'short', 'float', 'double', 'bool', 'boolean', 'byte', 'char', 'String', 'unsigned', 'signed', 'const', 'static', 'volatile', 'auto', 'word', 'size_t',
  'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t', 'Servo', 'DHT', 'Adafruit_SSD1306', 'struct', 'enum', 'class']);
const OBJECTS = new Set(['Serial', 'Wire', 'display']);
const BUILTINS = new Set(SKETCH_NAMES.filter((n) => /[a-z]/.test(n) && !OBJECTS.has(n) && !TYPES.has(n)));
const RE = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)|(^[ \t]*#[^\n]*)|(\b0[xX][0-9a-fA-F]+\b|\b0[bB][01]+\b|\b\d+\.?\d*(?:[eE][-+]?\d+)?[fFuUlL]*\b)|([A-Za-z_]\w*)|([-+*/%=<>!&|^~?:]+)|([()[\]{};,.])|(\s+)|(.)/gm;

/** Tokens for one sketch: [{ text, kind }]. Newlines stay inside whitespace tokens. */
export function tokenize(src) {
  const out = [];
  let m; RE.lastIndex = 0;
  while ((m = RE.exec(src))) {
    const [text, comment, str, pre, num, id, op, punct] = m;
    let kind = null;
    if (comment) kind = 'comment';
    else if (str) kind = 'string';
    else if (pre) kind = 'preproc';
    else if (num) kind = 'number';
    else if (id) {
      const rest = src.slice(RE.lastIndex), call = /^\s*\(/.test(rest), prevDot = out.length && out[out.length - 1].text === '.';
      if (KEYWORDS.has(id)) kind = 'keyword';
      else if (TYPES.has(id)) kind = 'type';
      else if (OBJECTS.has(id)) kind = 'object';
      else if (prevDot) kind = call ? 'method' : 'var';
      else if (BUILTINS.has(id)) kind = 'builtin';
      else if (/^[A-Z][A-Z0-9_]*$/.test(id)) kind = 'constant';
      else if (call) kind = 'func';
      else kind = 'var';
    } else if (op) kind = 'op';
    else if (punct) kind = 'punct';
    out.push({ text, kind });
  }
  return out;
}

/** The same tokens split into lines, so the editor can mark a line (an error) and keep long tokens on their lines. */
export function tokenLines(src) {
  const lines = [[]];
  for (const t of tokenize(src)) {
    const parts = t.text.split('\n');
    parts.forEach((p, i) => { if (i) lines.push([]); if (p) lines[lines.length - 1].push({ text: p, kind: t.kind }); });
  }
  return lines;
}
