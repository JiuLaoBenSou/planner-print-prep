import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
// A public paid build must never silently use the independently deployed sandbox.
const run=spawnSync(process.execPath,['scripts/build-pages.mjs','--billing'],{
 encoding:'utf8',env:{...process.env,VITE_BILLING_API_URL:'https://planner-print-prep-payments-sandbox.video-to-gif-local.workers.dev/api/billing/'}
});
assert.notEqual(run.status,0,'A production billing build accepted a sandbox API.');
assert.match(run.stderr,/Production billing build requires the production site and billing API/);
console.log('PASS: production billing build rejects a sandbox API before generating a release.');
