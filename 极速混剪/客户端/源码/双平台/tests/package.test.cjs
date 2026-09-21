const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('release matrix contains Windows x64 and both macOS architectures', () => {
  assert.deepEqual(pkg.build.win.target[0].arch, ['x64']);
  assert.deepEqual(pkg.build.mac.target[0].arch, ['x64', 'arm64']);
  assert.deepEqual(pkg.build.mac.target[1].arch, ['x64', 'arm64']);
});

test('macOS package contains only shared JavaScript sidecar sources', () => {
  const files = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : files.push(entry.name.toLowerCase()));
  walk(path.join(root, 'backend'));
  assert.equal(files.some((name) => /\.(exe|dll|pyd)$/.test(name)), false);
});

test('confirmed device mismatch copy is present in the client', () => {
  const renderer = fs.readFileSync(path.join(root, 'renderer', 'assets', 'index-qvbj35MU.js'), 'utf8');
  assert.match(renderer, /当前激活码与设备不匹配，请重新输入/);
});
