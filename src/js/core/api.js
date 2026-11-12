// Talking to /api, plus form wiring that shows API errors next to the form.
import { $, $$, params, toast } from './util.js';

export async function api(method, path, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body || {}); }
  let res;
  try { res = await fetch(`/api/${path}`, opts); } catch { throw Object.assign(new Error('You seem to be offline. Check your connection and try again.'), { status: 0 }); }
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw Object.assign(new Error(data.error || `Something went wrong (${res.status}).`), { status: res.status, data });
  return data;
}

export function showError(form, err) {
  const box = $('[data-error]', form);
  if (box) { box.textContent = err.message; box.hidden = false; } else toast(err.message);
}
export function clearError(form) { const box = $('[data-error]', form); if (box) box.hidden = true; }

// Wire a form: collects named fields, disables the submit button while working.
export function onSubmit(form, fn) {
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError(form);
    if (form.hasAttribute('novalidate') && !form.reportValidity()) return;
    const data = {};
    new FormData(form).forEach((v, k) => { data[k] = typeof v === 'string' ? v.trim() : v; });
    $$('input[type="checkbox"][name]', form).forEach((c) => { data[c.name] = c.checked; });
    const btns = $$('button[type="submit"], button:not([type])', form);
    btns.forEach((b) => { b.disabled = true; b.setAttribute('aria-busy', 'true'); });
    try { await fn(data, form); } catch (err) { showError(form, err); } finally { btns.forEach((b) => { b.disabled = false; b.removeAttribute('aria-busy'); }); }
  });
}

export const nextUrl = () => {
  const n = params.get('next');
  return n && n.startsWith('/') && !n.startsWith('//') ? n : null;
};
export const toSignin = () => { location.replace(`/signin?next=${encodeURIComponent(location.pathname + location.search)}`); };
