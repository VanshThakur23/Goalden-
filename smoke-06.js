// smoke-06.js — Phase "compound skills" verification.
// Run with: node smoke-06.js
// Structural assertions: the skill tools are defined + wired on each page, and
// the worker/local_server system prompts stay in sync. Exit 0/1, zero deps.
'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
let fail = 0;
const check = (cond, label) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label);
  if (!cond) fail++;
};

const g1 = fs.readFileSync(path.join(root, 'goalden.html'), 'utf8');
const g2 = fs.readFileSync(path.join(root, 'goalden-door2.html'), 'utf8');
const gl = fs.readFileSync(path.join(root, 'goalden-lab.html'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'src', 'worker.js'), 'utf8');
const py = fs.readFileSync(path.join(root, 'local_server.py'), 'utf8');

// goalden.html — build_goal_plan: tool def + describeTool case + execute branch.
check(/name:'build_goal_plan'/.test(g1), 'goalden.html: build_goal_plan tool defined');
check(/case 'build_goal_plan'/.test(g1), 'goalden.html: build_goal_plan describeTool case');
check(/name === 'build_goal_plan'/.test(g1), 'goalden.html: build_goal_plan executeAdvisorTool branch');
check(/name === 'set_value'\)/.test(g1) && /name === 'get_results'\)/.test(g1), 'goalden.html: primitives intact');

// goalden-door2.html — build_goal_plan.
check(/name:'build_goal_plan'/.test(g2), 'goalden-door2.html: build_goal_plan tool defined');
check(/case 'build_goal_plan'/.test(g2), 'goalden-door2.html: build_goal_plan describeTool case');
check(/name === 'build_goal_plan'/.test(g2), 'goalden-door2.html: build_goal_plan executeAdvisorTool branch');
check(/name === 'add_goal'\)/.test(g2), 'goalden-door2.html: add_goal primitive intact');

// goalden-lab.html — run_full_analysis.
check(/name:'run_full_analysis'/.test(gl), 'goalden-lab.html: run_full_analysis tool defined');
check(/name === 'run_full_analysis'/.test(gl), 'goalden-lab.html: run_full_analysis executeAdvisorTool branch');
check(/case 'run_full_analysis'/.test(gl), 'goalden-lab.html: run_full_analysis describeTool case');
check(/name === 'set_value'\)/.test(gl), 'goalden-lab.html: set_value primitive intact');

// worker.js vs local_server.py sync: both mention both skill names.
check(worker.includes('build_goal_plan') && worker.includes('run_full_analysis'),
  'worker.js: mentions both skill tools');
check(py.includes('build_goal_plan') && py.includes('run_full_analysis'),
  'local_server.py: mentions both skill tools');
const wSkills = (worker.match(/build_goal_plan/g) || []).length + (worker.match(/run_full_analysis/g) || []).length;
const pSkills = (py.match(/build_goal_plan/g) || []).length + (py.match(/run_full_analysis/g) || []).length;
check(wSkills === pSkills, `worker/local_server skill mentions match (${wSkills} vs ${pSkills})`);

console.log(fail ? `\n${fail} FAILURES` : '\nALL PASS');
process.exit(fail ? 1 : 0);
