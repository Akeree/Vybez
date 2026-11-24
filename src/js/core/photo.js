// Cover photos for Vybez Social: open a photo from the camera or the phone, let the host
// frame it, and turn it into a 1200x630 JPEG (the size WhatsApp and other link previews use).
// Everything happens in the browser, so a 10 MB phone photo uploads as about 150 KB.
import { $ } from './util.js';

export const OUT_W = 1200;
export const OUT_H = 630;
const MAX_FILE = 40 * 1024 * 1024;
const MAX_BYTES = 450 * 1024;

// Opens a File as an <img>. Browsers apply the photo's EXIF rotation when drawing it.
export function loadImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('No photo chosen.')); return; }
    if (file.size > MAX_FILE) { reject(new Error('That photo is over 40 MB. Pick a smaller one.')); return; }
    if (file.type && !file.type.startsWith('image/')) { reject(new Error('That isn’t a photo. Pick a JPEG, PNG or a photo from your camera.')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) { URL.revokeObjectURL(url); reject(new Error('We couldn’t open that photo.')); return; }
      resolve({ img, url });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      const heic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name || '');
      reject(new Error(heic
        ? 'This browser can’t open HEIC photos. Take the photo here with “Take a photo”, or pick a JPEG or PNG.'
        : 'We couldn’t open that photo. Try a JPEG or PNG.'));
    };
    img.src = url;
  });
}

// Draws the framed part of the image to 1200x630 and returns a JPEG data URL under MAX_BYTES.
export function encode(img, crop) {
  const canvas = document.createElement('canvas');
  canvas.width = OUT_W; canvas.height = OUT_H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#141118';
  ctx.fillRect(0, 0, OUT_W, OUT_H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, OUT_W, OUT_H);
  let q = 0.86;
  let out = canvas.toDataURL('image/jpeg', q);
  while (out.length * 0.75 > MAX_BYTES && q > 0.4) { q -= 0.08; out = canvas.toDataURL('image/jpeg', q); }
  if (!out.startsWith('data:image/jpeg')) throw new Error('This browser couldn’t prepare the photo. Try another browser.');
  return out;
}

// The crop dialog. Resolves with a data URL, or null if the host cancels.
export function cropDialog(img) {
  const dlg = $('[data-crop-dialog]');
  const frame = $('[data-crop-frame]', dlg);
  const pic = $('[data-crop-img]', dlg);
  const zoomEl = $('[data-crop-zoom]', dlg);
  const iw = img.naturalWidth; const ih = img.naturalHeight;
  pic.src = img.src;
  let fw = 0; let fh = 0; let base = 1; let zoom = 1; let x = 0; let y = 0;
  const scale = () => base * zoom;
  const clamp = () => {
    const s = scale();
    x = Math.min(0, Math.max(fw - iw * s, x));
    y = Math.min(0, Math.max(fh - ih * s, y));
  };
  const paint = () => { clamp(); pic.style.transform = `translate(${x}px, ${y}px) scale(${scale()})`; };
  const measure = () => {
    const r = frame.getBoundingClientRect();
    const cx = fw ? (fw / 2 - x) / scale() : iw / 2; const cy = fh ? (fh / 2 - y) / scale() : ih / 2;
    fw = r.width; fh = r.height;
    base = Math.max(fw / iw, fh / ih);
    x = fw / 2 - cx * scale(); y = fh / 2 - cy * scale();
    paint();
  };
  // Zoom around a point in the frame (the centre, or between two fingers).
  const zoomTo = (z, px = fw / 2, py = fh / 2) => {
    const s0 = scale();
    zoom = Math.min(3, Math.max(1, z));
    const s1 = scale();
    x = px - ((px - x) / s0) * s1; y = py - ((py - y) / s0) * s1;
    zoomEl.value = String(zoom);
    paint();
  };
  const pts = new Map();
  let pinch = null;
  const down = (e) => { frame.setPointerCapture?.(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom }; } };
  const move = (e) => {
    const p = pts.get(e.pointerId); if (!p) return;
    const nx = e.clientX; const ny = e.clientY;
    if (pts.size === 1) { x += nx - p.x; y += ny - p.y; paint(); }
    p.x = nx; p.y = ny;
    if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      const r = frame.getBoundingClientRect();
      zoomTo(pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / (pinch.d || 1)), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
    }
  };
  const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
  const wheel = (e) => { e.preventDefault(); const r = frame.getBoundingClientRect(); zoomTo(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX - r.left, e.clientY - r.top); };
  const key = (e) => {
    const step = e.shiftKey ? 40 : 12;
    const d = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (d) { e.preventDefault(); x += d[0]; y += d[1]; paint(); } else if (e.key === '+' || e.key === '=') zoomTo(zoom + 0.1); else if (e.key === '-') zoomTo(zoom - 0.1);
  };
  const onZoom = () => zoomTo(Number(zoomEl.value));
  const ro = 'ResizeObserver' in window ? new ResizeObserver(measure) : null;
  return new Promise((resolve) => {
    const done = (val) => {
      frame.removeEventListener('pointerdown', down); frame.removeEventListener('pointermove', move);
      frame.removeEventListener('pointerup', up); frame.removeEventListener('pointercancel', up);
      frame.removeEventListener('wheel', wheel); frame.removeEventListener('keydown', key);
      zoomEl.removeEventListener('input', onZoom); ro?.disconnect();
      dlg.querySelectorAll('[data-crop-cancel]').forEach((b) => b.removeEventListener('click', cancel));
      $('[data-crop-ok]', dlg).removeEventListener('click', ok);
      dlg.removeEventListener('cancel', cancel);
      if (dlg.open) dlg.close();
      resolve(val);
    };
    const cancel = (e) => { e?.preventDefault?.(); done(null); };
    const ok = () => {
      const s = scale();
      try { done(encode(img, { sx: -x / s, sy: -y / s, sw: fw / s, sh: fh / s })); } catch (err) { done(err); }
    };
    frame.addEventListener('pointerdown', down); frame.addEventListener('pointermove', move);
    frame.addEventListener('pointerup', up); frame.addEventListener('pointercancel', up);
    frame.addEventListener('wheel', wheel, { passive: false }); frame.addEventListener('keydown', key);
    zoomEl.addEventListener('input', onZoom);
    dlg.querySelectorAll('[data-crop-cancel]').forEach((b) => b.addEventListener('click', cancel));
    $('[data-crop-ok]', dlg).addEventListener('click', ok);
    dlg.addEventListener('cancel', cancel);
    zoom = 1; zoomEl.value = '1'; fw = 0; fh = 0;
    dlg.showModal();
    measure();
    ro?.observe(frame);
  });
}

// Moments: keep the whole photo (no crop), longest side at most `max` px, as a JPEG under
// `maxBytes`. Returns { data, w, h }.
export function encodeFit(img, max = 1280, maxBytes = 380 * 1024) {
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * s));
  const h = Math.max(1, Math.round(img.naturalHeight * s));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#141118';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  let q = 0.84;
  let out = canvas.toDataURL('image/jpeg', q);
  while (out.length * 0.75 > maxBytes && q > 0.4) { q -= 0.08; out = canvas.toDataURL('image/jpeg', q); }
  if (!out.startsWith('data:image/jpeg')) throw new Error('This browser couldn’t prepare the photo. Try another browser.');
  return { data: out, w, h };
}
