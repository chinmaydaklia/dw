/* Phone ⇄ laptop sync screen.
   Nearby: a direct, encrypted WebRTC link between the two devices. The "phone call" is set up by showing a QR
   code on one device and scanning it with the other (camera), then the same back — no server, no account.
   Sync file: save on one device, open on the other (optionally passphrase-protected). Either way the two
   copies are merged record by record (see core/sync.js) after a snapshot is taken. */
import { h, clear, add, download, pickFile } from '../ui/dom.js';
import { openModal, toast, field } from '../ui/widgets.js';
import * as store from '../app/store.js';
import { S } from '../app/store.js';
import { drawQR } from '../lib/qr.js';
import { encryptText, decryptText, isEncrypted, cryptoAvailable } from '../lib/crypto.js';
import { loadJsQR } from '../import/libs.js';
import { fmtDate, today } from '../lib/dates.js';

const lastSync = () => { try { return JSON.parse(localStorage.getItem('dwb_last_sync') || 'null'); } catch { return null; } };
const resultText = r => 'synced with ' + (r.device || 'the other device') + ' · ' + r.inN + ' change' + (r.inN === 1 ? '' : 's') + ' in, ' + r.outN + ' out';

export function renderSync(root) {
  const last = lastSync();
  const name = h('input.inp', { value: store.deviceName(), onchange: e => { try { localStorage.setItem('dwb_device_name', e.target.value.trim()); } catch { /* ignore */ } toast('Saved'); } });
  add(root,
    h('p.muted', { style: { marginTop: 0 } }, 'Use the app on your phone and your laptop and keep both the same. Each device keeps its own copy; syncing merges them entry by entry — the newer change wins, deletions are remembered, and nothing is overwritten wholesale. A snapshot is saved on the device before every sync.'),
    h('div.card', h('div.card-b', { style: { paddingTop: '12px' } },
      h('div.grid.g2', field('This device is called', name, 'shown on the other device'),
        h('div', h('div.small.muted', 'Last sync'), h('b', last ? resultText(last) : 'never'), last ? h('div.small.muted', fmtDate(last.at.slice(0, 10)) + ' ' + last.at.slice(11, 16)) : null)),
      store.isPristine() ? h('div.note', 'This device is new (only the starter data). On its first sync it takes the other device’s records instead of adding a second You / Spouse / demo.') : null)),
    h('div.section-h', h('h2', '⇆ Nearby — phone and laptop together')),
    h('div.card', h('div.card-b', { style: { paddingTop: '12px' } },
      h('p', { style: { marginTop: 0 } }, 'Open this screen on both devices, on the same Wi-Fi. On one tap ', h('b', 'Start'), ' — it shows a QR code. On the other tap ', h('b', 'Join'), ' and scan it; that device shows a reply QR to scan back. The data goes directly between the two devices, encrypted.'),
      h('div.btnrow', h('button.btn.primary', { onclick: () => nearby('host') }, '① Start here'), h('button.btn', { onclick: () => nearby('join') }, '② Join (scan the other device)')),
      h('p.small.muted', 'If a camera is not available, use Copy / Share and paste the code on the other device. Works offline on the same Wi-Fi; on different networks it may not connect — use a sync file instead.'))),
    h('div.section-h', h('h2', '⇩ Sync file — works everywhere')),
    h('div.card', h('div.card-b', { style: { paddingTop: '12px' } },
      h('p', { style: { marginTop: 0 } }, 'Save a sync file here, send it to the other device (WhatsApp to yourself, email, USB) and open it there with “Open sync file”. To sync both ways, then send one back.'),
      h('div.btnrow', h('button.btn', { onclick: saveSyncFile }, 'Save sync file…'), h('button.btn.primary', { onclick: openSyncFile }, 'Open sync file & merge…')))),
    h('div.note', 'Never synced: this device’s settings, its change history, automatic snapshots and remembered statement passwords. Sync only happens when you start it.'));
}

/* ---------- result ---------- */
function showResult(r) {
  const md = openModal({
    title: '✓ Synced', body: h('div.grid',
      h('p', { style: { margin: 0 } }, resultText(r) + '.'),
      r.replacedFresh ? h('div.note.ok', 'This was a new device, so it took the other device’s records.') : null,
      r.duplicates ? h('div.note.warn', r.duplicates + ' entr' + (r.duplicates === 1 ? 'y looks' : 'ies look') + ' doubled: the same bank statement was imported on both devices before they synced.',
        h('div', { style: { marginTop: '6px' } }, h('button.btn.sm', { onclick: async () => { const n = await store.removeCrossDeviceDuplicates(); toast(n + ' duplicate entr' + (n === 1 ? 'y' : 'ies') + ' removed'); md.close(); } }, 'Remove the ' + r.duplicates + ' extra entr' + (r.duplicates === 1 ? 'y' : 'ies')))) : null),
    foot: [h('button.btn.primary', { onclick: () => md.close() }, 'Done')]
  });
}

