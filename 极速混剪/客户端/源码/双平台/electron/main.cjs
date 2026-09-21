const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');

app.setAppUserModelId('com.innovessel.videomix');
const root = app.getAppPath();
const dataDir = app.getPath('userData');
let backend;
let licenseProxy;
let backendState = { running: false, port: 35006, platform: process.platform, arch: process.arch };
const licensePublicKey = { kty: 'RSA', n: 'srM45IHlQyNb2u1wgeim7L6/GeafmqFA-w4fEQVXio2cnmWFaGi4uHbGZJo60wYR6_WsuyIiyht82pxsOft7gvF0C/oeaLhkspe1fss0Pt0oBl8LmwgGJ1e1P20aS9V3IuFbNHbx2P/IzahXDZ/Fydz9XX4KkvRqHK/zeBxd6ZYmGx-x1dVORHWsnxxFIGGE1qHHg2Ak6TzsxtojyeC4pVZYNCzV7OkTgwyeQDyYFB59Sq7Ys0QGG_s59qsjiHz9x4qwU2tnpciGpCcDuj6v5Gp5fXmg_Xq8ajyURXvsb1RzxOcRz2ql20cCXXwLmRPdFMR3d83VJA7Pvnzh7t_5nQ', e: 'AQAB' };
const supportedVideos = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.m4v']);
const supportedAudio = new Set(['.mp3', '.m4a', '.wav', '.aac', '.ogg', '.flac']);

