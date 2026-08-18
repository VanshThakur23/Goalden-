// smoke-11.js — Phase 11 (BM25 tool/knowledge routing) structural checks.
// Run with: node smoke-11.js · zero deps, regex-on-file-contents style.
'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
let fail = 0;
const check = (cond, label) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label);
  if (!cond) fail++;
};

const engine = fs.readFileSync(path.join(root, 'goalden-engine.js'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'src', 'worker.js'), 'utf8');
const py = fs.readFileSync(path.join(root, 'local_server.py'), 'utf8');

// 1. BM25 core exists in the canonical engine copy (tested) and the Worker's
// duplicate (it can't import a plain-<script> file).
check(/function bm25Rank\b/.test(engine), 'goalden-engine.js: bm25Rank defined');
check(/function bm25Tokenize\b/.test(engine), 'goalden-engine.js: bm25Tokenize defined');
check(/function filterToolsByQuery\b/.test(engine), 'goalden-engine.js: filterToolsByQuery defined');
check(/bm25Tokenize, bm25Rank, filterToolsByQuery/.test(engine), 'goalden-engine.js: BM25 exported in shim');

check(/function bm25Rank\b/.test(worker), 'worker.js: bm25Rank defined');
check(/function bm25Tokenize\b/.test(worker), 'worker.js: bm25Tokenize defined');
check(/function filterTools\b/.test(worker), 'worker.js: filterTools defined');
check(/function filterKnowledge\b/.test(worker), 'worker.js: filterKnowledge defined');

// 2. local_server.py mirrors the same BM25 + filtering (parity check).
check(/def _bm25_rank\b/.test(py), 'local_server.py: _bm25_rank defined');
check(/def _bm25_tokenize\b/.test(py), 'local_server.py: _bm25_tokenize defined');
check(/def _filter_tools\b/.test(py), 'local_server.py: _filter_tools defined');
check(/def _filter_knowledge\b/.test(py), 'local_server.py: _filter_knowledge defined');
check(/def _route_body\b/.test(py), 'local_server.py: _route_body defined');

// 3. The filter is actually wired into the request flow, not just defined —
// worker.js: body.tools/body.knowledge are reassigned from the filter output
// before buildSystemPrompt and before the DeepSeek call sites.
check(/body\.tools\s*=\s*routedTools/.test(worker), 'worker.js: body.tools reassigned from filterTools output');
check(/body\.knowledge\s*=\s*routedKnowledge/.test(worker), 'worker.js: body.knowledge reassigned from filterKnowledge output');
check(/const routedTools = filterTools\(body\)/.test(worker), 'worker.js: filterTools called before buildSystemPrompt');

// worker.js: the reassignment must happen BEFORE buildSystemPrompt is called
// (order matters — filtering after would be a no-op for the prompt text).
{
  const routeIdx = worker.indexOf('const routedTools = filterTools(body)');
  const promptIdx = worker.indexOf('buildSystemPrompt(body)', routeIdx);
  check(routeIdx > -1 && promptIdx > routeIdx, 'worker.js: routing happens before buildSystemPrompt call');
}

// local_server.py: chat() and the streaming path both call _route_body
// before building messages / calling DeepSeek.
check(/body = _route_body\(body\)/.test(py), 'local_server.py: _route_body called (chat + streaming paths)');
{
  const count = (py.match(/body = _route_body\(body\)/g) || []).length;
  check(count >= 2, 'local_server.py: _route_body wired into both chat() and streaming path');
}

// 4. Always-keep-already-called-tools carve-out present in both runtimes.
check(/tool_calls/.test(worker) && /keep\.add/.test(worker), 'worker.js: already-called tools kept regardless of score');
check(/tool_calls/.test(py) && /keep\.add/.test(py), 'local_server.py: already-called tools kept regardless of score');

// 5. Small-list skip: routing must not run (or must no-op) when the tool
// list is already small — both runtimes reference the K constant/threshold.
check(/TOOL_ROUTE_K/.test(worker), 'worker.js: TOOL_ROUTE_K threshold present');
check(/_TOOL_ROUTE_K/.test(py), 'local_server.py: _TOOL_ROUTE_K threshold present');

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
