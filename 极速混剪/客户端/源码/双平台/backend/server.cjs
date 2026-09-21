const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { renderTimeline } = require('./render.cjs');

const port = Number(process.env.VIDEOMIX_PORT || 35006);
const dataDir = process.env.VIDEOMIX_DATA_DIR || process.cwd();
const tasks = new Map();
function stableSystemId() {
  if (process.env.VIDEOMIX_SYSTEM_ID) return process.env.VIDEOMIX_SYSTEM_ID;
  if (process.platform === 'darwin') {
    try {
      const output = require('node:child_process').execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5000 });
      return output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1] || require('os').hostname();
    } catch { return require('os').hostname(); }
  }
  return require('os').hostname();
}
const deviceId = `vm-device-v2:${process.platform}:${crypto.createHash('sha256').update(`videomix:${process.platform}:${stableSystemId()}`).digest('hex')}`;
const json = (res, status, body) => { const data = Buffer.from(JSON.stringify(body)); res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': data.length, 'access-control-allow-origin': '*' }); res.end(data); };
const body = (req) => new Promise((resolve, reject) => { let raw = ''; req.on('data', (chunk) => { raw += chunk; if (raw.length > 8 * 1024 * 1024) reject(new Error('request too large')); }); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(error); } }); req.on('error', reject); });
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true, service: 'videomix-backend', version: '1.2.0', platform: process.platform, arch: process.arch });
    if (req.method === 'GET' && req.url.startsWith('/activation/info')) return json(res, 200, { code: 0, data: { deviceId } });
    if (req.method === 'GET' && req.url.startsWith('/video/clip_v3/gpu_encoder')) return json(res, 200, { code: 0, data: { encoder: 'libx264' } });
    if (req.method === 'POST' && req.url === '/video/clip_v3/') {
      const input = await body(req); const id = crypto.randomUUID(); const task = { id, status: 'processing', progress: 0 }; tasks.set(id, task);
      renderTimeline(input, (progress) => { task.progress = progress; }).then((output) => { task.status = 'done'; task.progress = 100; task.output = require('node:url').pathToFileURL(output).toString(); }).catch((error) => { task.status = 'error'; task.message = error.message; });
      return json(res, 200, { code: 0, data: { taskId: id } });
    }
    if (req.method === 'GET' && req.url.startsWith('/video/clip_v3/progress/')) { const query = new URL(req.url, 'http://127.0.0.1').searchParams; const id = query.get('taskId') || query.get('task_id') || [...tasks.keys()].at(-1); const task = tasks.get(id); return json(res, 200, { code: 0, data: task ? { status: task.status, progress: task.progress, output_url: task.output, message: task.message } : { status: 'error', message: '任务不存在' } }); }
    if (req.method === 'POST' && req.url === '/video/clip_v3/cancel/') return json(res, 200, { code: 0, data: { cancelled: true } });
    return json(res, 404, { code: 404, message: '接口不存在' });
  } catch (error) { return json(res, 400, { code: 400, message: error.message }); }
});
server.listen(port, '127.0.0.1', () => process.stdout.write(JSON.stringify({ ok: true, port, deviceId }) + '\n'));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
