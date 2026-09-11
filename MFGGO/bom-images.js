export function createBomImageSession({ projectId, token, active, request }) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/list-images`;
  const cache = new Map(), controllers = new Set();
  let disposed = false;
  const alive = () => !disposed && active();
  async function load(imageId) {
    if (!imageId || !alive()) return '';
    if (cache.has(imageId)) return cache.get(imageId);
    const pending = (async () => {
      const controller = new AbortController();
      controllers.add(controller);
      try {
        const path = `${base}/${encodeURIComponent(imageId)}`;
        const url = location.pathname.startsWith('/mfggo/') ? `/mfggo-api/${path.slice(5)}` : path;
        const response = await fetch(url, { signal: controller.signal, headers: { authorization: `Bearer ${token}` } });
        if (!response.ok) throw new Error('图片暂时无法加载');
        const blob = await response.blob();
        if (!alive()) return '';
        return URL.createObjectURL(blob);
      } finally { controllers.delete(controller); }
    })();
    cache.set(imageId, pending);
    try { return await pending; }
    catch (error) { cache.delete(imageId); throw error; }
  }
  async function upload(file) {
    if (!alive()) return null;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPG 或 WebP 图片');
    if (file.size > 10 * 1024 * 1024) throw new Error('原始图片不能超过 10 MB');
    const bitmap = await createImageBitmap(file);
    let dataUrl;
    try {
      if (bitmap.width * bitmap.height > 40_000_000) throw new Error('图片尺寸过大');
      const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      dataUrl = canvas.toDataURL('image/jpeg', .88);
      for (const quality of [.75, .6, .45]) {
        if (dataUrl.length <= 690_000) break;
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }
      if (dataUrl.length > 690_000) throw new Error('图片细节过多，请裁剪或压缩后重试');
    } finally { bitmap.close(); }
    if (!alive()) return null;
    const result = await request(base, { method: 'POST', body: JSON.stringify({ name: file.name.slice(0, 160), dataUrl }) });
    if (!alive() || !result?.image) return null;
    return result.image;
  }
  function dispose() {
    disposed = true;
    for (const controller of controllers) controller.abort();
    for (const pending of cache.values()) void pending.then(url => { if (url) URL.revokeObjectURL(url); }).catch(() => {});
    cache.clear();
  }
  return { load, upload, dispose };
}
