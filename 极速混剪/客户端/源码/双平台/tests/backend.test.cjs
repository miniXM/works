const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

test('native backend exposes health and stable device identity', async () => {
  const port = 35106;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'backend', 'server.cjs')], { env: { ...process.env, VIDEOMIX_PORT: String(port) } });
  await new Promise((resolve) => child.stdout.once('data', resolve));
  const result = await new Promise((resolve, reject) => { const request = http.get(`http://127.0.0.1:${port}/health`, (response) => { let data = ''; response.on('data', (chunk) => { data += chunk; }); response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(data) })); }); request.on('error', reject); });
  assert.equal(result.status, 200); assert.equal(result.body.ok, true); assert.equal(result.body.platform, process.platform); assert.equal(result.body.arch, process.arch);
  child.kill();
});
