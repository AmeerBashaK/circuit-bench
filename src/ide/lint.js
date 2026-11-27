// Beginner-friendly sketch checker. It reads the C++ source before it is translated, so every message points at
// the student's own line: "Line 12: missing ; at the end of the line." It catches the mistakes beginners make
// most (semicolons, brackets, quotes, capital letters) and turns the JavaScript engine's errors into plain words.

const TYPES = /^(?:void|int|long|short|float|double|bool|boolean|byte|char|String|unsigned|signed|const|static|volatile|uint8_t|uint16_t|uint32_t|uint64_t|int8_t|int16_t|int32_t|int64_t|size_t|word|auto)$/;
const KEYWORDS = ['void', 'int', 'long', 'short', 'float', 'double', 'bool', 'boolean', 'byte', 'char', 'String', 'unsigned', 'const', 'static', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'true', 'false', 'setup', 'loop', 'include', 'define', 'Wire', 'Serial'];
const METHODS = ['begin', 'print', 'println', 'printf', 'write', 'available', 'read', 'peek', 'readString', 'readStringUntil', 'parseInt', 'parseFloat', 'flush', 'clearDisplay', 'display', 'setTextSize', 'setTextColor', 'setCursor', 'drawPixel', 'drawLine', 'drawRect', 'fillRect', 'drawCircle', 'fillCircle', 'toInt', 'toFloat', 'length', 'equals', 'attach', 'detach', 'readTemperature', 'readHumidity'];

