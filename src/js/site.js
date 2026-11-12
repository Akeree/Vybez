// Vybez site behaviour. Small, dependency-free, progressive: every page works without it.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };

  // Toasts
  const INFO = '<svg class="i" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';
  function toast(msg) {
    const host = $('[data-toast-host]');
    if (!host) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = INFO;
    const span = document.createElement('span');
    span.textContent = msg;
    t.appendChild(span);
    host.appendChild(t);
    while (host.children.length > 2) host.firstElementChild.remove();
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 4200);
  }
  window.vybezToast = toast;

  // Preview bar: shown until dismissed.
  const bar = $('[data-preview-bar]');
  if (bar && store.get('vybez-preview-dismissed') !== '1') bar.hidden = false;
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-dismiss-preview]')) { bar.hidden = true; store.set('vybez-preview-dismissed', '1'); }
  });

  // Sticky nav border once the page scrolls.
  const nav = $('[data-site-nav]');
  if (nav) {
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // Mobile menu
  const menu = $('#mobile-menu');
  const openBtn = $('[data-menu-open]');
  function setMenu(open) {
    if (!menu) return;
    menu.classList.toggle('open', open);
    openBtn?.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) $('[data-menu-close]', menu)?.focus(); else openBtn?.focus();
  }
  openBtn?.addEventListener('click', () => setMenu(true));
  $('[data-menu-close]')?.addEventListener('click', () => setMenu(false));
  menu?.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu?.classList.contains('open')) setMenu(false); });

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-toast], [data-soon], [data-switch], [data-pill], [data-radio], [data-press], [data-copy], [data-billing], [data-tab]');
    if (!el) return;

    // Honest "not yet" messages.
    if (el.matches('[data-toast]')) { e.preventDefault(); toast(el.dataset.toast); }
    if (el.matches('[data-soon]')) { e.preventDefault(); toast(`${el.dataset.soon} is coming soon. It isn't part of this preview yet.`); }

    // Switches
    if (el.matches('[data-switch]')) {
      const on = el.getAttribute('aria-checked') !== 'true';
      el.setAttribute('aria-checked', String(on));
      const label = el.dataset.switch;
      if (label) toast(`${label} ${on ? 'on' : 'off'}. Saved on this device only, as this is a preview.`);
    }

    // Single-choice pill groups (filters)
    if (el.matches('[data-pill]')) {
      const group = el.closest('[data-pills]');
      $$('[data-pill]', group).forEach((p) => p.setAttribute('aria-pressed', String(p === el)));
      const key = el.dataset.pill;
      const target = group?.dataset.pills && $(group.dataset.pills);
      if (target) {
        let shown = 0;
        $$('[data-kind]', target).forEach((row) => {
          const show = key === 'all' || row.dataset.kind.split(' ').includes(key);
          row.hidden = !show;
          if (show) shown++;
        });
        const empty = $('[data-empty]', target.parentElement);
        if (empty) empty.hidden = shown > 0;
      }
    }

    // Radio groups (roles, visibility, DJ software)
    if (el.matches('[data-radio]')) {
      if (el.getAttribute('aria-disabled') === 'true') { toast(el.dataset.disabledMsg || 'Not available yet.'); return; }
      const group = el.closest('[role="radiogroup"]');
      $$('[data-radio]', group).forEach((r) => r.setAttribute('aria-checked', String(r === el)));
      if (el.dataset.msg) toast(el.dataset.msg);
      const out = group?.dataset.output && $(group.dataset.output);
      if (out && el.dataset.value) out.textContent = el.dataset.value;
    }

    // Toggle buttons (DJ software cards, reactions, follow)
    if (el.matches('[data-press]')) {
      if (el.getAttribute('aria-disabled') === 'true') { toast(el.dataset.disabledMsg || 'Not available yet.'); return; }
      const group = el.closest('[data-press-group]');
      if (group) {
        $$('[data-press]', group).forEach((p) => { if (p !== el) p.setAttribute('aria-pressed', 'false'); });
        el.setAttribute('aria-pressed', 'true');
      } else {
        const on = el.getAttribute('aria-pressed') !== 'true';
        el.setAttribute('aria-pressed', String(on));
        const n = $('[data-count]', el);
        if (n) n.textContent = String(+n.textContent + (on ? 1 : -1));
        const lbl = $('[data-label-on]', el);
        if (lbl) lbl.textContent = on ? lbl.dataset.labelOn : lbl.dataset.labelOff;
      }
      if (el.dataset.msg) toast(el.dataset.msg);
    }

    // Copy to clipboard
    if (el.matches('[data-copy]')) {
      e.preventDefault();
      const src = el.dataset.copy.startsWith('#') ? $(el.dataset.copy)?.innerText : el.dataset.copy;
      const done = () => toast(el.dataset.copied || 'Copied.');
      if (navigator.clipboard && src) navigator.clipboard.writeText(src).then(done, () => toast('Copy failed. Select the text and copy it instead.'));
      else toast('Copy is not available in this browser.');
    }

    // Pricing billing toggle
    if (el.matches('[data-billing]')) {
      const mode = el.dataset.billing;
      $$('[data-billing]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
      $$('[data-price-monthly]').forEach((p) => {
        p.textContent = mode === 'monthly' ? p.dataset.priceMonthly : p.dataset.priceYearly;
      });
      $$('[data-price-note]').forEach((p) => {
        p.textContent = mode === 'monthly' ? p.dataset.noteMonthly : p.dataset.priceNote;
      });
    }

    // Tabs
    if (el.matches('[data-tab]')) {
      const list = el.closest('[role="tablist"]');
      $$('[data-tab]', list).forEach((t) => {
        const sel = t === el;
        t.setAttribute('aria-selected', String(sel));
        t.tabIndex = sel ? 0 : -1;
        const panel = document.getElementById(t.getAttribute('aria-controls'));
        if (panel) panel.hidden = !sel;
      });
    }
  });

  // Arrow keys for tabs and radio groups
  document.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const el = e.target.closest('[data-tab], [data-radio]');
    if (!el) return;
    const group = el.closest('[role="tablist"], [role="radiogroup"]');
    const items = $$(el.matches('[data-tab]') ? '[data-tab]' : '[data-radio]', group);
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const next = items[(items.indexOf(el) + dir + items.length) % items.length];
    e.preventDefault();
    next.focus();
    next.click();
  });

  // Forms that would create accounts or send data: never submit anywhere in the preview.
  $$('form[data-preview-form]').forEach((f) => f.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!f.reportValidity()) return;
    const notice = $('[data-form-notice]', f) || (f.dataset.notice ? $(f.dataset.notice) : null);
    if (notice) { notice.hidden = false; notice.focus?.(); }
    if (f.dataset.toast) toast(f.dataset.toast);
    const first = f.elements.first && f.elements.first.value.trim();
    if (first) { try { sessionStorage.setItem('vybez-first', first); } catch (_) {} }
    if (f.dataset.next) setTimeout(() => { window.location.href = f.dataset.next; }, 350);
  }));

  // Example invite confirmation: greet the guest by the name they typed.
  $$('[data-first-name]').forEach((el) => {
    let first = '';
    try { first = sessionStorage.getItem('vybez-first') || ''; } catch (_) {}
    el.textContent = first ? `, ${first}` : '';
  });

  // Drop zone (sets manager)
  $$('[data-dropzone]').forEach((z) => {
    const input = $('input[type="file"]', z);
    const say = (files) => {
      if (!files || !files.length) return;
      const names = Array.from(files).map((f) => f.name).join(', ');
      toast(`Got ${names}. Imports open with accounts; nothing was uploaded.`);
    };
    ['dragenter', 'dragover'].forEach((ev) => z.addEventListener(ev, (e) => { e.preventDefault(); z.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => z.addEventListener(ev, (e) => { e.preventDefault(); z.classList.remove('drag'); }));
    z.addEventListener('drop', (e) => say(e.dataTransfer?.files));
    input?.addEventListener('change', () => say(input.files));
  });

  // Live input mirror (social planner preview)
  $$('[data-mirror]').forEach((input) => {
    const targets = $$(input.dataset.mirror);
    const fallback = targets.map((t) => t.textContent);
    input.addEventListener('input', () => targets.forEach((t, i) => { t.textContent = input.value.trim() || fallback[i]; }));
  });

  // Quote slideshow (home). The track is a native scroll-snap row, so swiping works without
  // this. Adds: auto-advance every 6.5s while it's on screen; holds while hovered, focused or
  // the tab is hidden; stops for good once someone swipes, taps a dot or an arrow, or presses
  // pause; never auto-plays for people who ask for reduced motion.
  $$('[data-carousel]').forEach((root) => {
    const track = $('[data-track]', root);
    const slides = $$('[data-slide]', root);
    const dots = $$('[data-go]', root);
    const playBtn = $('[data-play]', root);
    if (!track || slides.length < 2) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let i = 0;
    let playing = !reduce.matches;
    let held = false;
    let onScreen = false;
    let timer = null;
    const show = (n) => {
      i = (n + slides.length) % slides.length;
      dots.forEach((d, k) => d.setAttribute('aria-current', String(k === i)));
      slides.forEach((sl, k) => { if (k === i) sl.removeAttribute('aria-hidden'); else sl.setAttribute('aria-hidden', 'true'); });
    };
    const go = (n) => {
      const k = (n + slides.length) % slides.length;
      track.scrollTo({ left: slides[k].offsetLeft - slides[0].offsetLeft, behavior: reduce.matches ? 'auto' : 'smooth' });
      show(k);
    };
    const tick = () => {
      clearTimeout(timer);
      if (playing && !held && onScreen && !document.hidden) timer = setTimeout(() => { go(i + 1); tick(); }, 6500);
    };
    const setPlaying = (on) => {
      playing = on;
      playBtn.setAttribute('aria-label', on ? 'Pause the quotes' : 'Play the quotes');
      $('[data-when-playing]', playBtn).hidden = !on;
      $('[data-when-paused]', playBtn).hidden = on;
      // Screen readers hear each new quote only when it changes because someone asked.
      track.setAttribute('aria-live', on ? 'off' : 'polite');
      tick();
    };
    playBtn.hidden = false;
    playBtn.addEventListener('click', () => setPlaying(!playing));
    dots.forEach((d) => d.addEventListener('click', () => { setPlaying(false); go(Number(d.dataset.go)); }));
    $('[data-prev]', root)?.addEventListener('click', () => { setPlaying(false); go(i - 1); });
    $('[data-next]', root)?.addEventListener('click', () => { setPlaying(false); go(i + 1); });
    track.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); setPlaying(false); go(i + (e.key === 'ArrowRight' ? 1 : -1));
    });
    // A swipe: follow the slide it settles on, and stop auto-play.
    track.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') setPlaying(false); });
    track.addEventListener('wheel', (e) => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) setPlaying(false); }, { passive: true });
    let settle = null;
    track.addEventListener('scroll', () => {
      clearTimeout(settle);
      settle = setTimeout(() => { const n = Math.round(track.scrollLeft / track.clientWidth); if (n !== i) show(n); }, 80);
    }, { passive: true });
    root.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { held = true; tick(); } });
    root.addEventListener('pointerleave', () => { held = false; tick(); });
    root.addEventListener('focusin', () => { held = true; tick(); });
    root.addEventListener('focusout', (e) => { if (!root.contains(e.relatedTarget)) { held = false; tick(); } });
    document.addEventListener('visibilitychange', tick);
    reduce.addEventListener?.('change', () => { if (reduce.matches) setPlaying(false); });
    if ('IntersectionObserver' in window) new IntersectionObserver(([en]) => { onScreen = en.isIntersecting; tick(); }, { threshold: 0.5 }).observe(root);
    else onScreen = true;
    show(0);
    setPlaying(playing);
  });

  // Settings rows with a switch: tapping anywhere on the row flips it (bigger touch target,
  // like iOS Settings). The switch keeps its own click handler.
  document.addEventListener('click', (e) => {
    const row = e.target.closest('[data-tap-row]');
    if (!row || e.target.closest('button, a, input, select, textarea, label')) return;
    row.querySelector('.switch')?.click();
  });
})();
