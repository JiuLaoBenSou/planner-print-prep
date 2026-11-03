import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import fs from 'node:fs';
const meta=JSON.parse(fs.readFileSync('payments/.cloudflare/output/v0/config.json','utf8'));assert.equal(meta.buildContext.mode,'sandbox','Build sandbox before running this regression check.');
const r=spawnSync(process.execPath,['scripts/cf-payments.mjs','deploy','--prebuilt','--dry-run'],{encoding:'utf8'});assert.notEqual(r.status,0,'Production deployment must reject an existing sandbox build before any upload.');console.log('PASS: mismatched prebuilt deployment rejected.');