/** Split source into per-line code with comments and string contents blanked out, plus string/bracket problems. */
function scan(src) {
  const lines = src.replace(/\r/g, '').split('\n');
  const code = [], problems = [], stack = []; // stack of { ch, line, init }
  let inBlock = false;
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const word = { '(': 'bracket (', '[': 'square bracket [', '{': 'curly brace {' };
  lines.forEach((text, i) => {
    const ln = i + 1; let out = '';
    for (let j = 0; j < text.length; j++) {
      const c = text[j], n = text[j + 1];
      if (inBlock) { if (c === '*' && n === '/') { inBlock = false; j++; } out += ' '; continue; }
      if (c === '/' && n === '/') break;
      if (c === '/' && n === '*') { inBlock = true; j++; out += ' '; continue; }
      if (c === '"' || c === "'") {
        let k = j + 1; while (k < text.length && text[k] !== c) k += text[k] === '\\' ? 2 : 1;
        if (k >= text.length && !/^\s*#/.test(text)) { problems.push({ line: ln, msg: `the text in quotes is missing its closing ${c}.` }); out += c + c; j = text.length; break; }
        out += c + ' '.repeat(Math.max(0, k - j - 1)) + c; j = k; continue;
      }
      if (/^\s*#/.test(text)) { out += c; continue; } // #include <...> and #define are not bracket-checked
      if (c === '(' || c === '[' || c === '{') stack.push({ ch: c, line: ln, init: c === '{' && /=\s*$/.test(out) });
      else if (c in pairs) {
        const top = stack[stack.length - 1];
        if (!top) problems.push({ line: ln, msg: `there is an extra ${c} with nothing to close.` });
        else if (top.ch !== pairs[c]) {
          // A stray ) or ] inside a block is just extra; anything else closes the wrong bracket.
          if (top.ch === '{' && c !== '}') problems.push({ line: ln, msg: `there is an extra ${c} with nothing to close.` });
          else { problems.push({ line: ln, msg: `this ${c} does not match the ${word[top.ch]} opened on line ${top.line}.` }); stack.pop(); }
        }
        else stack.pop();
      }
      out += c;
    }
    code.push({ line: ln, text: out, depth: stack.filter((s) => s.ch !== '{' || s.init).length });
  });
  for (const s of stack) problems.push({ line: s.line, msg: `this ${word[s.ch]} is never closed. Add its ${s.ch === '(' ? ')' : s.ch === '[' ? ']' : '}'}.` });
  return { code, problems };
}

/** Lines that need a ; but do not have one. */
function semicolons(code, skip) {
  const out = [], real = code.filter((c) => c.text.trim());
  real.forEach((c, i) => {
    const t = c.text.trim(), next = real[i + 1]?.text.trim() || '';
    if (c.depth > 0 || skip.has(c.line)) return;                                  // inside ( … ) or an array list: the statement goes on
    if (/^#/.test(t)) return;                                  // #include, #define
    if (/[;{},:([\\&|+\-*/%=<>?!^~]$/.test(t)) return;          // already ends, or carries on to the next line
    if (/^(?:if|else|for|while|switch|do)\b/.test(t) || /^}\s*else\b/.test(t)) return; // control lines without braces
    if (/^(?:case\b.*|default\s*):?$/.test(t)) return;
    if (/^[{.)\],?:]|^(?:&&|\|\||[+\-*/%=<>])/.test(next)) return; // next line continues this one, or opens its block
    out.push({ line: c.line, msg: 'missing ; at the end of the line.' });
  });
  return out;
}

/** Known names typed with the wrong capital letters: digitalwrite, serial.println, Delay … */
function capitals(code, known) {
  const out = [], byLower = new Map(known.map((k) => [k.toLowerCase(), k])), declared = new Set(), seen = new Set();
  const all = code.map((c) => c.text).join('\n');
  // Names the student declared are theirs, whatever their case.
  for (const m of all.matchAll(/\b([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(?=[=;,()[])/g)) if (TYPES.test(m[1]) || /^[A-Z]\w*$/.test(m[1])) declared.add(m[2]);
  for (const m of all.matchAll(/#define\s+(\w+)/g)) declared.add(m[1]);
  for (const c of code) {
    for (const m of c.text.matchAll(/[A-Za-z_]\w*/g)) {
      const w = m[0], right = byLower.get(w.toLowerCase());
      if (!right || right === w || declared.has(w) || seen.has(w)) continue;
      seen.add(w);
      out.push({ line: c.line, msg: `write ${right}, not ${w}. Capital letters matter in Arduino code.` });
    }
  }
  return out;
}

/** The text inside a condition's brackets, up to its matching ) (or the end of the line). */
function condition(rest) {
  let d = 1, i = 0;
  for (; i < rest.length; i++) { if (rest[i] === '(') d++; else if (rest[i] === ')' && --d === 0) break; }
  return rest.slice(0, i);
}

/** Things that run but rarely do what was meant. */
function warnings(code) {
  const out = [];
  for (const c of code) {
    const m = /\b(?:if|while)\s*\((.*)/.exec(c.text);
    if (m && /(^|[^=!<>])=([^=]|$)/.test(condition(m[1]))) out.push({ line: c.line, msg: 'this sets a value with = inside the condition. To compare, use ==.' });
    const k = /^\s*(?:if|while)\s*\(/.exec(c.text);
    if (k && /^\s*;/.test(c.text.slice(k[0].length + condition(c.text.slice(k[0].length)).length + 1))) out.push({ line: c.line, msg: 'the ; right after the condition ends it, so the next line always runs. Remove that ;.' });
  }
  return out;
}

/**
 * Check a sketch. `known` lists the function and constant names the simulator provides.
 * Returns { errors, warnings }, each a list of { line, msg }, errors sorted by line.
 */
export function lintSketch(src, known = []) {
  const { code, problems } = scan(src);
  const errors = [...problems, ...semicolons(code, new Set(problems.map((p) => p.line))), ...capitals(code, [...known, ...KEYWORDS, ...METHODS])];
  const all = code.map((c) => c.text).join('\n');
  if (!/\bvoid\s+setup\s*\(/.test(all)) errors.push({ line: 1, msg: 'a sketch needs a void setup() { … } function.' });
  if (!/\bvoid\s+loop\s*\(/.test(all)) errors.push({ line: 1, msg: 'a sketch needs a void loop() { … } function.' });
  errors.sort((a, b) => a.line - b.line);
  return { errors, warnings: warnings(code) };
}

/** Plain-words version of an error the JavaScript engine threw while running a translated sketch. */
export function friendlyError(err, src) {
  const msg = String(err?.message || err);
  let m;
  if ((m = /^(\w+) is not defined/.exec(msg))) return `${m[1]} is not defined. Check its spelling, or declare it before you use it (for example: int ${m[1]} = 0;).`;
  if ((m = /^(?:\w+\.)*(\w+) is not a function/.exec(msg))) return `${m[1]}() is not a function this simulator knows. Check the spelling and the capital letters.`;
  if (/Assignment to constant/.test(msg)) return 'this changes a const or #define value. Remove const if it needs to change.';
  if (/Cannot read properties of undefined|undefined is not/.test(msg)) return 'something here is empty (undefined). Often an array index past its end.';
  if ((m = /Identifier '(\w+)' has already been declared/.exec(msg))) {
    const lines = src.split('\n'), re = new RegExp(`\\b\\w+\\s+${m[1]}\\b\\s*[=;[,]`);
    const hits = lines.map((l, i) => (re.test(l) ? i + 1 : 0)).filter(Boolean);
    return { line: hits[1] || hits[0] || null, msg: `${m[1]} is declared twice. Keep one declaration and just use the name after that.` };
  }
  if (/Maximum call stack/.test(msg)) return 'a function keeps calling itself and never stops.';
  if (err instanceof SyntaxError) return `there is a typo the checker could not pin down (${msg}). Look at the lines you changed last.`;
  return msg;
}
