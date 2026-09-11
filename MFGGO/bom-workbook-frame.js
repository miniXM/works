export function mountBomWorkbookFrame(container, options) {
  const frame = document.createElement('iframe');
  frame.className = 'bom-workbook-frame';
  frame.title = options.editable === false ? 'BOM 工作簿' : 'BOM 工作簿编辑器';
  frame.dataset.bomWorkbook = '';
  frame.allow = 'clipboard-read; clipboard-write';
  let disposed = false, starting = false, instance = null, resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const timeout = setTimeout(() => rejectReady(new Error('工作簿加载超时，请重试')), 60000);
  async function initialize() {
    if (disposed || starting || instance || !frame.contentWindow?.createBomWorkbook) return;
    starting = true;
    try {
      instance = await frame.contentWindow.createBomWorkbook(options);
      if (disposed) { instance?.dispose(); return; }
      clearTimeout(timeout);
      frame.dataset.bomWorkbookReady = 'true';
      resolveReady(instance);
    } catch (error) { clearTimeout(timeout); rejectReady(error); }
  }
  frame.addEventListener('load', () => {
    if (disposed) return;
    frame.contentWindow.addEventListener('bom-sheet-ready', initialize, { once: true });
    void initialize();
  });
  frame.addEventListener('error', () => rejectReady(new Error('工作簿加载失败，请重试')));
  frame.src = './bom-sheet.html';
  container.appendChild(frame);
  return {
    frame, ready,
    async snapshot() { const workbook = await ready; if (disposed) return null; return workbook.snapshot(); },
    setEditable(value) { if (!disposed) void ready.then(workbook => { if (!disposed) workbook.setEditable(value); }).catch(() => {}); },
    dispose() { if (disposed) return; disposed = true; clearTimeout(timeout); instance?.dispose(); frame.remove(); resolveReady(null); },
  };
}
