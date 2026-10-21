// Lena liest Fotos und eingescannte Seiten: Texterkennung (Tesseract) direkt auf dem Gerät, ohne Internet.
import { toast } from '../ui.js';

const BASE = new URL('../vendor/tesseract-7.0.0/', import.meta.url).href;
let workerP = null;
let busyNote = '';

async function worker() {
  workerP ||= (async () => {
    const T = (await import(BASE + 'tesseract.esm.min.js')).default;
    return T.createWorker('deu', 1, {
      workerPath: BASE + 'worker.min.js', corePath: BASE + 'core', langPath: BASE + 'lang', gzip: true,
      cacheMethod: 'none',
    });
  })().catch(err => { workerP = null; throw err; });
  return workerP;
}

// Erkennt den Text auf einem Bild (Blob, Canvas oder Bild-URL).
export async function readImage(src, note = '') {
  busyNote = note;
  if (note) toast(note, 60000);
  try {
    const w = await worker();
    const { data } = await w.recognize(src);
    return cleanup(data.text || '');
  } finally {
    if (busyNote === note && note) toast('Fertig gelesen ✓', 1500);
  }
}

// Eingescannte PDF-Seiten als Bild rendern und lesen.
export async function readPdfPages(doc, name) {
  const pages = [];
  const max = Math.min(doc.numPages, 60);
  for (let i = 1; i <= max; i++) {
    const page = await doc.getPage(i);
    const vp0 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(2.5, 1700 / vp0.width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    pages.push(await readImage(canvas, `Lena liest „${name}“: Seite ${i} von ${max} …`));
    canvas.width = canvas.height = 0;
  }
  return pages;
}

// Typische Erkennungsfehler glätten: Silbentrennung am Zeilenende, doppelte Leerzeichen.
function cleanup(t) {
  return t.replace(/\r/g, '').replace(/([\p{L}])-\n(\p{Ll})/gu, '$1$2').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
