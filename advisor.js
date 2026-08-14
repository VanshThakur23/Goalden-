/* =====================================================================
   advisor.js — the Goalden AI advisor, shared across all four pages.

   Loaded once per page via a plain <script src="advisor.js"></script> tag,
   placed AFTER the page's own inline script. The inline script defines
   window.GOALDEN_ADVISOR_CONFIG with the page-specific pieces:
     { state, knowledge, app, pageLabel, tools, page, screens, executeTool,
       lang, greeting, placeholder, showDisclaimer }
   and advisor.js reads from that object. Everything identical across the
   four pages lives here (CSS, panel/canvas HTML, persistence, thinking
   indicator, the tool loop, voice + caption, and all DOM wiring).

   This was extracted (Part E0) because the block had been copy-pasted into
   four files and already drifted once (a missing brace in run_monte_carlo).
   A syntax error here now breaks every page at once, so treat this file as
   load-bearing.
   ===================================================================== */
'use strict';

const ADVISOR_CFG = window.GOALDEN_ADVISOR_CONFIG || {};
const advTools = (typeof ADVISOR_CFG.tools === 'function') ? ADVISOR_CFG.tools : (() => []);
const advPage = (typeof ADVISOR_CFG.page === 'function') ? ADVISOR_CFG.page : (() => null);
const advScreens = (typeof ADVISOR_CFG.screens === 'function') ? ADVISOR_CFG.screens : (() => []);
const advExecuteTool = (typeof ADVISOR_CFG.executeTool === 'function') ? ADVISOR_CFG.executeTool : ((name, args) => JSON.stringify({ ok:false, error:'advisor not configured' }));
const advLang = (typeof ADVISOR_CFG.lang === 'function') ? ADVISOR_CFG.lang : (() => 'en-IN');

/* =====================================================================
   CSS — injected once. Uses the page's own :root tokens (--gold, --card,
   --ink, --bg) so it stays on-palette everywhere. Includes E1a (roomier
   panel + larger message text), E1b (the speech caption bar), and the
   disclaimer rule (only rendered when showDisclaimer is true).
   ===================================================================== */
