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
/* Markdown-lite inside bot bubbles (bold, lists, tables) — rendered via
   advisorMarkdown(); these rules give the generated tags real styling. */
.adv-msg.bot strong{font-weight:700}
.adv-msg.bot ul{margin:4px 0;padding-left:18px}
.adv-msg.bot li{margin:2px 0}
.adv-msg.bot table{border-collapse:collapse;margin:6px 0;font-size:14px}
.adv-msg.bot th,.adv-msg.bot td{border:1px solid rgba(20,40,63,.22);padding:4px 9px;text-align:left;vertical-align:top}
.adv-msg.bot th{background:rgba(37,87,199,.08);font-weight:700}
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
.briefing-verified{font-family:'Spline Sans Mono',monospace;font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:rgba(20,40,63,.5);padding:6px 10px;border:1px solid rgba(95,168,117,.35);border-radius:6px;background:rgba(95,168,117,.08);display:inline-block;margin-bottom:16px}
.briefing-footer{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;padding-top:16px;border-top:1px solid rgba(20,40,63,.1)}
.briefing-footer button{background:var(--gold);color:#fff;border:none;border-radius:8px;padding:10px 16px;font-family:'Figtree',sans-serif;font-weight:600;font-size:13.5px;cursor:pointer}
@media print{#advisorFab,#advisorPanel,#resultCanvas{display:none!important}#briefing{position:static;display:block!important;background:#fff}#briefingHead .rc-btns{display:none!important}}
.advisor-chips{display:flex;flex-wrap:wrap;gap:6px;padding:2px 0 10px}
.advisor-chip{background:rgba(37,87,199,.08);border:1px solid rgba(37,87,199,.25);color:var(--gold);border-radius:999px;padding:5px 12px;font-family:'Figtree',sans-serif;font-size:12px;cursor:pointer;transition:background .15s ease}
.advisor-chip:hover{background:rgba(37,87,199,.16)}
.advisor-ask-link{background:none;border:none;color:var(--gold);cursor:pointer;font-family:'Spline Sans Mono',monospace;font-size:10.5px;padding:0;text-decoration:underline;margin-left:6px}
/* Plan objects (Phase 4) — an editable, human-in-the-loop checklist the model
   proposes and the user approves before anything executes. */
.adv-plan{width:100%;max-width:100%}
.adv-plan-row{display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer;font-family:'Figtree',sans-serif;font-size:14px;line-height:1.4}
.adv-plan-row input[type=checkbox]{width:16px;height:16px;flex-shrink:0;cursor:pointer;accent-color:var(--gold)}
.adv-plan-run{display:block;margin:10px 0 2px;background:var(--gold);color:#fff;border:none;border-radius:9px;padding:9px 16px;font-family:'Figtree',sans-serif;font-weight:700;font-size:14px;cursor:pointer}
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
const advisor = { messages: [], busy: false, mode: 'fab', pendingPlan: null };
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
  // A single "do it all" automation run (set country, walk a risk
  // questionnaire, add a goal, run the calculation, compose a briefing) can
  // legitimately produce 30-40 messages of its own tool_calls/tool pairs.
  // 24 was tuned for ordinary back-and-forth chat and was chopping that
  // history mid-flight — the model would lose track of fields it had
  // already set and start repeating itself, or lose the thread entirely.
  // advisorBuildBody()'s separate byte-size guard still bounds worst-case
  // payload size regardless of this count.
  const MAX = 80;
  if (advisor.messages.length <= MAX) return;
  const firstUser = advisor.messages.find((m) => m.role === 'user');
  let tail = advisor.messages.slice(-MAX);
  if (firstUser && tail.indexOf(firstUser) === -1) tail = [firstUser].concat(tail.slice(0, MAX - 1));
  advisor.messages = tail;
}

// Part C — advice guardrail, enforced in code. Best-effort heuristic layered
// on top of the system-prompt instruction, NOT a guarantee: it rewrites only
// a sentence that BOTH carries a recommendation verb (or price-target phrase)
// AND points at something ticker-shaped or price-shaped. Descriptive mentions
// ("TCS returned 8% last year") carry no verb and are left untouched. On a
// match only the flagged sentence is replaced with a neutral one (never the
// whole message), and console.warn surfaces it during development.
const ADVISOR_TICKER_DENY = ['SIP','FD','ETF','NAV','CAGR','NPS','ELSS','PPF','NSE','BSE','REIT','AMC','SEBI','AUM','SWP','USD','INR','GBP','EUR','XIRR','EMI','FV','PV','IIP','GDP','IPO'];
function advisorGuardrail(text) {
  if (typeof text !== 'string' || !text) return text;
  const parts = text.split(/(?<=[.!?\n])/);
  let changed = false;
  const out = parts.map(function (sentence) {
    const lower = sentence.toLowerCase();
    const hasVerb = /\bbuy\b|\binvest in\b|\binvested in\b|\bpurchase\b|\bget\s+[a-z]{2,10}\b/.test(lower);
    const caps = sentence.match(/[A-Z]{2,10}/g) || [];
    const hasTicker = caps.some(function (t) { return ADVISOR_TICKER_DENY.indexOf(t) === -1; });
    const hasPrice = /price target|target price|will reach|expected to hit|will hit|going to hit|should hit/i.test(lower);
    if ((hasVerb || hasPrice) && (hasTicker || hasPrice)) {
      changed = true;
      console.warn('[advisor] guardrail rewrote a recommendation-shaped sentence:', sentence.trim());
      return "I can't recommend specific investments — but I can model any instrument you name.";
    }
    return sentence;
  });
  return changed ? out.join('') : text;
}

// Markdown-lite renderer for assistant (bot) bubbles. Security ordering is
// load-bearing: escape FIRST (advisorEscapeHtml turns the model's text into
// inert plain text), THEN strip the MODE line, THEN re-add only the fixed set
// of safe tags below. Anything the model emits that looks like markup is
// already escaped by the time we get here, so it cannot execute.
function advisorMarkdown(text) {
  let s = advisorEscapeHtml(text);
  // The model declares its reply shape on line 1 ("MODE: A" / "B" / "C").
  // It's a styling hint for the system prompt, never shown to the user.
  s = s.replace(/^MODE\s*:\s*[ABC]\s*(?:\r?\n)?/i, '');
  // **word** -> <strong>word</strong> (only literal ** survives escaping).
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const lines = s.split('\n');
  const out = [];
  let listBuf = null, tableBuf = null;
  const flushList = () => { if (listBuf) { out.push('<ul>' + listBuf.join('') + '</ul>'); listBuf = null; } };
  const flushTable = () => { if (tableBuf) { out.push('<table>' + tableBuf.join('') + '</table>'); tableBuf = null; } };
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim();
    // "- " / "* " bullets collapse into one <ul> (consecutive runs). "*" must
    // be followed by whitespace so "**bold**" on its own line never matches.
    if (/^[-*]\s+/.test(ln)) {
      flushTable();
      if (!listBuf) listBuf = [];
      listBuf.push('<li>' + ln.replace(/^[-*]\s+/, '') + '</li>');
      continue;
    }
    // Pipe rows |a|b| form a table; first row is the header.
    if (/^\|.+\|$/.test(ln)) {
      flushList();
      const cells = ln.slice(1, -1).split('|').map((c) => c.trim());
      const tag = tableBuf ? 'td' : 'th';
      if (!tableBuf) tableBuf = [];
      tableBuf.push('<tr>' + cells.map((c) => '<' + tag + '>' + c + '</' + tag + '>').join('') + '</tr>');
      continue;
    }
    flushList();
    flushTable();
    out.push(ln);
  }
  flushList();
  flushTable();
  return out.join('<br>');
}

function advisorAddMsg(role, text) {
  const msgs = document.getElementById('advisorMsgs');
  const div = document.createElement('div');
  div.className = 'adv-msg ' + role;
  // Assistant ("bot") messages are the model's own words — render markdown
  // (bold, lists, tables) via innerHTML. User input and client system notices
  // stay on textContent so nothing a person types is ever interpreted.
  if (role === 'bot' || role === 'tool') {
    div.innerHTML = advisorMarkdown(advisorGuardrail(text));
  } else {
    div.textContent = text;
  }
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

// F-autocontinue — a "do it all" flow on the landing page collects the
// user's numbers, then hands off to a tool page via a REAL page navigation
// (open_door). That kills JS execution, so without this the AI just narrates
// "let me open that door" and the user is dropped on the new page with
// nothing actually built. index.html sets this sessionStorage flag right
// before navigating, only when the handoff is part of a "do it all" flow
// (never for a "walk me through" handoff) — see its open_door tool.
const ADVISOR_AUTOCONTINUE_KEY = 'goalden_advisor_autocontinue';

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
    let autoContinue = false;
    try {
      if (sessionStorage.getItem(ADVISOR_AUTOCONTINUE_KEY) === '1') {
        sessionStorage.removeItem(ADVISOR_AUTOCONTINUE_KEY);
        autoContinue = true;
      }
    } catch (e) {}
    if (autoContinue && advisor.messages.length) {
      advisorEnterDock();
      advisorContinue(true);
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
// =====================================================================
// Plan objects (Phase 4) — human-in-the-loop approval. The model can propose
// a multi-step plan, the user sees an editable checklist, and only the steps
// still checked actually run. propose_plan/execute_plan are advisor-level
// tools (shared by all four pages), appended to the page's tool list in
// advisorBuildBody() so the model always knows about them.
// =====================================================================
const ADVISOR_INTERNAL_TOOLS = [
  { type:'function', function:{ name:'propose_plan', description:'Propose a multi-step action plan for the user to review and approve BEFORE anything runs. Pass steps: an array of {tool, args, label} where label is a short human-readable description of what the step does. The user gets an editable checklist with a "Run plan" button — nothing executes until they click it.', parameters:{ type:'object', properties:{ steps:{ type:'array', items:{ type:'object', properties:{ tool:{ type:'string' }, args:{ type:'object' }, label:{ type:'string' } }, required:['tool','label'] } } }, required:['steps'] } } },
  { type:'function', function:{ name:'execute_plan', description:'Execute the steps of the pending plan that was proposed with propose_plan. Runs only the steps the user left checked, in order, through the same tool dispatch as any other call. Pass planId (optional; must match the pending plan if provided).', parameters:{ type:'object', properties:{ planId:{ type:'string' } }, required:[] } } },
];

function proposePlan(args) {
  args = args || {};
  const steps = Array.isArray(args.steps) ? args.steps : [];
  if (!steps.length) return { ok:false, error:'propose_plan needs a non-empty steps array of {tool, args, label}.' };
  for (let i = 0; i < steps.length; i++) {
    if (!steps[i] || !steps[i].tool) return { ok:false, error:'Step ' + i + ' is missing a tool name.' };
  }
  const plan = {
    id: 'plan_' + Date.now() + '_' + Math.floor(Math.random() * 1e4),
    steps: steps,
    approved: steps.map(function () { return true; }),
  };
  advisor.pendingPlan = plan;
  advisorRenderPlan(plan);
  return { ok:true, planId: plan.id, stepCount: steps.length, note:'Waiting for the user to review and click "Run plan".' };
}

function executePlan(planId) {
  const plan = advisor.pendingPlan;
  if (!plan) return { ok:false, error:'There is no pending plan to run.' };
  if (planId != null && plan.id !== planId) return { ok:false, error:'That plan is no longer pending — the current pending plan has a different id, or none exists.' };
  // Run checked steps IN ORDER through the SAME dispatch every other tool
  // uses (advExecuteTool) — no parallel path, no bypassed validation.
  const ranSteps = [];
  const skippedSteps = [];
  const results = [];
  const runOne = function (step, i) {
    const key = step.label || step.tool;
    if (!plan.approved[i]) { skippedSteps.push(key); return null; }
    let r;
    try {
      r = advExecuteTool(step.tool, step.args || {});
    } catch (e) {
      r = JSON.stringify({ ok:false, error:'Step failed: ' + (e && e.message || e) });
    }
    if (r && typeof r.then === 'function') {
      return Promise.resolve(r).then(function (resolved) {
        results.push({ step: key, tool: step.tool, result: resolved });
        ranSteps.push(key);
      });
    }
    results.push({ step: key, tool: step.tool, result: r });
    ranSteps.push(key);
    return null;
  };
  const chain = (function () {
    let p = Promise.resolve();
    plan.steps.forEach(function (step, i) { p = p.then(function () { return runOne(step, i); }); });
    return p;
  })();
  return chain.then(function () {
    advisor.pendingPlan = null;
    return { ok:true, ranSteps: ranSteps, skippedSteps: skippedSteps, results: results };
  });
}

// Render the editable checklist into the chat as a bot bubble. Labels use
// textContent (never innerHTML) so model-controlled text cannot inject markup.
function advisorRenderPlan(plan) {
  const msgs = document.getElementById('advisorMsgs');
  const el = document.createElement('div');
  el.className = 'adv-msg bot adv-plan';
  const list = document.createElement('div');
  plan.steps.forEach(function (step, i) {
    const row = document.createElement('label');
    row.className = 'adv-plan-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.addEventListener('change', function () {
      // The checkbox gates execution — this must write the backing state.
      if (advisor.pendingPlan) advisor.pendingPlan.approved[i] = cb.checked;
    });
    const lbl = document.createElement('span');
    lbl.textContent = step.label || step.tool;
    row.appendChild(cb);
    row.appendChild(lbl);
    list.appendChild(row);
  });
  const runBtn = document.createElement('button');
  runBtn.className = 'adv-plan-run';
  runBtn.textContent = 'Run plan';
  runBtn.addEventListener('click', advisorRunPlanClick);
  el.appendChild(list);
  el.appendChild(runBtn);
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
}

// "Run plan" click: execute the checked steps, feed the result back into the
// conversation as a synthetic tool round-trip, then continue the loop so the
// model can close out (e.g. compose the briefing).
async function advisorRunPlanClick() {
  const plan = advisor.pendingPlan;
  if (!plan || advisor.busy) return;
  const planId = plan.id;
  const result = await executePlan(planId);
  advisor.messages.push({ role:'assistant', content:null, tool_calls:[{ id:'call_plan_run', type:'function', function:{ name:'execute_plan', arguments: JSON.stringify({ planId: planId }) } }] });
  advisor.messages.push({ role:'tool', tool_call_id:'call_plan_run', name:'execute_plan', content: JSON.stringify(result) });
  advisorEnterDock();
  await advisorContinue(false);
}

function advisorBuildBody() {
  const body = {
    messages: advisorCleanMessages(advisor.messages),
    tools: advTools().concat(ADVISOR_INTERNAL_TOOLS),
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
  // describeTool() interpolates model-controlled tool arguments into these
  // sentences, so the text must be escaped before it reaches innerHTML —
  // a hallucinated field name containing markup would otherwise execute.
  div.innerHTML = '<span class="adv-step-tick">·</span><span>' + advisorEscapeHtml(text) + '</span>';
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

async function advisorLoop(silent) {
  // F7d — track whether read_current_chart was called this turn so we can
  // append layered follow-up chips below the final bot reply.
  let readChartCalled = false;
  // A "do it all" flow (set country, answer a risk questionnaire, add a
  // goal, run the calculation, compose a briefing) can legitimately need
  // 10+ individual tool calls. 6 was tuned for a single explain/compare
  // exchange and was cutting off real multi-step automation mid-flow with
  // "taking too many steps" before it ever finished the job.
  for (let step = 0; step < 18; step++) {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: advisorBuildBody(),
      // A hung Worker/upstream must not spin the "…" forever — the Worker
      // side times out at 25s too, this is the belt to its braces.
      signal: AbortSignal.timeout(25000),
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
        else if (name === 'propose_plan') result = JSON.stringify(proposePlan(args));
        else if (name === 'execute_plan') result = executePlan(args && args.planId);
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
      // Never speak unprompted — auto-continue (a "do it all" flow resuming
      // itself right after a page load, with no user interaction that turn)
      // must stay silent. Only a message the user actually triggered speaks.
      if (!silent) advisorSpeak(msg.content);
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

// Shared busy/error wrapper around advisorLoop(), used both by a real user
// send and by the cross-page auto-continue below (F-autocontinue) — a "do it
// all" flow that hands off to another page via a real navigation needs a way
// to keep acting on the new page with no fresh user message to trigger it.
async function advisorContinue(silent) {
  if (advisor.busy) return;
  advisor.busy = true;
  document.getElementById('advisorSend').disabled = true;
  try {
    advisorShowThinking();
    await advisorLoop(silent);
  } catch (e) {
    advisorHideThinking();
    console.error('[advisor]', e);
    const msg = (e && e.message) ? e.message : '';
    if (/DEEPSEEK_API_KEY|secret is not set|api key/i.test(msg)) {
      advisorAddMsg('sys', "The advisor isn't switched on yet — the site owner needs to add an API key.");
    } else if (/TimeoutError|AbortError|timeout|aborted|timed out/i.test(msg)) {
      advisorAddMsg('sys', 'The advisor took too long to answer — please try again.');
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

async function advisorSend() {
  if (advisor.busy) return;
  advisorStopSpeech();
  const ta = document.getElementById('advisorText');
  const text = ta.value.trim();
  if (!text) return;
  ta.value = '';
  // A new, unrelated message abandons any still-pending plan — it must never
  // linger and let a later execute_plan run steps from a different turn.
  advisor.pendingPlan = null;
  advisorAddMsg('user', text);
  advisor.messages.push({ role: 'user', content: text });
  advisorPersist();
  await advisorContinue();
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

// Part A — recompute-and-compare. A briefing section may bake a number into
// its HTML from whatever calc path its builder happened to call; this
// re-reads the SAME keys through the page's canonical live entry point
// (executeTool('get_results')) so the audit is genuinely independent of the
// value the builder captured. Returns { ok:true, values:{key:value} } with
// only the keys that exist in the fresh result, or { ok:false } if there is
// no result to recompute against.
function advisorRecomputeFigures(keys) {
  let raw;
  try { raw = advExecuteTool('get_results', {}); } catch (e) { return { ok: false, error: 'Could not re-read results: ' + e.message }; }
  let res;
  try { res = (typeof raw === 'string') ? JSON.parse(raw) : raw; } catch (e) { return { ok: false, error: 'Could not parse recomputed results.' }; }
  if (!res || res.ok !== true || !res.result) return { ok: false, error: (res && res.error) || 'No result available to recompute.' };
  const values = {};
  keys.forEach(function (k) { if (res.result[k] != null) values[k] = res.result[k]; });
  return { ok: true, values: values };
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
  let shown = 0;
  const missing = [];
  // Run every section builder first and audit its figures BEFORE rendering
  // any of them — a single mismatch blocks the whole briefing, never a
  // partially-baked one.
  const built = sections.map(function (type) {
    const spec = builders[type];
    if (!spec) { missing.push(type); return { type, spec, r: null }; }
    let r;
    try { r = (typeof spec.build === 'function') ? spec.build() : spec; } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
    return { type, spec, r };
  });
  for (const item of built) {
    const { type, spec, r } = item;
    if (!spec) continue;
    if (r && r.ok && r.figures && Object.keys(r.figures).length) {
      const audit = advisorRecomputeFigures(Object.keys(r.figures));
      if (audit.ok) {
        for (const k in r.figures) {
          const reported = r.figures[k];
          const recomputed = audit.values[k];
          if (reported == null || recomputed == null) continue;
          // Relative tolerance 0.1%: catches real drift, tolerates float noise.
          const rel = Math.abs(reported - recomputed) / Math.max(1e-9, Math.abs(recomputed));
          if (rel >= 0.001) {
            return { ok: false, error: 'figure_mismatch', section: type, key: k, reported: reported, recomputed: recomputed };
          }
        }
      }
    }
  }
  // Prepend the verification stamp once every audited figure passed.
  let anyFigures = false;
  built.forEach(function (item) { if (item.r && item.r.ok && item.r.figures && Object.keys(item.r.figures).length) anyFigures = true; });
  if (anyFigures) html += '<div class="briefing-verified">✓ Every figure recomputed from your inputs</div>';
  if (intro) html += '<div id="briefingIntro">' + advisorEscapeHtml(intro) + '</div>';
  built.forEach(function (item) {
    const { type, spec, r } = item;
    if (!spec) return;
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