function startBackend() {
  const script = app.isPackaged ? path.join(process.resourcesPath, 'backend', 'server.cjs') : path.join(root, 'backend', 'server.cjs');
  let ffmpegPath = process.env.FFMPEG_PATH || '';
  try { ffmpegPath = require('@ffmpeg-installer/ffmpeg').path; } catch {}
  backend = spawn(process.execPath, [script], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', FFMPEG_PATH: ffmpegPath, VIDEOMIX_PORT: '35006', VIDEOMIX_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  backend.stdout.on('data', () => { backendState = { ...backendState, running: true }; });
  backend.stderr.on('data', () => {});
  backend.on('exit', (code) => { backendState = { ...backendState, running: false, exitCode: code }; });
}
function stopBackend() { if (backend && !backend.killed) backend.kill(); backend = null; }
function verifyTicket(ticket, expectedCode, expectedDevice) {
  try {
    const [encodedPayload, encodedSignature] = String(ticket).split('.');
    if (!encodedPayload || !encodedSignature) return false;
    const decode = (value) => Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4), 'base64');
    const payloadBytes = decode(encodedPayload); const payload = JSON.parse(payloadBytes.toString('utf8'));
    if (String(payload.code || '').toUpperCase() !== String(expectedCode || '').toUpperCase() || payload.device !== expectedDevice || Number(payload.exp) < Math.floor(Date.now() / 1000)) return false;
    const key = crypto.createPublicKey({ key: licensePublicKey, format: 'jwk' });
    return crypto.verify('RSA-SHA256', payloadBytes, key, decode(encodedSignature));
  } catch { return false; }
}
function validateLicenseResponse(responseBody, requestBody) {
  if (!responseBody || typeof responseBody !== 'object' || String(responseBody.object || '').toUpperCase() !== 'SC') return responseBody;
  if (!responseBody.ticket || !verifyTicket(responseBody.ticket, requestBody.activateCode, requestBody.deviceId)) return { success: false, status: '200', object: 'E9', message: '授权校验未通过：签名验证失败' };
  return responseBody;
}
function readLicenseServerUrl() {
  const candidates = [path.join(dataDir, 'license-server.json'), path.join(process.resourcesPath || root, 'license-server.json')];
  for (const file of candidates) try { const value = JSON.parse(fs.readFileSync(file, 'utf8')).serverUrl; if (/^https:\/\//i.test(value)) return value.replace(/\/$/, ''); } catch {}
  return 'https://hj.jisuai.cc';
}
function startLicenseProxy() {
  licenseProxy = http.createServer((request, response) => {
    if (!['POST', 'GET', 'OPTIONS'].includes(request.method)) { response.writeHead(405); return response.end(); }
    if (request.method === 'OPTIONS') { response.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' }); return response.end(); }
    if (!['/rpc/authActivateCode', '/rpc/judgeActivateCode', '/vm/license'].includes(request.url)) { response.writeHead(404); return response.end(); }
    if (request.url === '/vm/license') { response.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); return response.end(JSON.stringify({ activateCode: '' })); }
    let raw = ''; request.on('data', (chunk) => { raw += chunk; if (raw.length > 65536) request.destroy(); }); request.on('end', () => {
      const target = new URL(request.url, readLicenseServerUrl());
      const upstream = require(target.protocol.slice(0, -1)).request(target, { method: request.method, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) }, timeout: 30000 }, (upstreamResponse) => {
        let upstreamBody = ''; upstreamResponse.setEncoding('utf8'); upstreamResponse.on('data', (chunk) => { upstreamBody += chunk; }); upstreamResponse.on('end', () => { let parsed; try { parsed = JSON.parse(upstreamBody); } catch { parsed = { success: false, status: upstreamResponse.statusCode || 502, object: 'E8', message: '授权服务器返回格式无效' }; } const checked = validateLicenseResponse(parsed, (() => { try { return JSON.parse(raw); } catch { return {}; } })()); const output = Buffer.from(JSON.stringify(checked)); response.writeHead(upstreamResponse.statusCode || 502, { 'content-type': 'application/json', 'content-length': output.length, 'access-control-allow-origin': '*' }); response.end(output); });
      });
      upstream.on('timeout', () => upstream.destroy(new Error('timeout'))); upstream.on('error', () => { if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); response.end(JSON.stringify({ success: false, status: 502, object: 'E8', message: '授权服务器暂时不可用' })); }); upstream.end(raw);
    });
  });
  licenseProxy.on('error', (error) => { backendState = { ...backendState, licenseProxyError: error.message }; });
  licenseProxy.listen(8081, '127.0.0.1');
}
function stopLicenseProxy() { if (licenseProxy) licenseProxy.close(); licenseProxy = null; }
function safePath(value) { return path.resolve(String(value || '')); }
async function readDir(dir) { const entries = await fs.promises.readdir(safePath(dir), { withFileTypes: true }); return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory(), path: path.join(safePath(dir), entry.name) })); }
const storeFile = (name) => path.join(dataDir, name);
async function readJson(name, fallback) { try { return JSON.parse(await fs.promises.readFile(storeFile(name), 'utf8')); } catch { return fallback; } }
async function writeJson(name, value) { const target = storeFile(name); await fs.promises.mkdir(path.dirname(target), { recursive: true }); const temporary = `${target}.tmp`; await fs.promises.writeFile(temporary, JSON.stringify(value, null, 2), 'utf8'); await fs.promises.rename(temporary, target); }
function registerIpc() {
  ipcMain.handle('path:toFileUrl', (_e, value) => pathToFileURL(String(value)).toString());
  ipcMain.handle('app:getPath', (_e, name) => app.getPath(name));
  ipcMain.handle('fs:pathExists', async (_e, value) => fs.existsSync(safePath(value)));
  ipcMain.handle('fs:readDir', (_e, value) => readDir(value));
  ipcMain.handle('fs:readFileUtf8', (_e, value) => fs.promises.readFile(safePath(value), 'utf8'));
  ipcMain.handle('fs:writeFileUtf8', (_e, value, data) => fs.promises.writeFile(safePath(value), String(data), 'utf8'));
  ipcMain.handle('fs:writeFileBuffer', (_e, value, data) => fs.promises.writeFile(safePath(value), Buffer.from(data)));
  ipcMain.handle('fs:copyFile', (_e, source, target) => fs.promises.copyFile(safePath(source), safePath(target)));
  ipcMain.handle('fs:ensureDir', (_e, value) => fs.promises.mkdir(safePath(value), { recursive: true }));
  ipcMain.handle('fs:emptyDir', async (_e, value) => { const dir = safePath(value); await fs.promises.mkdir(dir, { recursive: true }); const entries = await fs.promises.readdir(dir); await Promise.all(entries.map((entry) => fs.promises.rm(path.join(dir, entry), { recursive: true, force: true }))); return { removedCount: entries.length }; });
  ipcMain.handle('assets:isSupportedVideoFile', (_e, value) => supportedVideos.has(path.extname(String(value)).toLowerCase()));
  ipcMain.handle('assets:listSupportedVideosInFolder', async (_e, dir) => (await readDir(dir)).filter((item) => !item.isDirectory && supportedVideos.has(path.extname(item.name).toLowerCase())));
  ipcMain.handle('fs:selectFile', async (event, options = {}) => { const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { properties: ['openFile'], ...options }); return result.canceled ? null : result.filePaths[0]; });
  ipcMain.handle('fs:selectFolder', async (event) => { const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { properties: ['openDirectory'] }); return result.canceled ? null : result.filePaths[0]; });
  ipcMain.handle('fs:listDrives', async () => process.platform === 'win32' ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => `${letter}:\\`).filter(fs.existsSync) : (await readDir('/Volumes').catch(() => [])).filter((item) => item.isDirectory).map((item) => item.path));
  ipcMain.handle('backend:status', () => backendState);
  ipcMain.handle('shell:openPath', (_e, value) => shell.openPath(String(value)));
  ipcMain.handle('fonts:defaultDirectory', () => path.join(app.isPackaged ? process.resourcesPath : root, 'fonts'));
  ipcMain.handle('fonts:defaultBgmDirectory', () => path.join(app.isPackaged ? process.resourcesPath : root, 'music'));
  ipcMain.handle('fonts:systemDirectory', () => process.platform === 'darwin' ? '/System/Library/Fonts' : process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'Fonts') : '/usr/share/fonts');
  ipcMain.handle('fonts:listDirectory', async (_e, value, limit = 400) => { const result = []; const walk = async (dir) => { if (result.length >= Math.min(2000, Number(limit) || 400)) return; for (const item of await readDir(dir)) item.isDirectory ? await walk(item.path) : /\.(ttf|otf|ttc)$/i.test(item.name) && result.push({ label: item.name, file: item.path }); }; try { await walk(value); } catch {} return result; });
  ipcMain.handle('autoUpdate:getState', () => ({ supported: false, platform: process.platform, arch: process.arch }));
  ipcMain.handle('autoUpdate:check', () => ({ supported: false, reason: 'release feed not configured' }));
  ipcMain.handle('autoUpdate:install', () => false);
  ipcMain.handle('assets:copyBundledDefaults', async (_e, destination) => { const source = path.join(app.isPackaged ? process.resourcesPath : root, 'video-assets'); if (!fs.existsSync(source)) return { ok: false, error: '未找到内置视频素材目录', copiedFiles: 0 }; await fs.promises.cp(source, safePath(destination), { recursive: true, force: false, errorOnExist: false }); return { ok: true, source, dest: destination }; });
  ipcMain.handle('assets:scanMixRoot', async (_e, dir) => { const categories = []; for (const item of await readDir(dir).catch(() => [])) if (item.isDirectory && !item.name.startsWith('.')) { const files = (await readDir(item.path).catch(() => [])).filter((file) => !file.isDirectory && supportedVideos.has(path.extname(file.name).toLowerCase())); categories.push({ name: item.name, path: item.path, clipCount: files.length, folderCount: 1, sampleClipPaths: files.slice(0, 4).map((file) => file.path), unsupportedFiles: 0, unsupportedReasons: [] }); } return { ok: true, root: dir, scannedAt: Date.now(), categories, totalClips: categories.reduce((sum, item) => sum + item.clipCount, 0), connectedFolders: categories.length, unsupportedFiles: 0 }; });
  ipcMain.handle('assets:createCategoryFolder', async (_e, dir, name) => { const target = path.join(safePath(dir), String(name).trim()); await fs.promises.mkdir(target, { recursive: true }); return { ok: true, path: target, name }; });
  ipcMain.handle('mixTemplates:list', async () => (await readJson('mix-templates.json', [])).map(({ id, name, updatedAt }) => ({ id, name, updatedAt })).sort((a, b) => b.updatedAt - a.updatedAt));
  ipcMain.handle('mixTemplates:get', async (_e, id) => (await readJson('mix-templates.json', [])).find((item) => item.id === id) || null);
  ipcMain.handle('mixTemplates:save', async (_e, name, payload) => { const templates = await readJson('mix-templates.json', []); const now = Date.now(); let item = templates.find((entry) => entry.name === String(name).trim()); if (item) Object.assign(item, { payload, updatedAt: now }); else { item = { id: crypto.randomUUID(), name: String(name).trim(), payload, createdAt: now, updatedAt: now }; templates.push(item); } await writeJson('mix-templates.json', templates); return item; });
  ipcMain.handle('mixTemplates:delete', async (_e, id) => { const templates = await readJson('mix-templates.json', []); await writeJson('mix-templates.json', templates.filter((item) => item.id !== id)); return true; });
  ipcMain.handle('store:syncReleaseScheduleMeta', (_e, value) => writeJson('release-schedule.json', value));
  ipcMain.handle('store:syncPublishAccounts', (_e, value) => writeJson('publish-accounts.json', value));
  ipcMain.handle('dashscope:chatCompletions', async (_e, payload) => { const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${String(payload.apiKey || '').trim()}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: payload.model || 'qwen-plus', messages: payload.messages || [] }) }); const result = await response.json(); if (!response.ok) throw new Error(result?.error?.message || `百炼请求失败 (${response.status})`); return result; });
}
function createWindow() { const win = new BrowserWindow({ width: 1440, height: 920, minWidth: 1100, minHeight: 700, backgroundColor: '#f7f9ff', webPreferences: { preload: path.join(root, 'electron', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } }); win.loadFile(path.join(root, 'renderer', 'index.html')); }
app.whenReady().then(() => { registerIpc(); startLicenseProxy(); startBackend(); createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { stopBackend(); stopLicenseProxy(); });
