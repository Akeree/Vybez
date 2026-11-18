// Sign up, sign in, password reset and onboarding.
import { $, $$, esc, num, params, store, toast } from '../core/util.js';
import { api, nextUrl, onSubmit } from '../core/api.js';
import { S, mePromise, requireUser, productOf, homeFor } from '../core/session.js';
const pages = {};

pages.signup = () => {
  mePromise.then(() => { if (S.me) location.replace(nextUrl() || homeFor(S.me)); });
  // Preselect the product from ?product=social or a link back into Vybez Social.
  const nx = nextUrl() || '';
  const want = params.get('product') === 'social' || nx.startsWith('/social') ? 'social' : params.get('product') === 'dj' ? 'dj' : null;
  if (want) $$('[data-role-group] [data-radio]').forEach((x) => { const on = x.dataset.value === want; x.setAttribute('aria-checked', String(on)); x.tabIndex = on ? 0 : -1; });
  $$('[data-keep-next]').forEach((a) => { if (nextUrl()) a.href += `?next=${encodeURIComponent(nextUrl())}`; });
  onSubmit($('[data-form="signup"]'), async (d) => {
    const product = $('[data-role-group] [aria-checked="true"]')?.dataset.value || 'dj';
    await api('POST', 'auth/signup', { ...d, product });
    location.href = `/welcome${nextUrl() ? `?next=${encodeURIComponent(nextUrl())}` : ''}`;
  });
};

pages.signin = () => {
  mePromise.then(() => { if (S.me) location.replace(nextUrl() || homeFor(S.me)); });
  $$('[data-keep-next]').forEach((a) => { if (nextUrl()) a.href += `?next=${encodeURIComponent(nextUrl())}`; });
  onSubmit($('[data-form="signin"]'), async (d) => {
    const { user } = await api('POST', 'auth/signin', d);
    location.href = !user.onboarded ? '/welcome' : nextUrl() || homeFor(user);
  });
};

pages.forgot = () => {
  onSubmit($('[data-form="forgot"]'), async (d, form) => {
    const r = await api('POST', 'auth/forgot', d);
    const done = $('[data-done]', form);
    const text = $('[data-done-text]', form);
    if (r.devLink) text.innerHTML = `Local development: there’s no email service, so here’s the link. <a class="link" href="${esc(r.devLink)}">Reset your password</a>`;
    else if (!r.emailConfigured) text.textContent = 'Email isn’t switched on for Vybez yet, so we can’t send reset links. Ask the Vybez team on WhatsApp to reset it for you.';
    done.hidden = false; done.focus();
  });
};

pages.reset = () => {
  onSubmit($('[data-form="reset"]'), async (d) => {
    const { user } = await api('POST', 'auth/reset', { token: params.get('token') || '', password: d.password });
    store.set('vybez-flash', 'Password updated. You’re signed in.');
    location.href = homeFor(user);
  });
};

pages.welcome = async () => {
  const u = await requireUser();
  const isDj = productOf(u) === 'dj';
  let step = 1;
  const genres = new Set(u.genres || []);
  let software = u.software || '';
  $$('[data-dj-only]').forEach((el) => { el.hidden = !isDj; });
  if (!isDj) $('[data-last-num]').textContent = '2';
  const f1 = $('[data-step="1"]');
  f1.name.value = u.name; f1.handle.value = u.handle; f1.city.value = u.city || ''; if (f1.bio) f1.bio.value = u.bio || '';
  $$('[data-genres] .pill').forEach((p) => {
    p.setAttribute('aria-pressed', String(genres.has(p.textContent)));
    p.addEventListener('click', () => {
      const on = p.getAttribute('aria-pressed') !== 'true';
      if (on && genres.size >= 6) { toast('Pick up to 6.'); return; }
      p.setAttribute('aria-pressed', String(on));
      if (on) genres.add(p.textContent); else genres.delete(p.textContent);
      $('[data-genre-count]').textContent = `${genres.size} of 6 picked`;
    });
  });
  $('[data-genre-count]').textContent = `${genres.size} of 6 picked`;
  $$('[data-software] [data-press]').forEach((b) => {
    if (b.dataset.value === software) b.setAttribute('aria-pressed', 'true');
    b.addEventListener('click', () => { software = b.dataset.value; });
  });
  // Vybez Social accounts skip the DJ steps: profile, then straight to first steps.
  const order = isDj ? [1, 2, 3, 4] : [1, 4];
  const go = (n) => {
    step = n;
    $$('[data-step]').forEach((s) => { s.hidden = Number(s.dataset.step) !== n; });
    const lis = $$('[data-steps] li').filter((li) => !li.hidden);
    const idx = order.indexOf(n);
    lis.forEach((li, i) => { li.classList.toggle('done', i < idx); if (i === idx) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); });
    $(`[data-step="${n}"] input, [data-step="${n}"] button, [data-step="${n}"] a`)?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  };
  const next = () => go(order[order.indexOf(step) + 1]);
  $$('[data-back]').forEach((b) => b.addEventListener('click', () => go(order[order.indexOf(step) - 1])));
  onSubmit(f1, async (d) => { await api('PATCH', 'me', { name: d.name, city: d.city, ...(isDj ? { handle: d.handle, bio: d.bio } : {}) }); next(); });
  onSubmit($('[data-step="2"]'), async () => { await api('PATCH', 'me', { genres: [...genres] }); next(); });
  onSubmit($('[data-step="3"]'), async () => { await api('PATCH', 'me', { software }); next(); });
  const finish = async () => {
    await api('PATCH', 'me', { onboarded: true }).catch(() => {});
    $('[data-next-dj]').hidden = !isDj;
    $('[data-next-social]').hidden = isDj;
    if (nextUrl()) { location.href = nextUrl(); }
  };
  const obs = new MutationObserver(() => { if (!$('[data-step="4"]').hidden) { finish(); obs.disconnect(); } });
  obs.observe($('[data-step="4"]'), { attributes: true });
  go(1);
};


export default pages;