const ADVISOR_CSS = `
#advisorFab{position:fixed;right:18px;bottom:18px;z-index:1000;width:56px;height:56px;border-radius:50%;background:var(--gold);color:#fff;border:none;box-shadow:0 6px 20px rgba(20,40,63,.35);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform .15s ease}
#advisorFab:hover{transform:translateY(-2px)}
#advisorFab svg{width:26px;height:26px}
#advisorPanel{position:fixed;right:18px;bottom:86px;z-index:1001;width:460px;max-width:calc(100vw - 36px);max-height:min(75vh,720px);display:none;flex-direction:column;background:var(--card);border:1px solid rgba(20,40,63,.14);border-radius:14px;box-shadow:0 12px 40px rgba(20,40,63,.28);overflow:hidden}
#advisorPanel.open{display:flex}
#advisorHead{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid rgba(20,40,63,.1);background:var(--bg)}
#advisorHead .t{font-family:'Newsreader',serif;font-weight:700;font-size:15px;color:var(--ink)}
#advisorHead .s{font-family:'Spline Sans Mono',monospace;font-size:9.5px;color:rgba(20,40,63,.5);letter-spacing:.04em;text-transform:uppercase}
#advisorClose{background:none;border:none;color:rgba(20,40,63,.55);cursor:pointer;font-size:16px;padding:2px 4px}
#advisorMsgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}
.adv-msg{max-width:88%;padding:11px 14px;border-radius:12px;font-size:15.5px;line-height:1.55;white-space:pre-wrap;word-wrap:break-word}
.adv-msg.user{align-self:flex-end;background:var(--gold);color:#fff;border-bottom-right-radius:3px;font-family:'Figtree',sans-serif}
.adv-msg.bot{align-self:flex-start;background:#EFF3FA;color:var(--ink);border-bottom-left-radius:3px;font-family:'Figtree',sans-serif}
.adv-msg.sys{align-self:flex-start;background:transparent;color:rgba(20,40,63,.5);font-family:'Spline Sans Mono',monospace;font-size:11px;padding:0 4px}
#advisorInput{display:flex;gap:8px;padding:10px 12px;border-top:1px solid rgba(20,40,63,.1);background:var(--bg)}
#advisorInput textarea{flex:1;resize:none;border:1px solid rgba(20,40,63,.18);border-radius:9px;padding:9px 11px;font-family:'Figtree',sans-serif;font-size:15px;line-height:1.4;max-height:90px;outline:none;background:#fff}
#advisorInput textarea:focus{border-color:var(--gold)}
#advisorSend{background:var(--gold);color:#fff;border:none;border-radius:9px;padding:0 16px;font-family:'Figtree',sans-serif;font-weight:700;font-size:14.5px;cursor:pointer}
#advisorSend:disabled{opacity:.5;cursor:default}
#advisorMic{background:none;border:1px solid rgba(20,40,63,.18);border-radius:9px;width:38px;flex-shrink:0;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--ink)}
#advisorMic svg{width:18px;height:18px}
#advisorMic.hidden{display:none}
#advisorMic.listening{background:var(--gold);color:#fff;border-color:var(--gold);animation:advisorPulse 1s infinite}
@keyframes advisorPulse{0%,100%{box-shadow:0 0 0 0 rgba(37,87,199,.4)}50%{box-shadow:0 0 0 8px rgba(37,87,199,0)}}
#advisorVoice{background:none;border:none;color:rgba(20,40,63,.55);cursor:pointer;font-size:15px;padding:2px 4px}
#advisorVoice.off{opacity:.4}
.adv-thinking{animation:advisorBlink 1s ease-in-out infinite}
@keyframes advisorBlink{0%,100%{opacity:.35}50%{opacity:1}}
.advisor-pulse{animation:advisorPulseOutline 1.6s ease}
@keyframes advisorPulseOutline{0%{box-shadow:0 0 0 0 rgba(37,87,199,.45)}70%{box-shadow:0 0 0 14px rgba(37,87,199,0)}100%{box-shadow:0 0 0 0 rgba(37,87,199,0)}}
.advisor-disclaimer{padding:7px 14px;font-family:'Spline Sans Mono',monospace;font-size:9.5px;color:rgba(20,40,63,.5);border-bottom:1px solid rgba(20,40,63,.08);background:#FBFCFE}
#advisorCaption{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2000;max-width:min(760px,calc(100vw - 28px));background:var(--card);color:var(--ink);border:1px solid rgba(20,40,63,.14);border-radius:14px;box-shadow:0 12px 40px rgba(20,40,63,.3);padding:16px 22px;font-family:'Figtree',sans-serif;font-size:21px;line-height:1.45;cursor:pointer;text-align:left}
#resultCanvas{position:fixed;left:18px;bottom:18px;z-index:1000;width:420px;max-width:calc(100vw - 36px);max-height:70vh;background:var(--card);border:1px solid rgba(20,40,63,.14);border-radius:14px;box-shadow:0 12px 40px rgba(20,40,63,.28);display:none;flex-direction:column;overflow:hidden}
#resultCanvas.open{display:flex}
#resultCanvas.minimized{width:auto;max-height:none}
#resultCanvas.minimized #resultCanvasBody{display:none}
#resultCanvasHead{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(20,40,63,.1);background:var(--bg);flex-shrink:0}
#resultCanvasTitle{font-family:'Newsreader',serif;font-weight:700;font-size:14px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#resultCanvasHead .rc-btns{display:flex;align-items:center;gap:2px;flex-shrink:0}
#resultCanvasHead button{background:none;border:none;color:rgba(20,40,63,.55);cursor:pointer;font-size:15px;padding:2px 6px;line-height:1}
#resultCanvasBody{flex:1;overflow-y:auto;padding:14px;-webkit-overflow-scrolling:touch}
@media(max-width:480px){
  #advisorPanel{left:0;right:0;bottom:0;width:auto;max-width:none;height:90vh;max-height:90vh;border-radius:0;border:none}
  #advisorFab{right:12px;bottom:12px}
  #resultCanvas{left:0;right:0;bottom:0;width:auto;max-width:none;max-height:60vh;border-radius:0;border:none}
}
@media(prefers-reduced-motion:reduce){#resultCanvas{transition:none}}
`;
(function injectAdvisorCss() {
  const s = document.createElement('style');
  s.textContent = ADVISOR_CSS;
  document.head.appendChild(s);
})();

