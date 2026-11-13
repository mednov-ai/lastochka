import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openRateStore } from './rate-store.mjs';

test('concurrent independent processes share a transactional global limit', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lastochka-rate-process-'));
  const state = join(directory, 'rate.sqlite');
  try {
    execFileSync('python3', [resolve('scripts/init-maintenance-state.py'), '--path', state, '--zone', 'test']);
    const script = `import {openRateStore} from ${JSON.stringify(new URL('./rate-store.mjs', import.meta.url).href)};
const store=openRateStore(process.env.FIXTURE_STATE,'test',Buffer.alloc(32),()=>1800000000000);
const results=[];for(let i=0;i<8;i++)results.push(store.attempt('192.0.2.'+(Number(process.env.FIXTURE_OFFSET)+i),()=>false));
store.close();console.log(JSON.stringify(results));`;
    function worker(offset) {
      return new Promise((done, reject) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, FIXTURE_STATE: state, FIXTURE_OFFSET: String(offset) } });
        let stdout = '', stderr = '';
        child.stdout.on('data', (x) => { stdout += x; }); child.stderr.on('data', (x) => { stderr += x; });
        child.on('error', reject);
        child.on('close', (code) => code === 0 ? done(JSON.parse(stdout)) : reject(new Error(stderr)));
      });
    }
    const results = (await Promise.all([worker(1), worker(100)])).flat();
    assert.equal(results.filter((x) => x === 'rejected').length, 10);
    assert.equal(results.filter((x) => x === 'blocked').length, 6);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('wrong zone, corrupt state and missing state are rejected without replacement', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lastochka-rate-invalid-'));
  const state = join(directory, 'rate.sqlite');
  try {
    execFileSync('python3', [resolve('scripts/init-maintenance-state.py'), '--path', state, '--zone', 'test']);
    const original = readFileSync(state);
    assert.throws(() => openRateStore(state, 'production', Buffer.alloc(32)));
    assert.deepEqual(readFileSync(state), original);
    writeFileSync(state, 'corrupt', { mode: 0o600 });
    assert.throws(() => openRateStore(state, 'test', Buffer.alloc(32)));
    rmSync(state);
    assert.throws(() => openRateStore(state, 'test', Buffer.alloc(32)));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
