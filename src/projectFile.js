// Project files: a whole bench (and, in the Maker IDE, its code) saved to disk as JSON so students can hand
// work in or carry it home. Files come from anywhere, so every reader validates before it touches the app.
const APP = 'circuit-bench';
export const PROJECT_VERSION = 1;
const KIND_NAMES = { simulator: 'Simulator', maker: 'Maker IDE' };

const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };

/** Download `data` as a project file of the given kind. */
export function saveProject(kind, data) {
  const body = JSON.stringify({ app: APP, version: PROJECT_VERSION, kind, saved: new Date().toISOString(), ...data }, null, 1);
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `circuit-bench-${kind}-${stamp()}.cbench` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Ask for a project file and return its parsed contents. Rejects with a message a student can act on
 * when the file is not a project, is from the other mode, or is damaged.
 */
export function openProject(kind) {
  return new Promise((resolve, reject) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.cbench,.json,application/json' });
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      if (file.size > 5e6) { reject(new Error('That file is too big to be a Circuit Bench project.')); return; }
      let doc;
      try { doc = JSON.parse(await file.text()); } catch { reject(new Error('That file is not a Circuit Bench project (it could not be read).')); return; }
      if (!doc || doc.app !== APP) { reject(new Error('That file is not a Circuit Bench project.')); return; }
      if (doc.version > PROJECT_VERSION) { reject(new Error('That project was saved by a newer version of Circuit Bench.')); return; }
      if (doc.kind !== kind) { reject(new Error(`That is a ${KIND_NAMES[doc.kind] || 'different'} project. Open it from the ${KIND_NAMES[doc.kind] || 'other'} tab.`)); return; }
      resolve({ ...doc, fileName: file.name });
    };
    input.click();
  });
}

export const finite = (v) => typeof v === 'number' && Number.isFinite(v);
export const point = (p) => !!p && finite(p.x) && finite(p.y);
