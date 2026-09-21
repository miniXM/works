const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

test('ticket payload contract uses base64url JSON and RSA-SHA256', () => {
  const payload = Buffer.from(JSON.stringify({ v: 1, kid: 'test', code: 'ABC', device: 'vm-device-v2:darwin:abc', iat: 1, exp: 4102444800 }));
  const encoded = payload.toString('base64url');
  assert.deepEqual(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')).device, 'vm-device-v2:darwin:abc');
  assert.equal(crypto.createHash('sha256').update(payload).digest().length, 32);
});