/* =====================================================================
   HTML — the floating FAB, chat panel, speech caption, and results canvas.
   Injected into <body> so it survives every render() call.
   ===================================================================== */
(function injectAdvisorHtml() {
  const placeholder = ADVISOR_CFG.placeholder || 'Ask, or tap the mic…';
  const disclaimer = ADVISOR_CFG.showDisclaimer
    ? '<div class="advisor-disclaimer">Not licensed financial advice — I explain and compare, I don\'t tell you what to buy.</div>'
    : '';
  const html =
    '<button id="advisorFab" aria-label="Ask the Goalden advisor" title="Ask the advisor">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-2.9-.4-4.1-1L3 20l1-5.4a8.5 8.5 0 1 1 17-3.1z"/></svg>' +
    '</button>' +
    '<div id="advisorPanel">' +
      '<div id="advisorHead">' +
        '<div><div class="t">Goalden advisor</div><div class="s">Ask me anything</div></div>' +
        '<div style="display:flex;align-items:center;gap:2px">' +
          '<button id="advisorVoice" aria-label="Speak replies aloud" title="Speak replies aloud">🔊</button>' +
          '<button id="advisorClose" aria-label="Close">✕</button>' +
        '</div>' +
      '</div>' +
      disclaimer +
      '<div id="advisorMsgs" role="log" aria-live="polite" aria-label="Advisor conversation"></div>' +
      '<div id="advisorInput">' +
        '<button id="advisorMic" aria-label="Speak your question" title="Speak your question"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1"/><path d="M12 18v4"/></svg></button>' +
        '<textarea id="advisorText" rows="1" placeholder="' + placeholder + '"></textarea>' +
        '<button id="advisorSend">Send</button>' +
      '</div>' +
    '</div>' +
    '<div id="resultCanvas" aria-label="Result">' +
      '<div id="resultCanvasHead">' +
        '<div id="resultCanvasTitle">Result</div>' +
        '<div class="rc-btns">' +
          '<button id="resultCanvasMin" aria-label="Minimize" title="Minimize">&minus;</button>' +
          '<button id="resultCanvasClose" aria-label="Close" title="Close">✕</button>' +
        '</div>' +
      '</div>' +
      '<div id="resultCanvasBody"></div>' +
    '</div>';
  document.body.insertAdjacentHTML('beforeend', html);
})();

/* =====================================================================
   State — conversation + persistence (sessionStorage, shared key).
   ===================================================================== */
const ADVISOR_STORE_KEY = 'goalden_advisor_v1';
const advisor = { messages: [], busy: false };
let advisorThinkingEl = null;
const advisorVoice = { on: true, listening: false, rec: null };
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

function advisorPersist(open) {
  try {
    const panelOpen = open !== undefined ? open : document.getElementById('advisorPanel').classList.contains('open');
    sessionStorage.setItem(ADVISOR_STORE_KEY, JSON.stringify({ messages: advisor.messages, open: panelOpen }));
  } catch (e) {}
}

function advisorTrim() {
  const MAX = 24;
  if (advisor.messages.length <= MAX) return;
  const firstUser = advisor.messages.find((m) => m.role === 'user');
  let tail = advisor.messages.slice(-MAX);
  if (firstUser && tail.indexOf(firstUser) === -1) tail = [firstUser].concat(tail.slice(0, MAX - 1));
  advisor.messages = tail;
}

