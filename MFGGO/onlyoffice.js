const params = new URLSearchParams(location.search);
if (params.get('embedded') === '1') document.body.classList.add('embedded');
const defaultDocumentServer = params.get('documentServer') || (location.protocol === 'https:' ? `${location.origin}/office` : 'http://43.139.7.28:8080');
const configUrl = params.get('configUrl'); const apiToken = params.get('apiToken') || '';
const documentUrl = params.get('documentUrl') || 'https://static.onlyoffice.com/assets/docs/samples/price-list.xlsx';
const documentTitle = params.get('title') || '报价模板.xlsx';
const documentId = params.get('documentId') || 'demo-sheet';
const documentMode = params.get('mode') || 'edit';
const setup = document.querySelector('#ooSetup');
const editor = document.querySelector('#ooEditor');
const base64Url = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
async function signConfig(config) {
  const encoder = new TextEncoder();
  const header = base64Url(encoder.encode(JSON.stringify({alg:'HS256',typ:'JWT'})));
  const payload = base64Url(encoder.encode(JSON.stringify(config)));
  const key = await crypto.subtle.importKey('raw', encoder.encode('mfggo-onlyoffice-2026'), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${payload}`)));
  return `${header}.${payload}.${base64Url(signature)}`;
}
if (defaultDocumentServer) {
  const loadApiScript = documentServer => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${documentServer.replace(/\/$/,'')}/web-apps/apps/api/documents/api.js`;
    script.onload = resolve;
    script.onerror = () => reject(new Error('ONLYOFFICE 编辑器资源加载失败'));
    document.head.appendChild(script);
  });
  const configRequest = configUrl
    ? fetch(configUrl, { headers: { authorization: `Bearer ${apiToken}` } }).then(response => {
      if (!response.ok) throw new Error('文档配置加载失败');
      return response.json();
    })
    : Promise.resolve({ documentType:'cell', type:'desktop', width:'100%', height:'100%', document:{ fileType:'xlsx', key:`mfggo-${documentId}-v1`, title:documentTitle, url:documentUrl, permissions:{edit:documentMode==='edit',download:true,print:true} }, editorConfig:{ mode:documentMode, lang:'zh-CN', user:{id:'local-admin',name:'admin'} } });
  configRequest.then(async config => {
    const documentServer = config.documentServer || defaultDocumentServer;
    delete config.documentServer;
    document.querySelector('#serverState').textContent = documentServer;
    await loadApiScript(documentServer);
    if (!config.token) config.token = await signConfig(config);
    new DocsAPI.DocEditor('ooEditor', config);
    setup.classList.add('hidden');
    editor.classList.remove('hidden');
  }).catch(error => {
    setup.querySelector('h1').textContent = '编辑器加载失败';
    setup.querySelector('p').textContent = error.message || '请稍后重试';
  });
}
document.querySelector('#openFile').onclick = () => document.querySelector('#fileInput').click();
document.querySelector('#fileInput').onchange = event => { const file = event.target.files?.[0]; if (file) document.querySelector('#fileState').textContent = file.name; };
document.querySelector('#downloadFile').onclick = () => window.print();
