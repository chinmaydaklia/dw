/* Boot: open the database, run migrations + integrity checks, start the UI, register the service worker. */
import * as store from './app/store.js';
import { start } from './app/app.js';
import { refreshAppFiles } from './app/db.js';

async function boot() {
  try {
    await store.init();
    start();
  } catch (err) {
    console.error(err);
    document.getElementById('app').innerHTML = '';
    const box = document.createElement('div');
    box.className = 'note bad';
    box.style.margin = '24px';
    box.textContent = 'DoctorWealth could not open your books: ' + (err && err.message || err) + ' — your data has not been changed. Try reloading; if this persists, use a backup file.';
    const fix = document.createElement('button');
    fix.className = 'btn sm primary'; fix.style.marginTop = '10px'; fix.style.display = 'block';
    fix.textContent = 'Update app & reload (your data is kept)';
    fix.onclick = () => refreshAppFiles(true);
    box.appendChild(fix);
    document.getElementById('app').appendChild(box);
  }
  registerSW();
}

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('./sw.js').then(reg => {
    const offer = w => {
      if (document.getElementById('updateBar')) return;
      const bar = document.createElement('div');
      bar.id = 'updateBar'; bar.className = 'update-bar card';
      bar.style.padding = '10px 12px';
      bar.innerHTML = '<span>A new version is ready.</span> ';
      const b = document.createElement('button');
      b.className = 'btn sm primary'; b.textContent = 'Reload';
      b.onclick = () => w.postMessage('skipWaiting');
      bar.appendChild(b);
      document.body.appendChild(bar);
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
  }).catch(e => console.warn('Service worker not registered', e));
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}

boot();