function advisorAddMsg(role, text) {
  const msgs = document.getElementById('advisorMsgs');
  const div = document.createElement('div');
  div.className = 'adv-msg ' + role;
  div.textContent = text;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

function advisorRenderHistory() {
  const msgs = document.getElementById('advisorMsgs');
  msgs.innerHTML = '';
  advisor.messages.forEach((m) => {
    if (m.role === 'user') advisorAddMsg('user', m.content);
    else if (m.role === 'assistant' && m.content) advisorAddMsg('bot', m.content);
  });
}

function advisorRehydrate() {
  try {
    const raw = sessionStorage.getItem(ADVISOR_STORE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data.messages) && data.messages.length) {
      advisor.messages = data.messages;
      advisorRenderHistory();
      advisor.messages.push({ role: 'system', content: '[navigation] The user is now on ' + (ADVISOR_CFG.pageLabel || 'a new page') + '. The available screens and tools changed to match this page.' });
    }
    if (data.open) document.getElementById('advisorPanel').classList.add('open');
  } catch (e) {}
}

function advisorShowThinking() {
  advisorHideThinking();
  const msgs = document.getElementById('advisorMsgs');
  const div = document.createElement('div');
  div.className = 'adv-msg bot adv-thinking';
  div.textContent = '…';
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  advisorThinkingEl = div;
}
function advisorHideThinking() {
  if (advisorThinkingEl && advisorThinkingEl.parentNode) advisorThinkingEl.parentNode.removeChild(advisorThinkingEl);
  advisorThinkingEl = null;
}

/* =====================================================================
   Voice — TTS + STT. E1b caption + E1c voice selection.
   ===================================================================== */
const voiceCache = {};
let captionEl = null;
let captionTimer = null;
// Monotonic id so a cancelled utterance's late onend/onerror can't hide the
// caption of the NEXT utterance (speechSynthesis fires those callbacks on the
// next tick after cancel(), by which point a newer utterance may be showing).
let advisorSpeechId = 0;

function advisorStopSpeech() {
  advisorSpeechId++;
  advisorHideCaption();
  try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch (e) {}
}

