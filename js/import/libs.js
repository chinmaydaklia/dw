/* Locally bundled libraries, loaded on first use so the app starts fast and works fully offline. */
const base = new URL('../../vendor/', import.meta.url).href;

function loadScript(src, test) {
  return new Promise((resolve, reject) => {
    if (test()) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => (test() ? resolve() : reject(new Error('Library did not initialise: ' + src)));
    s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}
export async function loadXLSX() {
  await loadScript(base + 'xlsx.full.min.js', () => !!window.XLSX);
  return window.XLSX;
}
export async function loadPDF() {
  await loadScript(base + 'pdfjs/pdf.min.js', () => !!window.pdfjsLib);
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'pdfjs/pdf.worker.min.js';
  return window.pdfjsLib;
}
/* Workbook -> { sheetName: rows[][] } */
export async function readWorkbook(buf) {
  const XLSX = await loadXLSX();
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: false });
  const out = {};
  for (const n of wb.SheetNames) out[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
  return out;
}
/* PDF -> pages of text items. Throws { code: 'PASSWORD_NEEDED' | 'PASSWORD_WRONG' } for protected files. */
export async function readPdfItems(buf, password = '') {
  const pdfjs = await loadPDF();
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), password, isEvalSupported: false });
  let pwReason = 0;
  task.onPassword = (_update, reason) => { pwReason = reason; task.destroy(); };
  let pdf;
  try { pdf = await task.promise; }
  catch (e) {
    if (pwReason || (e && e.name === 'PasswordException')) {
      const code = (pwReason || e.code) === 2 ? 'PASSWORD_WRONG' : 'PASSWORD_NEEDED';
      throw Object.assign(new Error(code === 'PASSWORD_WRONG' ? 'Incorrect password — try again.' : 'This PDF is password-protected. Enter its password.'), { code });
    }
    throw new Error('Could not open the PDF: ' + (e && e.message || e));
  }
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    pages.push(tc.items);
  }
  return pages;
}
