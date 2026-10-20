/* One accessible tooltip for every jargon term and "i" icon on the three tool pages
   (the landing page has none). Before this, the Lab's 86 tips opened on mouse hover
   only, the Full Plan wired a new document click listener on every render, and
   Quick Calculate's icons could not take keyboard focus. This reads the markup that
   was already there, so no call site had to change:
     .term[data-def]       a dotted-underline word
     .term-i[data-def]     a small "i" (Quick Calculate, Full Plan)
     .info-icon > .ii-tip  the Lab's "i", with its text kept hidden in the DOM
   Optional data-you="..." on any of them adds one sentence worked out from the
   user's own numbers, under the definition.
   Mouse hover, keyboard focus and tap all open it. Esc, a tap outside, the x, or
   moving the pointer away closes it. On a phone it is a bottom sheet.
   Everything is set with textContent: nothing from data-def or data-you is ever
   parsed as HTML.
   Shared by file (like advisor.js) rather than pasted into three pages, so a fix
   lands everywhere at once. */
(function () {
  'use strict';
  const SEL = '.term,.info-icon,.term-i';
  // z-index above the advisor button (1000) and panel (1001), so the phone sheet is never
  // covered by them; below the briefing overlay (3000).
  const CSS = `
.gtip-pop{position:fixed;left:0;top:0;z-index:1200;width:max-content;max-width:min(320px,calc(100vw - 24px));background:#FFFFFF;border:1px solid rgba(37,87,199,.35);
  border-radius:3px 10px 10px 10px;box-shadow:0 10px 26px rgba(20,40,63,.16);padding:10px 12px;font-family:'Figtree',sans-serif;
  font-size:12.5px;font-weight:400;font-style:normal;line-height:1.45;color:rgba(20,40,63,.86);text-align:left;white-space:normal;
  opacity:0;transform:translateY(3px);transition:opacity .14s ease-out,transform .14s ease-out}
.gtip-pop:focus{outline:none}
.gtip-pop.open{opacity:1;transform:none}
.gtip-pop[hidden]{display:none}
.gtip-you{margin-top:7px;padding:6px 8px;border-radius:7px;background:rgba(37,87,199,.08);color:#14283F}
.gtip-x{display:none;float:right;margin:-6px -6px 2px 8px;width:28px;height:28px;border:0;border-radius:50%;background:none;color:#52647F;font-size:17px;line-height:1;cursor:pointer}
.gtip-pop.pin .gtip-x{display:block}
.gtip-x:hover{background:rgba(37,87,199,.08)}
.term,.info-icon,.term-i{cursor:help}
/* The drawn icon is 14px; this pads the touch target out to about 24px without moving anything. */
.info-icon::after,.term-i::after{content:'';position:absolute;top:-5px;right:-5px;bottom:-5px;left:-5px}
.term[aria-expanded="true"],.info-icon[aria-expanded="true"],.term-i[aria-expanded="true"]{color:var(--gold,#2557C7);border-color:var(--gold,#2557C7)}
.term:focus-visible,.info-icon:focus-visible,.term-i:focus-visible,.gtip-x:focus-visible{outline:2px solid #2557C7;outline-offset:2px;border-radius:3px}
@media (max-width:560px){
  .gtip-pop{left:0!important;right:0;top:auto!important;bottom:0;width:auto;max-width:none;border-radius:14px 14px 0 0;padding:14px 16px 20px;font-size:14px}
  .gtip-pop .gtip-x{display:block}
}
@media (prefers-reduced-motion:reduce){.gtip-pop{transition:none;transform:none}}`;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const pop = document.createElement('div');
  pop.className = 'gtip-pop'; pop.id = 'gtip'; pop.hidden = true; pop.tabIndex = -1;
  pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-modal', 'false'); pop.setAttribute('aria-label', 'Explanation');
  document.body.appendChild(pop);

  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const sheet = () => window.matchMedia('(max-width:560px)').matches;
  const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let owner = null, pinned = false, tOpen = 0, tClose = 0, refocusing = false;

  const defOf = el => (el.dataset.def || ((el.querySelector('.ii-tip') || {}).textContent || '')).trim();

  // The words before the icon name it ("Worst fall", "Already saved for retirement"), so a
  // screen reader hears which "i" this is instead of 76 identical "What does this mean?".
  function labelFor(el) {
    const clean = s => s.replace(/\s+/g, ' ').replace(/[\s:,;·–—-]+$/, '').trim();
    let text = '';
    for (let n = el.parentElement && el.parentElement.firstChild; n && n !== el; n = n.nextSibling) {
      if (n.nodeType === 3) text += n.nodeValue;
      else if (n.nodeType === 1 && !n.matches('.info-icon,.term-i')) text += n.textContent;
    }
    text = clean(text);
    if (!text && el.previousElementSibling) text = clean(el.previousElementSibling.textContent);
    // A heading or label can be long and still be the name; a sentence is not, so take its last few words.
    const cap = el.parentElement && el.parentElement.matches('h1,h2,h3,h4,h5,h6,label,legend,.stat-label,.section-label') ? 90 : 48;
    if (text.length > cap) text = text.split(' ').slice(-5).join(' ');
    return text || 'this';
  }

  // A control inside a button or link cannot also be a button: nested interactive elements
  // are invalid and the inner one is unreachable for many screen readers. Leave those alone.
  const nested = el => !!(el.parentElement && el.parentElement.closest('button,a[href],summary,[role="button"]'));

  function enhance(root) {
    const list = root && root.querySelectorAll ? Array.from(root.querySelectorAll(SEL)) : Array.from(document.querySelectorAll(SEL));
    if (root && root.matches && root.matches(SEL)) list.push(root);
    list.forEach(el => {
      if (el.dataset.gtip) return;
      if (nested(el)) { el.dataset.gtip = 'nested'; return; }
      el.dataset.gtip = '1'; el.tabIndex = 0;
      el.setAttribute('role', 'button'); el.setAttribute('aria-expanded', 'false'); el.setAttribute('aria-haspopup', 'dialog');
      if (!el.hasAttribute('aria-label') && !el.matches('.term')) el.setAttribute('aria-label', 'More about ' + labelFor(el));
    });
  }
  const targetOf = e => {
    const el = e.target && e.target.closest ? e.target.closest(SEL) : null;
    return el && el.dataset.gtip === '1' ? el : null;
  };

  // position:fixed with viewport coordinates, not page coordinates: the pages scroll inside
  // inner containers (.result-scroll, .qbody), which would leave an absolutely placed box behind.
  function place(el) {
    if (sheet()) { pop.style.left = ''; pop.style.top = ''; return; }
    pop.style.left = '0px'; pop.style.top = '0px';   // measure from a known spot
    const r = el.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight, gap = 8;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const left = Math.max(12, Math.min(r.left + r.width / 2 - w / 2, vw - w - 12));
    const top = r.top - h - gap >= 8 ? r.top - h - gap : r.bottom + gap;   // above if it fits, as the old tips did
    pop.style.left = left + 'px';
    pop.style.top = Math.max(8, Math.min(top, vh - h - 8)) + 'px';
  }

  function open(el, pin) {
    clearTimeout(tOpen); clearTimeout(tClose);
    const def = defOf(el);
    if (!def) return;
    if (owner && owner !== el) release(owner);
    owner = el; pinned = !!pin;
    pop.textContent = '';
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'gtip-x'; x.setAttribute('aria-label', 'Close'); x.textContent = '×';
    x.addEventListener('click', () => close(true));
    const body = document.createElement('div');
    body.id = 'gtip-body';
    const d = document.createElement('div'); d.textContent = def; body.append(d);
    if (el.dataset.you) { const you = document.createElement('div'); you.className = 'gtip-you'; you.textContent = el.dataset.you; body.append(you); }
    pop.append(x, body);
    pop.classList.toggle('pin', pinned);
    pop.hidden = false; place(el);
    // On a phone the sheet is anchored to the bottom; if the word is under it, bring it into view.
    if (sheet() && el.getBoundingClientRect().bottom > window.innerHeight - pop.offsetHeight - 8) el.scrollIntoView({ block: 'center', behavior: still() ? 'auto' : 'smooth' });
    if (still()) pop.classList.add('open'); else requestAnimationFrame(() => pop.classList.add('open'));
    el.setAttribute('aria-expanded', 'true'); el.setAttribute('aria-controls', 'gtip'); el.setAttribute('aria-describedby', 'gtip-body');
  }
  function release(el) {
    el.setAttribute('aria-expanded', 'false'); el.removeAttribute('aria-controls'); el.removeAttribute('aria-describedby');
  }
  function close(returnFocus) {
    clearTimeout(tOpen); clearTimeout(tClose);
    if (!owner) return;
    const el = owner; owner = null; pinned = false;
    release(el);
    pop.classList.remove('open'); pop.hidden = true;
    if (returnFocus && document.contains(el)) { refocusing = true; el.focus(); refocusing = false; }
  }
  const soon = () => { if (!pinned) { clearTimeout(tClose); tClose = setTimeout(() => close(false), 180); } };
  const toggle = el => { if (owner === el && pinned) close(false); else open(el, true); };

  // Delegated on document, so it covers whatever each render() writes. The mouse path is
  // gated on a real pointer: on a touch screen the synthetic mouse events would flash the tip.
  if (canHover) {
    document.addEventListener('mouseover', e => {
      const el = targetOf(e);
      if (el) {
        if (pinned && owner !== el) return;
        clearTimeout(tClose);
        if (owner !== el) { clearTimeout(tOpen); tOpen = setTimeout(() => open(el, false), 120); }
      } else if (pop.contains(e.target)) clearTimeout(tClose);
    });
    document.addEventListener('mouseout', e => {
      const from = targetOf(e) || (pop.contains(e.target) ? pop : null);
      if (!from) return;
      if (e.relatedTarget && (pop.contains(e.relatedTarget) || (owner && owner.contains(e.relatedTarget)))) return;
      clearTimeout(tOpen); soon();
    });
  }
  document.addEventListener('focusin', e => {
    const el = targetOf(e);
    if (el && !refocusing && el.matches(':focus-visible') && owner !== el) open(el, false);
  });
  document.addEventListener('focusout', e => {
    if (!owner || (e.target !== owner && e.target !== pop)) return;
    if (e.relatedTarget && (pop.contains(e.relatedTarget) || e.relatedTarget === owner)) return;
    close(false);
  });
  // Capture phase: a term can sit inside a clickable row or card, and the tooltip must not also
  // trigger that row (or a label's input, or a heading that expands).
  document.addEventListener('click', e => {
    const el = targetOf(e);
    if (el) { e.preventDefault(); e.stopPropagation(); toggle(el); return; }
    if (owner && !pop.contains(e.target)) close(false);
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && owner) {
      // Focus goes back to the word only if it was there (or in the tip): a tip opened by hover must not pull focus out of, say, the advisor's text box.
      const at = document.activeElement;
      e.stopPropagation(); close(at === owner || pop.contains(at) || at === document.body); return;
    }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = targetOf(e);
    if (el) { e.preventDefault(); e.stopPropagation(); toggle(el); }
  }, true);
  window.addEventListener('resize', () => { if (owner) place(owner); });
  document.addEventListener('scroll', () => {
    if (!owner || sheet()) return;
    const r = owner.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) close(false); else place(owner);
  }, { capture: true, passive: true });

  // The pages re-render constantly (the Lab on every slider move). Watch only the page's own
  // container, and only for added nodes that hold a term: the observer is not allowed to cost
  // anything while a chart animates. A tooltip whose word was re-rendered away closes.
  const root = document.getElementById('stage') || document.getElementById('main');
  if (root) {
    new MutationObserver(records => {
      for (const m of records) m.addedNodes.forEach(n => { if (n.nodeType === 1) enhance(n); });
      if (owner && !document.contains(owner)) close(false);
    }).observe(root, { childList: true, subtree: true });
  }
  window.gtipEnhance = enhance;   // for anything mounted outside that container
  enhance();
})();