function advisorSpeakText(text) {
  return String(text || '')
    .replace(/[*_`#>]/g, '')
    .replace(/₹/g, ' rupees ')
    .replace(/\$/g, ' dollars ')
    .replace(/\s+/g, ' ').trim();
}

// Pick the best available voice for a language: prefer modern/neural voices
// ("Natural", "Neural", "Online", "Google") over legacy SAPI ones, then match
// the exact locale, then the default. Cached per language; can only choose
// from voices actually installed on the user's machine.
function advisorPickVoice(lang) {
  if (voiceCache[lang] !== undefined) return voiceCache[lang];
  if (!('speechSynthesis' in window)) { voiceCache[lang] = null; return null; }
  const voices = window.speechSynthesis.getVoices() || [];
  const base = (lang || '').split('-')[0].toLowerCase();
  const candidates = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith(base));
  const pool = candidates.length ? candidates : voices;
  let best = null, bestScore = -1;
  pool.forEach((v) => {
    let score = 0;
    const name = (v.name || '').toLowerCase();
    ['natural', 'neural', 'online', 'google'].forEach((kw) => { if (name.indexOf(kw) !== -1) score += 2; });
    if (v.lang && v.lang.toLowerCase() === String(lang).toLowerCase()) score += 1;
    if (v.default) score += 1;
    if (score > bestScore) { bestScore = score; best = v; }
  });
  voiceCache[lang] = best || null;
  return best || null;
}
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = function () { for (const k in voiceCache) delete voiceCache[k]; };
  try { window.speechSynthesis.getVoices(); } catch (e) {}
}

function advisorHideCaption() {
  if (captionTimer) { clearTimeout(captionTimer); captionTimer = null; }
  if (captionEl && captionEl.parentNode) captionEl.parentNode.removeChild(captionEl);
  captionEl = null;
}
function advisorShowCaption(text) {
  advisorHideCaption();
  captionEl = document.createElement('div');
  captionEl.id = 'advisorCaption';
  captionEl.textContent = text;
  captionEl.addEventListener('click', advisorHideCaption);
  document.body.appendChild(captionEl);
}

function advisorSpeak(text) {
  if (!advisorVoice.on || !text) return;
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const id = ++advisorSpeechId;
    const clean = advisorSpeakText(text);
    const lang = advLang();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = lang;
    u.rate = 1.0;
    const v = advisorPickVoice(lang);
    if (v) u.voice = v;
    u.onend = function () { if (id === advisorSpeechId) captionTimer = setTimeout(advisorHideCaption, 2500); };
    u.onerror = function () { if (id === advisorSpeechId) advisorHideCaption(); };
    advisorShowCaption(clean);
    window.speechSynthesis.speak(u);
  } catch (e) {}
}

function advisorStopListening() {
  advisorVoice.listening = false;
  const mic = document.getElementById('advisorMic');
  if (mic) mic.classList.remove('listening');
  if (advisorVoice.rec) { try { advisorVoice.rec.stop(); } catch (e) {} advisorVoice.rec = null; }
}

function advisorStartListening() {
  if (!SpeechRec) return;
  advisorStopListening();
  const rec = new SpeechRec();
  advisorVoice.rec = rec;
  rec.lang = advLang();
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  advisorVoice.listening = true;
  const mic = document.getElementById('advisorMic');
  if (mic) mic.classList.add('listening');
  rec.onresult = (e) => {
    const text = e.results && e.results[0] && e.results[0][0] ? e.results[0][0].transcript : '';
    advisorStopListening();
    if (!text) return;
    document.getElementById('advisorText').value = text;
    advisorSend();
  };
  rec.onerror = () => advisorStopListening();
  rec.onend = () => advisorStopListening();
  try { rec.start(); } catch (e) { advisorStopListening(); }
}

/* =====================================================================
   Results canvas machinery (shared). The page's advisorShowResult calls
   resultCanvasOpen with HTML it builds from the page's own chart functions.
   ===================================================================== */
function isMobile() {
  try { return window.matchMedia('(max-width:480px)').matches; } catch (e) { return false; }
}
function advisorMinimizeToFab() {
  const p = document.getElementById('advisorPanel');
  if (p.classList.contains('open')) {
    p.classList.remove('open');
    document.getElementById('advisorFab').setAttribute('aria-expanded', 'false');
  }
}
function resultCanvasOpen(title, html) {
  if (isMobile()) advisorMinimizeToFab();
  const el = document.getElementById('resultCanvas');
  document.getElementById('resultCanvasTitle').textContent = title;
  document.getElementById('resultCanvasBody').innerHTML = html;
  el.classList.add('open');
  el.classList.remove('minimized');
}
function resultCanvasToggleMin() {
  document.getElementById('resultCanvas').classList.toggle('minimized');
}
function resultCanvasClose() {
  const el = document.getElementById('resultCanvas');
  el.classList.remove('open', 'minimized');
  document.getElementById('resultCanvasBody').innerHTML = '';
}

/* =====================================================================
   Tool loop — POST /api/chat, execute tool calls, feed results back, loop
   until the model produces a plain-text reply.
   ===================================================================== */
async function advisorLoop() {
  for (let step = 0; step < 6; step++) {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: advisor.messages,
        tools: advTools(),
        state: ADVISOR_CFG.state || {},
        knowledge: ADVISOR_CFG.knowledge || '',
        context: { page: advPage(), app: ADVISOR_CFG.app || 'Goalden', screens: advScreens() },
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || ('Server responded ' + resp.status));
    }
    const data = await resp.json();
    const msg = data.message || {};
    if (msg.tool_calls && msg.tool_calls.length) {
      advisor.messages.push({ role: 'assistant', content: msg.content || null, tool_calls: msg.tool_calls });
      for (const tc of msg.tool_calls) {
        const name = tc.function && tc.function.name;
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) { args = {}; }
        advisorAddMsg('sys', '… ' + name + (Object.keys(args).length ? ' ' + JSON.stringify(args) : ''));
        let result = advExecuteTool(name, args);
        if (result && typeof result.then === 'function') result = await result;
        advisor.messages.push({ role: 'tool', tool_call_id: tc.id, name: name, content: result });
      }
      advisorTrim();
      advisorPersist();
      continue;
    }
    if (msg.content) {
      advisorHideThinking();
      advisorAddMsg('bot', msg.content);
      advisor.messages.push({ role: 'assistant', content: msg.content });
      advisorSpeak(msg.content);
    } else {
      advisorHideThinking();
      advisorAddMsg('sys', 'The advisor returned an empty reply.');
    }
    advisorTrim();
    advisorPersist();
    return;
  }
  advisorAddMsg('sys', 'The advisor is taking too many steps — please ask something more specific.');
}

async function advisorSend() {
  if (advisor.busy) return;
  advisorStopSpeech();
  const ta = document.getElementById('advisorText');
  const text = ta.value.trim();
  if (!text) return;
  ta.value = '';
  advisorAddMsg('user', text);
  advisor.messages.push({ role: 'user', content: text });
  advisorPersist();
  advisor.busy = true;
  document.getElementById('advisorSend').disabled = true;
  try {
    advisorShowThinking();
    await advisorLoop();
  } catch (e) {
    advisorHideThinking();
    console.error('[advisor]', e);
    const msg = (e && e.message) ? e.message : '';
    if (/DEEPSEEK_API_KEY|secret is not set|api key/i.test(msg)) {
      advisorAddMsg('sys', "The advisor isn't switched on yet — the site owner needs to add an API key.");
    } else {
      advisorAddMsg('sys', 'Could not reach the advisor: ' + (msg || e));
    }
  } finally {
    advisorHideThinking();
    advisor.busy = false;
    document.getElementById('advisorSend').disabled = false;
  }
}

/* =====================================================================
   DOM wiring — everything below runs once, after the HTML is injected.
   ===================================================================== */
document.getElementById('advisorMic').addEventListener('click', () => {
  if (advisorVoice.listening) advisorStopListening();
  else advisorStartListening();
});
if (!SpeechRec) document.getElementById('advisorMic').classList.add('hidden');
document.getElementById('advisorVoice').addEventListener('click', () => {
  advisorVoice.on = !advisorVoice.on;
  document.getElementById('advisorVoice').classList.toggle('off', !advisorVoice.on);
  if (!advisorVoice.on) advisorStopSpeech();
});
document.getElementById('advisorFab').addEventListener('click', () => {
  const p = document.getElementById('advisorPanel');
  p.classList.toggle('open');
  document.getElementById('advisorFab').setAttribute('aria-expanded', p.classList.contains('open') ? 'true' : 'false');
  if (p.classList.contains('open')) {
    if (isMobile()) {
      const cv = document.getElementById('resultCanvas');
      if (cv.classList.contains('open') && !cv.classList.contains('minimized')) cv.classList.add('minimized');
    }
    if (!document.getElementById('advisorMsgs').children.length) {
      advisorAddMsg('bot', ADVISOR_CFG.greeting || 'Hi! Ask me anything about your plan.');
    }
    try { document.getElementById('advisorText').focus(); } catch (e) {}
  }
  advisorPersist();
});
document.getElementById('advisorClose').addEventListener('click', () => {
  document.getElementById('advisorPanel').classList.remove('open');
  document.getElementById('advisorFab').setAttribute('aria-expanded', 'false');
  advisorStopSpeech();
  advisorPersist(false);
  try { document.getElementById('advisorFab').focus(); } catch (e) {}
});
document.getElementById('advisorSend').addEventListener('click', advisorSend);
document.getElementById('advisorText').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); advisorSend(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('advisorPanel').classList.contains('open')) {
    document.getElementById('advisorPanel').classList.remove('open');
    document.getElementById('advisorFab').setAttribute('aria-expanded', 'false');
    advisorStopSpeech();
    advisorPersist(false);
    try { document.getElementById('advisorFab').focus(); } catch (e) {}
  }
});
document.getElementById('resultCanvasMin').addEventListener('click', (e) => { e.stopPropagation(); resultCanvasToggleMin(); });
document.getElementById('resultCanvasClose').addEventListener('click', (e) => { e.stopPropagation(); resultCanvasClose(); });
document.getElementById('resultCanvasHead').addEventListener('click', () => {
  const el = document.getElementById('resultCanvas');
  if (el.classList.contains('minimized')) el.classList.remove('minimized');
});
document.addEventListener('keydown', (e) => {
  const cv = document.getElementById('resultCanvas');
  if (e.key === 'Escape' && cv.classList.contains('open') && !cv.classList.contains('minimized')) {
    resultCanvasToggleMin();
  }
});

advisorRehydrate();