/* ---------- sync file ---------- */
async function saveSyncFile() {
  const protect = h('input', { type: 'checkbox', checked: cryptoAvailable() });
  const p1 = h('input.inp', { type: 'password', autocomplete: 'new-password', placeholder: 'Passphrase (8+ characters)' });
  const p2 = h('input.inp', { type: 'password', autocomplete: 'new-password', placeholder: 'Repeat passphrase' });
  const box = h('div.grid', p1, p2);
  const md = openModal({
    title: 'Save sync file', sub: 'Holds all your records. Protect it if it will travel through chat or email.',
    body: h('div.grid', h('label.check', protect, h('span', 'Protect with a passphrase', h('div.small.muted', 'You type the same passphrase on the other device. It is not stored anywhere.'))), box),
    foot: [h('button.btn', { onclick: () => md.close() }, 'Cancel'), h('button.btn.primary', { onclick: async () => {
      let text = JSON.stringify(store.syncPayload());
      if (protect.checked) {
        if (p1.value.length < 8) return toast('Use at least 8 characters');
        if (p1.value !== p2.value) return toast('The passphrases do not match');
        text = await encryptText(text, p1.value);
      }
      const dev = store.deviceName().replace(/[^\w-]+/g, '-');
      download('DoctorWealth-sync-' + dev + '-' + today() + '.dwsync', text, 'application/json');
      md.close(); toast('Sync file saved — open it on the other device');
    } }, 'Save')]
  });
  protect.addEventListener('change', () => box.classList.toggle('hide', !protect.checked));
}
async function openSyncFile() {
  const f = await pickFile('.dwsync,.json,application/json'); if (!f) return;
  let o;
  try { o = JSON.parse(await f.text()); } catch { return toast('That is not a sync file'); }
  if (isEncrypted(o)) {
    const pass = await askPass();
    if (pass === null) return;
    try { o = JSON.parse(await decryptText(o, pass)); } catch (e) { return toast(e.message); }
  }
  if (!store.isSyncPayload(o)) return toast(store.isOwnBackup(o) ? 'That is a backup (it replaces everything). Use Settings → Restore, or save a sync file instead.' : 'That is not a sync file');
  try { showResult(await store.applySync(o)); }
  catch (e) {
    if (e.code !== 'SEPARATE') return toast(e.message);
    if (await confirmReplace(o.device)) { try { showResult(await store.applySync(o, { replace: true })); } catch (e2) { toast(e2.message); } }
  }
}
/* the two devices were set up separately: keep one side's records */
function confirmReplace(device) {
  return new Promise(resolve => {
    let done = false;
    const md = openModal({
      title: 'These devices have separate records', body: h('div.grid',
        h('p', { style: { margin: 0 } }, 'This device and ', h('b', device || 'the other device'), ' were each set up and used on their own, so merging would give two of every person (two “You”, two “Spouse”).'),
        h('p', { style: { margin: 0 } }, 'If the records you want are on ', h('b', device || 'the other device'), ', take them here: this device’s own records are replaced. A snapshot is saved first (Settings → Automatic snapshots), so nothing is lost.'),
        h('p.small.muted', { style: { margin: 0 } }, 'If the records you want are on THIS device, cancel and do it the other way round.')),
      foot: [h('button.btn', { onclick: () => { done = true; md.close(); resolve(false); } }, 'Cancel'), h('button.btn.danger', { onclick: () => { done = true; md.close(); resolve(true); } }, 'Take the other device’s records')],
      onClose: () => { if (!done) resolve(false); }
    });
  });
}
function askPass() {
  return new Promise(resolve => {
    let done = false;
    const inp = h('input.inp', { type: 'password', autocomplete: 'off', autofocus: true });
    const ok = () => { done = true; md.close(); resolve(inp.value); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
    const md = openModal({ title: 'Passphrase for this sync file', body: inp, foot: [h('button.btn', { onclick: () => md.close() }, 'Cancel'), h('button.btn.primary', { onclick: ok }, 'Open')], onClose: () => { if (!done) resolve(null); } });
  });
}

/* ---------- nearby (WebRTC data channel, QR signalling) ---------- */
let peer = null;
function closePeer() { try { peer && peer.dc && peer.dc.close(); } catch { /* */ } try { peer && peer.pc && peer.pc.close(); } catch { /* */ } peer = null; }
/* smaller codes -> easier QR: drop session lines a data channel does not need */
const slimSdp = sdp => sdp.split(/\r\n/).filter(l => l && !/^a=extmap-allow-mixed|^a=msid-semantic/.test(l)).join('\r\n') + '\r\n';
const encodeSignal = (kind, sdp) => 'DWB1' + kind + ':' + slimSdp(sdp).replace(/\r\n/g, '\n');
function decodeSignal(text) {
  const m = /^\s*DWB1([OA]):([\s\S]+?)\s*$/.exec(String(text || ''));
  if (!m) return null;
  let sdp = m[2].replace(/\r?\n/g, '\r\n'); if (!/\r\n$/.test(sdp)) sdp += '\r\n'; /* SDP must end with CRLF */
  return { type: m[1] === 'O' ? 'offer' : 'answer', sdp };
}
function newPc() {
  /* a public STUN server only helps the two devices find each other's address; the data itself goes device to device */
  return new RTCPeerConnection({ iceServers: navigator.onLine ? [{ urls: 'stun:stun.l.google.com:19302' }] : [] });
}
const gathered = pc => new Promise(res => {
  if (pc.iceGatheringState === 'complete') return res();
  const t = setTimeout(res, 3500);
  pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
});

function codePanel(title, code) {
  const cv = h('canvas', { style: { width: 'min(300px, 80vw)', height: 'auto', imageRendering: 'pixelated', background: '#fff', padding: '8px', borderRadius: '10px' } });
  try { drawQR(cv, code); } catch { /* too long for a QR: copy/share still work */ }
  return h('div', { style: { textAlign: 'center' } }, h('div.small.muted', title), cv,
    h('div.btnrow', { style: { justifyContent: 'center', marginTop: '6px' } },
      h('button.btn.sm', { onclick: () => copy(code) }, 'Copy code'),
      navigator.share ? h('button.btn.sm', { onclick: () => navigator.share({ text: code }).catch(() => {}) }, 'Share…') : null));
}
function copy(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(() => toast('Copied'), () => toast('Copy failed — select the text'));
  else toast('Copy is not available here');
}
function inputPanel(label, onCode) {
  const ta = h('textarea.inp', { rows: 3, placeholder: 'or paste the code here', style: { fontFamily: 'monospace', fontSize: '11px' } });
  return h('div.grid', h('div.small.muted', label),
    h('div.btnrow', h('button.btn.primary', { onclick: async () => { const t = await scanQR(); if (t) { ta.value = t; onCode(t); } } }, '📷 Scan with camera'),
      h('button.btn', { onclick: () => onCode(ta.value) }, 'Use pasted code')), ta);
}

function nearby(role) {
  if (!window.RTCPeerConnection) return toast('This browser cannot connect directly — use a sync file instead.');
  closePeer();
  const pc = newPc(); peer = { pc, dc: null };
  const status = h('div.note', 'Getting ready…');
  const area = h('div');
  const md = openModal({ title: role === 'host' ? 'Nearby sync — start' : 'Nearby sync — join', size: 'wide', body: h('div.grid', area, status),
    foot: [h('button.btn', { onclick: () => md.close() }, 'Close')], onClose: closePeer });
  const say = t => { status.textContent = t; };
  const wire = dc => {
    peer.dc = dc;
    let buf = [], mine = null, theirs = null, started = false, merging = false;
    const finish = () => { if (mine && theirs) { say('✓ ' + resultText(mine)); setTimeout(() => { md.close(); showResult(mine); }, 400); } };
    const start = async () => {
      if (started) return; started = true;   /* the channel may already be open AND fire "open": send once */
      say('Connected to the other device — exchanging records…');
      const text = JSON.stringify(store.syncPayload()), CH = 16000;
      dc.send(JSON.stringify({ t: 'begin', n: Math.ceil(text.length / CH) }));
      for (let i = 0; i < text.length; i += CH) {
        while (dc.bufferedAmount > 4e6) await new Promise(r => setTimeout(r, 30));
        dc.send(JSON.stringify({ t: 'c', d: text.slice(i, i + CH) }));
      }
      dc.send(JSON.stringify({ t: 'end' }));
    };
    dc.onopen = start;
    if (dc.readyState === 'open') start();
    dc.onmessage = async ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'begin') buf = [];
      else if (m.t === 'c') buf.push(m.d);
      else if (m.t === 'end') {
        if (merging || mine) return; merging = true;
        const payload = JSON.parse(buf.join(''));
        try { mine = await store.applySync(payload); }
        catch (e) {
          merging = false;
          if (e.code === 'SEPARATE') {
            say('These devices were set up separately — choose which records to keep.');
            add(area, h('div.note.warn', e.message, h('div', { style: { marginTop: '8px' } }, h('button.btn.danger', { onclick: async () => {
              if (!(await confirmReplace(payload.device))) return;
              try { mine = await store.applySync(payload, { replace: true }); dc.send(JSON.stringify({ t: 'replaced', device: store.deviceName() })); md.close(); showResult(mine); } catch (e2) { say(e2.message); }
            } }, 'Take the other device’s records'))));
            dc.send(JSON.stringify({ t: 'separate' }));
            return;
          }
          say('Could not merge: ' + e.message); dc.send(JSON.stringify({ t: 'err', msg: e.message })); return;
        }
        dc.send(JSON.stringify({ t: 'done', inN: mine.inN, outN: mine.outN })); finish();
      } else if (m.t === 'done') { theirs = m; finish(); }
      else if (m.t === 'err') say('The other device could not merge: ' + m.msg);
      else if (m.t === 'replaced') say('✓ ' + (m.device || 'The other device') + ' took this device’s records.');
    };
    dc.onclose = () => { if (!(mine && theirs)) say('Connection closed.'); };
  };
  pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed') say('Could not connect. Are both devices on the same Wi-Fi? Otherwise use a sync file.'); });
  if (role === 'host') {
    wire(pc.createDataChannel('dwb-sync'));
    (async () => {
      await pc.setLocalDescription(await pc.createOffer()); await gathered(pc);
      add(clear(area), codePanel('① On the other device: Sync → Join → scan this', encodeSignal('O', pc.localDescription.sdp)),
        h('hr'), inputPanel('③ Then scan the reply code shown on the other device', async t => {
          const sig = decodeSignal(t); if (!sig || sig.type !== 'answer') return toast('That is not a reply code');
          try { await pc.setRemoteDescription(sig); say('Connecting…'); } catch (e) { say('Error: ' + e.message); }
        }));
      say('Waiting for the other device…');
    })().catch(e => say('Error: ' + e.message));
  } else {
    pc.addEventListener('datachannel', ev => wire(ev.channel));
    add(area, inputPanel('② Scan the code shown on the other device', async t => {
      const sig = decodeSignal(t); if (!sig || sig.type !== 'offer') return toast('That is not a start code');
      try {
        await pc.setRemoteDescription(sig);
        await pc.setLocalDescription(await pc.createAnswer()); await gathered(pc);
        add(clear(area), codePanel('③ Scan this with the first device', encodeSignal('A', pc.localDescription.sdp)));
        say('Waiting for the first device to scan…');
      } catch (e) { say('Error: ' + e.message); }
    }));
    say('Point the camera at the code on the other device.');
  }
}

