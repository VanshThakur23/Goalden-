// smoke-08.js — Phase 8 (streaming responses) structural verification.
// Run with: node smoke-08.js
// Zero deps. Regex/string checks on file contents, matching smoke-02/05/06/07.
'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
let fail = 0;
const check = (cond, label) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label);
  if (!cond) fail++;
};

const worker = fs.readFileSync(path.join(root, 'src', 'worker.js'), 'utf8');
const py = fs.readFileSync(path.join(root, 'local_server.py'), 'utf8');
const advisor = fs.readFileSync(path.join(root, 'advisor.js'), 'utf8');
const runner = fs.readFileSync(path.join(root, 'agent-evals', 'runner.js'), 'utf8');
const scenarios = fs.readFileSync(path.join(root, 'agent-evals', 'scenarios.json'), 'utf8');

// worker.js
check(/body\.stream === true/.test(worker), 'worker.js: body.stream is branched');
check(/function callDeepSeekStream/.test(worker), 'worker.js: callDeepSeekStream defined');
check(/stream_options:\s*\{ include_usage: true \}/.test(worker) || /stream_options/.test(worker), 'worker.js: stream_options sent');
check(/stream:\s*true/.test(worker), 'worker.js: stream:true sent');
check(/new Response\(res\.body/.test(worker), 'worker.js: res.body piped (no re-serialize)');
check(/return chatJson\(\{ message, usage, latencyMs \}/.test(worker), 'worker.js: non-stream path unchanged (chatJson)');

// local_server.py
check(/def _deepseek_chat_stream/.test(py), 'local_server.py: _deepseek_chat_stream defined');
check(/def _wrap_mock_as_sse/.test(py), 'local_server.py: _wrap_mock_as_sse defined');
check(/def _send_sse/.test(py), 'local_server.py: _send_sse defined');
check(/Connection.*close/.test(py), 'local_server.py: Connection: close (no chunk framing)');
check(!/send_header\('Transfer-Encoding'/.test(py), 'local_server.py: no hand-rolled Transfer-Encoding framing');
check(/stream_options/.test(py) && /'stream': True/.test(py), 'local_server.py: stream:True + stream_options sent');
check(/body\.get\('stream'\) is True/.test(py), 'local_server.py: do_POST branches on stream');

// advisor.js
check(/function advisorFetchStream/.test(advisor), 'advisor.js: advisorFetchStream defined');
check(/stream:\s*true/.test(advisor), 'advisor.js: stream:true in advisorBuildBody');
check(/getReader\(\)/.test(advisor), 'advisor.js: resp.body.getReader used');
check(/advisorMarkdown\(advisorGuardrail\(msg\.content\)\)/.test(advisor), 'advisor.js: guardrail+markdown still run at stream end');
check(/onDelta\(content\)/.test(advisor) || /onDelta\(/.test(advisor), 'advisor.js: onDelta fired on content growth');
check(/toolCalls\[i\]\.function\.arguments \+=/.test(advisor) || /\.function\.arguments \+=/.test(advisor), 'advisor.js: tool_call deltas concatenated by index');

// agent-evals must NOT set stream (negative assertion).
check(!/stream:\s*true/.test(runner) && !/stream:true/.test(runner), 'agent-evals/runner.js does NOT set stream');
check(!/stream:\s*true/.test(scenarios) && !/stream:true/.test(scenarios), 'agent-evals/scenarios.json does NOT set stream');

console.log(fail ? `\n${fail} FAILURES` : '\nALL PASS');
process.exit(fail ? 1 : 0);
