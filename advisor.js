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
#advisorPanel.mode-dock{right:0;top:0;bottom:0;width:400px;max-width:100vw;height:100vh;max-height:100vh;border-radius:0;border-top:none;border-bottom:none;border-right:none}
#advisorPanel.mode-focus{left:0;right:0;top:5vh;bottom:5vh;margin:0 auto;width:680px;max-width:calc(100vw - 32px);height:90vh;max-height:90vh;border-radius:16px}
body.advisor-docked{transition:padding-right .25s ease}
@media(min-width:900px){body.advisor-docked{padding-right:400px}}
#advisorHead{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid rgba(20,40,63,.1);background:var(--bg)}
#advisorHead .t{font-family:'Newsreader',serif;font-weight:700;font-size:15px;color:var(--ink)}
#advisorHead .s{font-family:'Spline Sans Mono',monospace;font-size:9.5px;color:rgba(20,40,63,.5);letter-spacing:.04em;text-transform:uppercase}
#advisorHead .rc-btns{display:flex;align-items:center;gap:2px}
#advisorHead button{background:none;border:none;color:rgba(20,40,63,.55);cursor:pointer;font-size:15px;padding:2px 6px;line-height:1}
#advisorMsgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}
.adv-msg{max-width:88%;padding:11px 14px;border-radius:12px;font-size:15.5px;line-height:1.55;white-space:pre-wrap;word-wrap:break-word}
.adv-msg.user{align-self:flex-end;background:var(--gold);color:#fff;border-bottom-right-radius:3px;font-family:'Figtree',sans-serif}
.adv-msg.bot{align-self:flex-start;background:#EFF3FA;color:var(--ink);border-bottom-left-radius:3px;font-family:'Figtree',sans-serif}
.adv-msg.bot.speaking{border-left:3px solid var(--gold);animation:advisorSpeakingGlow 1.2s ease-in-out infinite}
@keyframes advisorSpeakingGlow{0%,100%{box-shadow:0 0 0 2px rgba(37,87,199,.12)}50%{box-shadow:0 0 0 6px rgba(37,87,199,.22)}}
.adv-msg.sys{align-self:flex-start;background:transparent;color:rgba(20,40,63,.5);font-family:'Spline Sans Mono',monospace;font-size:11px;padding:0 4px}
.adv-step{display:flex;align-items:flex-start;gap:7px;font-family:'Spline Sans Mono',monospace;font-size:11px;color:rgba(20,40,63,.55);padding:1px 2px;line-height:1.4}
.adv-step .adv-step-tick{color:var(--gold);font-weight:600;flex-shrink:0}
.adv-step.done{color:rgba(20,40,63,.4)}
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
  #advisorPanel,#advisorPanel.mode-dock,#advisorPanel.mode-focus{left:0;right:0;bottom:0;top:auto;width:auto;max-width:none;height:90vh;max-height:90vh;border-radius:0;border:none;margin:0}
  #advisorFab{right:12px;bottom:12px}
  #resultCanvas{left:0;right:0;bottom:0;width:auto;max-width:none;max-height:60vh;border-radius:0;border:none}
}
@media(prefers-reduced-motion:reduce){#resultCanvas{transition:none}}
#briefing{position:fixed;left:0;top:0;right:0;bottom:0;z-index:3000;background:var(--bg);display:none;flex-direction:column;overflow:hidden}
#briefing.open{display:flex}
#briefingHead{display:flex;align-items:center;justify-content:space-between;padding:14px 22px;border-bottom:1px solid rgba(20,40,63,.1);background:var(--card);flex-shrink:0}
#briefingHead .t{font-family:'Newsreader',serif;font-weight:700;font-size:22px;color:var(--ink)}
#briefingHead .rc-btns{display:flex;align-items:center;gap:2px}
#briefingHead button{background:none;border:none;color:rgba(20,40,63,.55);cursor:pointer;font-size:16px;padding:4px 8px;line-height:1}
#briefingBody{flex:1;overflow-y:auto;padding:26px 22px 60px;max-width:860px;margin:0 auto;width:100%}
#briefingIntro{font-family:'Newsreader',serif;font-size:18px;line-height:1.5;color:var(--ink);margin-bottom:22px}
.briefing-section{margin-bottom:26px}
.briefing-section h2{font-family:'Newsreader',serif;font-weight:600;font-size:19px;color:var(--ink);margin-bottom:10px}
.briefing-err{padding:12px 16px;background:rgba(20,40,63,.05);border:1px dashed rgba(20,40,63,.2);border-radius:10px;font-size:14px;color:rgba(20,40,63,.7);font-family:'Figtree',sans-serif}
.briefing-footer{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;padding-top:16px;border-top:1px solid rgba(20,40,63,.1)}
.briefing-footer button{background:var(--gold);color:#fff;border:none;border-radius:8px;padding:10px 16px;font-family:'Figtree',sans-serif;font-weight:600;font-size:13.5px;cursor:pointer}
@media print{#advisorFab,#advisorPanel,#resultCanvas{display:none!important}#briefing{position:static;display:block!important;background:#fff}#briefingHead .rc-btns{display:none!important}}
.advisor-chips{display:flex;flex-wrap:wrap;gap:6px;padding:2px 0 10px}
.advisor-chip{background:rgba(37,87,199,.08);border:1px solid rgba(37,87,199,.25);color:var(--gold);border-radius:999px;padding:5px 12px;font-family:'Figtree',sans-serif;font-size:12px;cursor:pointer;transition:background .15s ease}
.advisor-chip:hover{background:rgba(37,87,199,.16)}
.advisor-ask-link{background:none;border:none;color:var(--gold);cursor:pointer;font-family:'Spline Sans Mono',monospace;font-size:10.5px;padding:0;text-decoration:underline;margin-left:6px}
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
        '<div class="rc-btns">' +
          '<button id="advisorMode" aria-label="Dock or focus" title="Dock to the side / focus">⤢</button>' +
          '<button id="advisorVoice" aria-label="Speak replies aloud" title="Speak replies aloud">🔊</button>' +
          '<button id="advisorClear" aria-label="Clear chat" title="Clear chat" style="font-size:13px">🗑</button>' +
          '<button id="advisorClose" aria-label="Close" title="Close">✕</button>' +
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
    '</div>' +
    '<div id="briefing" aria-label="Briefing">' +
      '<div id="briefingHead">' +
        '<div class="t" id="briefingTitle">Briefing</div>' +
        '<div class="rc-btns">' +
          '<button id="briefingPrint" aria-label="Print / save" title="Print / save">🖶</button>' +
          '<button id="briefingClose" aria-label="Close" title="Close">✕</button>' +
        '</div>' +
      '</div>' +
      '<div id="briefingBody"></div>' +
    '</div>';
  document.body.insertAdjacentHTML('beforeend', html);
})();

/* =====================================================================
   State — conversation + persistence (sessionStorage, shared key).
   ===================================================================== */
const ADVISOR_STORE_KEY = 'goalden_advisor_v1';
const advisor = { messages: [], busy: false, mode: 'fab' };
let advisorThinkingEl = null;
const advisorVoice = { on: true, listening: false, rec: null };
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

// F1b — panel mode: 'fab' (collapsed), 'dock' (right edge, page shifts), or
// 'focus' (centred, large). Docked is what makes "the AI drives the page"
// legible — you watch the sliders move while reading what it's saying.
function advisorSetMode(mode) {
  advisor.mode = mode;
  const panel = document.getElementById('advisorPanel');
  const body = document.body;
  panel.classList.remove('mode-dock', 'mode-focus');
  body.classList.remove('advisor-docked');
  if (mode === 'dock') {
    panel.classList.add('mode-dock');
    if (!isMobile()) body.classList.add('advisor-docked');
    panel.classList.add('open');
  } else if (mode === 'focus') {
    panel.classList.add('mode-focus');
    panel.classList.add('open');
  } else {
    panel.classList.remove('open');
  }
  document.getElementById('advisorFab').setAttribute('aria-expanded', mode === 'fab' ? 'false' : 'true');
  advisorPersist();
}
// When the advisor starts acting, promote the panel to dock so the user can
// actually watch it drive the page (never force focus — that covers content).
function advisorEnterDock() {
  if (advisor.mode === 'fab') advisorSetMode('dock');
}

function advisorPersist(open) {
  try {
    const panelOpen = open !== undefined ? open : document.getElementById('advisorPanel').classList.contains('open');
    sessionStorage.setItem(ADVISOR_STORE_KEY, JSON.stringify({ messages: advisor.messages, open: panelOpen, mode: advisor.mode }));
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
    if (data.mode && data.mode !== 'fab') {
      advisorSetMode(data.mode);
    } else if (data.open) {
      advisorSetMode('dock');
    }
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
// Monotonic id so a cancelled utterance's late onend/onerror can't affect the
// NEXT utterance (speechSynthesis fires those callbacks on the next tick after
// cancel(), by which point a newer utterance may be playing).
let advisorSpeechId = 0;

function advisorUnmarkSpeaking() {
  const msgs = document.getElementById('advisorMsgs');
  if (msgs) msgs.querySelectorAll('.adv-msg.bot.speaking').forEach((el) => el.classList.remove('speaking'));
}

function advisorStopSpeech() {
  advisorSpeechId++;
  advisorUnmarkSpeaking();
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
    // F1a — speaking indicator on the bubble itself (the text is right there).
    const msgs = document.getElementById('advisorMsgs');
    const bubbles = msgs ? msgs.querySelectorAll('.adv-msg.bot') : [];
    const bubble = bubbles[bubbles.length - 1];
    if (bubble) bubble.classList.add('speaking');
    const unmark = function () { if (bubble) bubble.classList.remove('speaking'); };
    u.onend = function () { if (id === advisorSpeechId) unmark(); };
    u.onerror = function () { if (id === advisorSpeechId) unmark(); };
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
  if (advisor.mode !== 'fab') advisorSetMode('fab');
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

// F0 — state projection. Pages may supply stateForAdvisor() returning a compact,
// model-useful summary instead of the raw state object (the Lab's raw L carries
// full daily price arrays that blow the Worker's 100KB cap). Falls back to the
// page's `state` when no projection is supplied.
function advisorState() {
  if (typeof ADVISOR_CFG.stateForAdvisor === 'function') {
    try { return ADVISOR_CFG.stateForAdvisor(); } catch (e) {}
  }
  return ADVISOR_CFG.state || {};
}

// Remove orphaned tool_call pairs before sending — DeepSeek requires every
// assistant message with tool_calls to be immediately followed by a tool
// message for each call_id. advisorTrim() can break this by slicing in the
// middle of a pair.
function advisorCleanMessages(messages) {
  const cleaned = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length) {
      const expectedIds = new Set(m.tool_calls.map(function(tc) { return tc.id; }));
      const responses = [];
      let j = i + 1;
      while (j < messages.length && messages[j].role === 'tool') {
        responses.push(messages[j]);
        expectedIds.delete(messages[j].tool_call_id);
        j++;
      }
      if (expectedIds.size === 0) {
        cleaned.push(m);
        responses.forEach(function(r) { cleaned.push(r); });
      }
      // else: incomplete pair — drop the whole block silently
      i = j;
    } else if (m.role === 'tool') {
      // orphaned tool response with no preceding tool_calls — drop it
      i++;
    } else {
      cleaned.push(m);
      i++;
    }
  }
  return cleaned;
}

// F0 — build the request body, and guard client-side: if the serialised body
// is still too large (even after projection), drop state to a skeleton and tell
// the model which pull-tools to use, rather than firing a request certain to 413.
function advisorBuildBody() {
  const body = {
    messages: advisorCleanMessages(advisor.messages),
    tools: advTools(),
    state: advisorState(),
    knowledge: ADVISOR_CFG.knowledge || '',
    context: { page: advPage(), app: ADVISOR_CFG.app || 'Goalden', screens: advScreens() },
  };
  let serialized = JSON.stringify(body);
  if (serialized.length > 60000) {
    console.warn('[advisor] state truncated: body was ' + serialized.length + ' bytes; dropping state to a skeleton.');
    body.state = { _truncated: true, note: 'State omitted because it was too large. Use get_state, get_detail, get_price_history or get_instrument_stats to pull what you need.' };
    serialized = JSON.stringify(body);
  }
  // If the body is still large (tool results accumulate across rounds), strip
  // the oldest tool exchanges until we are under 80KB. This keeps the most
  // recent context while ensuring the Worker can proxy the request.
  let stripped = 0;
  while (serialized.length > 80000 && body.messages.length > 1) {
    const firstCallIdx = body.messages.findIndex(function(m) { return m.role === 'assistant' && m.tool_calls; });
    if (firstCallIdx < 0) { body.messages.shift(); }
    else {
      let endIdx = firstCallIdx + 1;
      while (endIdx < body.messages.length && body.messages[endIdx].role === 'tool') endIdx++;
      body.messages.splice(firstCallIdx, endIdx - firstCallIdx);
    }
    serialized = JSON.stringify(body);
    stripped++;
  }
  if (stripped) console.warn('[advisor] trimmed ' + stripped + ' old tool exchanges; body now ' + serialized.length + ' bytes.');
  return serialized;
}

// F2a — human-readable narration of a tool call (page supplies describeTool;
// fall back to the raw name+args only when it doesn't).
function advisorDescribe(name, args) {
  if (typeof ADVISOR_CFG.describeTool === 'function') {
    try {
      const d = ADVISOR_CFG.describeTool(name, args || {});
      if (d) return d;
    } catch (e) {}
  }
  return name + (args && Object.keys(args).length ? ' ' + JSON.stringify(args) : '');
}
// F2 — step rows are quieter than a chat bubble: a small inline line with a
// tick once the step completes.
function advisorAddStep(text) {
  const msgs = document.getElementById('advisorMsgs');
  const div = document.createElement('div');
  div.className = 'adv-step';
  div.innerHTML = '<span class="adv-step-tick">·</span><span>' + text + '</span>';
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}
function advisorCompleteStep(el) {
  if (!el) return;
  el.classList.add('done');
  const tick = el.querySelector('.adv-step-tick');
  if (tick) tick.textContent = '✓';
}
// F2c — after set_value, pulse the control that changed (the page returns the
// selector it touched).
function advisorFlash(name, result) {
  if (name !== 'set_value') return;
  let touched = null;
  if (typeof result === 'string') {
    try { touched = JSON.parse(result).touched; } catch (e) {}
  } else if (result && typeof result === 'object') {
    touched = result.touched;
  }
  if (!touched) return;
  try {
    const el = typeof touched === 'string' ? document.querySelector(touched) : touched;
    if (!el) return;
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    el.classList.add('advisor-pulse');
    setTimeout(() => el.classList.remove('advisor-pulse'), 1600);
  } catch (e) {}
}
function advisorPause(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function advisorLoop() {
  // F7d — track whether read_current_chart was called this turn so we can
  // append layered follow-up chips below the final bot reply.
  let readChartCalled = false;
  for (let step = 0; step < 6; step++) {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: advisorBuildBody(),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || ('Server responded ' + resp.status));
    }
    const data = await resp.json();
    const msg = data.message || {};
    if (msg.tool_calls && msg.tool_calls.length) {
      advisorEnterDock();
      advisor.messages.push({ role: 'assistant', content: msg.content || null, tool_calls: msg.tool_calls });
      let reduceMotion = false;
      try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
      for (let ci = 0; ci < msg.tool_calls.length; ci++) {
        const tc = msg.tool_calls[ci];
        const name = tc.function && tc.function.name;
        if (name === 'read_current_chart') readChartCalled = true;
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) { args = {}; }
        const stepRow = advisorAddStep(advisorDescribe(name, args));
        let result;
        if (name === 'compose_briefing') result = JSON.stringify(composeBriefing(args));
        else result = advExecuteTool(name, args);
        if (result && typeof result.then === 'function') result = await result;
        // Truncate large tool results before storing — chart data and price
        // history can be many KB; accumulated across 4+ tool rounds they
        // push the body over the Worker's size limit and break later calls.
        const MAX_TOOL_CONTENT = 3500;
        let storedContent = typeof result === 'string' ? result : JSON.stringify(result);
        if (storedContent.length > MAX_TOOL_CONTENT) {
          storedContent = storedContent.slice(0, MAX_TOOL_CONTENT) + '…[truncated for context window]';
        }
        advisor.messages.push({ role: 'tool', tool_call_id: tc.id, name: name, content: storedContent });
        advisorCompleteStep(stepRow);
        advisorFlash(name, result);
        // F2b — sequence consecutive actions so a human can watch them happen.
        if (ci < msg.tool_calls.length - 1 && !reduceMotion) await advisorPause(350);
      }
      advisorTrim();
      advisorPersist();
      continue;
    }
    if (msg.content) {
      advisorHideThinking();
      const botEl = advisorAddMsg('bot', msg.content);
      // F7d — append layered follow-up chips after a chart explanation so the
      // user can go deeper without having to think of the next question.
      if (readChartCalled && ADVISOR_CFG.chartFollowUps) {
        const followUps = ADVISOR_CFG.chartFollowUps();
        if (followUps && followUps.length) {
          const chipRow = document.createElement('div');
          chipRow.className = 'advisor-chips';
          followUps.forEach(function (q) {
            const btn = document.createElement('button');
            btn.className = 'advisor-chip';
            btn.setAttribute('data-advisor-ask', q);
            btn.textContent = q;
            chipRow.appendChild(btn);
          });
          botEl.appendChild(chipRow);
        }
      }
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
    } else if (/too large|413|payload|too long/i.test(msg)) {
      advisorAddMsg('sys', 'That request was too large to send. Try asking about one instrument or one tool at a time.');
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
   Briefing (F3) — a full-page, composed document. The model is the editor
   (it picks sections and writes the intro prose); the app is the renderer
   (it computes every number and chart via the page's section builders).
   ===================================================================== */
function advisorEscapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
}
function briefingOpen(title, html) {
  advisorSetMode('fab');
  document.getElementById('briefingTitle').textContent = title;
  document.getElementById('briefingBody').innerHTML = html;
  document.getElementById('briefing').classList.add('open');
}
function briefingClose() {
  document.getElementById('briefing').classList.remove('open');
  document.getElementById('briefingBody').innerHTML = '';
}

function composeBriefing(args) {
  args = args || {};
  const sections = Array.isArray(args.sections) ? args.sections : [];
  const title = args.title || 'Your Briefing';
  const intro = args.intro || '';
  let builders = ADVISOR_CFG.briefingSections;
  if (typeof builders === 'function') builders = builders();
  builders = builders || {};
  let html = '';
  if (intro) html += '<div id="briefingIntro">' + advisorEscapeHtml(intro) + '</div>';
  let shown = 0;
  const missing = [];
  sections.forEach(function (type) {
    const spec = builders[type];
    if (!spec) { missing.push(type); return; }
    let r;
    try { r = (typeof spec.build === 'function') ? spec.build() : spec; } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
    html += '<div class="briefing-section"><h2>' + advisorEscapeHtml(spec.title || type) + '</h2>';
    if (r && r.ok) { html += r.html; shown++; }
    else { html += '<div class="briefing-err">' + advisorEscapeHtml((r && r.error) || 'This section needs more input before it can be shown.') + '</div>'; }
    html += '</div>';
  });
  if (shown === 0 && sections.length) {
    return { ok: false, error: 'None of those sections could be built yet — ask the user for the missing inputs first.' };
  }
  html += '<div class="briefing-footer"><button data-briefing-close>Back to the app</button></div>';
  briefingOpen(title, html);
  return { ok: true, opened: title, shownSections: shown, missing: missing };
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
  if (advisor.mode !== 'fab') {
    advisorSetMode('fab');
    return;
  }
  if (isMobile()) {
    const cv = document.getElementById('resultCanvas');
    if (cv.classList.contains('open') && !cv.classList.contains('minimized')) cv.classList.add('minimized');
  }
  if (!document.getElementById('advisorMsgs').children.length) {
    advisorAddMsg('bot', ADVISOR_CFG.greeting || 'Hi! Ask me anything about your plan.');
  }
  advisorSetMode('dock');
  try { document.getElementById('advisorText').focus(); } catch (e) {}
});
document.getElementById('advisorMode').addEventListener('click', () => {
  advisorSetMode(advisor.mode === 'focus' ? 'dock' : 'focus');
});
document.getElementById('advisorClear').addEventListener('click', () => {
  if (advisor.busy) return;
  advisorStopSpeech();
  advisor.messages = [];
  document.getElementById('advisorMsgs').innerHTML = '';
  advisorPersist();
});
document.getElementById('advisorClose').addEventListener('click', () => {
  advisorStopSpeech();
  advisorSetMode('fab');
  try { document.getElementById('advisorFab').focus(); } catch (e) {}
});
document.getElementById('advisorSend').addEventListener('click', advisorSend);
document.getElementById('advisorText').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); advisorSend(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && advisor.mode !== 'fab') {
    advisorStopSpeech();
    advisorSetMode('fab');
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

document.getElementById('briefingClose').addEventListener('click', briefingClose);
document.getElementById('briefingPrint').addEventListener('click', function () { try { window.print(); } catch (e) {} });
document.addEventListener('click', function (e) {
  if (e.target && e.target.getAttribute && e.target.getAttribute('data-briefing-close')) briefingClose();
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && document.getElementById('briefing').classList.contains('open')) briefingClose();
});

// F5 — suggestion chips + inline "Ask the advisor" links. The page renders
// them with data-advisor-ask="<question>"; this single delegated listener sends
// the text through the real send path (open dock, then advisorSend). Chips are
// inert until clicked — zero API cost on render.
function advisorAsk(text) {
  if (!text || advisor.busy) return;
  advisorSetMode('dock');
  const ta = document.getElementById('advisorText');
  ta.value = String(text);
  advisorSend();
}
document.addEventListener('click', function (e) {
  const el = e.target && e.target.closest ? e.target.closest('[data-advisor-ask]') : null;
  if (el) advisorAsk(el.getAttribute('data-advisor-ask'));
});

advisorRehydrate();