/* camera QR reader: built-in BarcodeDetector where available (Android Chrome), else the bundled jsQR */
function scanQR() {
  return new Promise(resolve => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('No camera access here — paste the code instead'); return resolve(null); }
    let stream = null, stop = false, result = null;
    const video = h('video', { playsInline: true, muted: true, style: { width: '100%', borderRadius: '10px', background: '#000' } });
    const cv = h('canvas', { style: { display: 'none' } });
    const md = openModal({ title: 'Scan the code', body: h('div', video, cv, h('p.small.muted', 'Hold the other screen steady, filling most of the frame.')),
      foot: [h('button.btn', { onclick: () => md.close() }, 'Cancel')],
      onClose: () => { stop = true; if (stream) stream.getTracks().forEach(t => t.stop()); resolve(result); } });
    (async () => {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } } });
      video.srcObject = stream; await video.play();
      let det = null; try { if (window.BarcodeDetector) det = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch { det = null; }
      const jsQR = det ? null : await loadJsQR();
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      while (!stop) {
        let txt = null;
        if (video.videoWidth) {
          if (det) { const codes = await det.detect(video).catch(() => []); if (codes.length) txt = codes[0].rawValue; }
          else { cv.width = video.videoWidth; cv.height = video.videoHeight; ctx.drawImage(video, 0, 0); const img = ctx.getImageData(0, 0, cv.width, cv.height); const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' }); if (code) txt = code.data; }
        }
        if (txt) { result = txt; md.close(); return; }
        await new Promise(r => setTimeout(r, 180));
      }
    })().catch(() => { toast('Camera not available — paste the code instead'); md.close(); });
  });
}
