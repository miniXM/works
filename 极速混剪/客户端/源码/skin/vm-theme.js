/* 主题引导 + 布局外壳增强。由 make_rules.py 注入到 dist/index.html 的 </head> 前。
   默认主题：light（白天）；用户点过之后以 localStorage 为准。

   这个脚本除了切主题，还负责几件"结构"上的改造（纯 CSS 做不到的部分）：
     1) 顶栏：品牌后面插面包屑、右侧插"快速跳转"搜索框和刷新按钮
     2) 侧栏：给导航插分区小标题
     3) 工作台「最近任务」：把客户端留空的缩略图格子换成第一个镜头的首帧
     4) 折起侧栏时把上面这些附加件一起收起来 */
(function () {
  var KEY = 'vm-theme';
  /* 换默认主题时把 DEFAULT_TAG 一起改掉：老机器上存着旧默认（dark）的话，
     这一次启动会被忽略、回到新默认，之后用户自己点的选择照常生效。 */
  var DEFAULT_TAG = 'light-1';
  var KEY_SEEN = 'vm-theme-default';
  var DEFAULT_MODE = 'light';
  var root = document.documentElement;

  var SUN =
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"></circle>' +
    '<path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2' +
    'M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6"></path></svg>';

  var MOON =
    '<svg viewBox="0 0 24 24"><path d="M20 14.2A8.4 8.4 0 0 1 9.8 4' +
    'a8.6 8.6 0 1 0 10.2 10.2z"></path></svg>';

  var SEARCH =
    '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.4"></circle>' +
    '<path d="M15.8 15.8L20.5 20.5"></path></svg>';

  var REFRESH =
    '<svg viewBox="0 0 24 24"><path d="M20.2 12a8.2 8.2 0 1 1-2.5-5.9"></path>' +
    '<path d="M20.4 3.6v5h-5"></path></svg>';

  /* 侧栏分组：按菜单第一项的名字定位，插一个分区标题在它前面 */
  var SECTIONS = [
    { label: '创作', first: '工作台' },
    { label: '发布', first: '发布账号管理' },
    { label: '系统', first: '系统设置' }
  ];

  function stored() {
    try {
      /* 默认值改过版（DEFAULT_TAG 变了）就忽略上次存的主题，用新默认 */
      if (localStorage.getItem(KEY_SEEN) !== DEFAULT_TAG) return null;
      var v = localStorage.getItem(KEY);
      return v === 'dark' || v === 'light' ? v : null;
    } catch (err) {
      return null;
    }
  }

  /* 把"这一次实际生效的主题"写回去：老机器上存的是旧默认值时，
     上面 stored() 已经把它忽略掉了，这里顺手覆盖成新默认，
     否则下一次启动又会读回那个旧值、主题来回跳。 */
  function remember(mode) {
    try {
      localStorage.setItem(KEY, mode);
      localStorage.setItem(KEY_SEEN, DEFAULT_TAG);
    } catch (err) {}
  }

  function systemDark() {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (err) {
      return false;
    }
  }

  function apply(mode) {
    root.setAttribute('data-vm-theme', mode || DEFAULT_MODE);
  }

  /* 没手动选过就用默认主题；想改成"跟随系统"把下面这行换成 stored() || (systemDark() ? 'dark' : 'light') */
  var bootMode = stored() || DEFAULT_MODE;
  apply(bootMode);
  remember(bootMode);

  /* 我们自己注入的 <style> 要一直待在 <head> 最后，才能盖住后加载的分页样式 */
  function keepSkinLast() {
    /* 开发时用 ui-lab.py css 热注入的是 #vm-skin-dev，别把它抢到后面去 */
    if (document.getElementById('vm-skin-dev')) return;
    var skin = document.getElementById('vm-skin');
    if (skin && skin.parentNode === document.head && document.head.lastElementChild !== skin) {
      document.head.appendChild(skin);
    }
  }

  function ensureToggle() {
    var host = document.querySelector('.app-header') || document.querySelector('.page-login');
    if (!host) return;
    var existing = host.querySelector('.vm-theme-toggle');
    if (existing) {
      paint(existing);
      return;
    }
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vm-theme-toggle';
    btn.addEventListener('click', function () {
      var next = root.getAttribute('data-vm-theme') === 'dark' ? 'light' : 'dark';
      apply(next);
      remember(next);
      paint(btn);
    });
    paint(btn);

    var user = host.querySelector('.app-header__user');
    if (user && user.parentNode === host) {
      host.insertBefore(btn, user);
    } else {
      host.appendChild(btn);
    }
  }

  function paint(btn) {
    var mode = root.getAttribute('data-vm-theme') === 'dark' ? 'dark' : 'light';
    /* 图标没变就别碰 DOM。ensureToggle() 会在每次页面变动时跑一遍，
       以前这里无条件重写 innerHTML —— 一旦这次重写正好落在 mousedown 和
       mouseup 之间，按下的 svg 和松开的 svg 就不是同一个节点了，
       浏览器算不出 click 目标，按钮就"点不动"（实测约一半的点击会丢）。
       probe\click-node.js 能复现：丢掉的点击都是 mousedown/mouseup 节点号不同。 */
    if (btn.getAttribute('data-vm-mode') === mode) return;
    btn.setAttribute('data-vm-mode', mode);
    btn.innerHTML = mode === 'dark' ? SUN : MOON;
    btn.title = mode === 'dark' ? '切换到白天模式' : '切换到暗黑模式';
    btn.setAttribute('aria-label', btn.title);
  }

  /* ---------- 结构改造：侧栏 ---------- */

  function navLinks() {
    return Array.prototype.slice.call(
      document.querySelectorAll('.app-sidebar__nav .app-sidebar__link'));
  }

  function labelOf(el) {
    if (!el) return '';
    var span = el.querySelector('.app-sidebar__label');
    return ((span ? span.textContent : el.textContent) || '').trim();
  }

  function linkHash(el) {
    var href = el.getAttribute('href') || '';
    if (href) return href;
    var path = el.getAttribute('data-path');
    return path ? '#' + path : '';
  }

  function markNavGroups() {
    var nav = document.querySelector('.app-sidebar__nav');
    if (!nav) return;
    var links = navLinks();
    if (!links.length) return;
    SECTIONS.forEach(function (section) {
      var anchor = null;
      for (var i = 0; i < links.length; i++) {
        if (labelOf(links[i]) === section.first) { anchor = links[i]; break; }
      }
      if (!anchor || anchor.parentNode !== nav) return;
      var prev = anchor.previousElementSibling;
      if (prev && prev.classList && prev.classList.contains('vm-nav-label')) return;
      var tag = document.createElement('div');
      tag.className = 'vm-nav-label';
      tag.setAttribute('data-vm-chrome', 'nav-label');
      tag.textContent = section.label;
      nav.insertBefore(tag, anchor);
    });
  }

  /* 侧栏底部原来插过一张"本地授权 / 已验证"的状态卡，客户要求整块去掉，
     所以这里不再插入；万一老缓存里还留着节点，vm-skin.css 里也把它 display:none 了。 */

  /* 侧栏折起来的时候，附加件跟着收 */
  function syncCollapsed() {
    var bar = document.querySelector('.app-sidebar');
    if (!bar) {
      root.removeAttribute('data-vm-nav');
      return;
    }
    var width = bar.getBoundingClientRect().width;
    if (width && width < 150) {
      root.setAttribute('data-vm-nav', 'mini');
    } else if (width) {
      root.removeAttribute('data-vm-nav');
    }
  }

  /* ---------- 结构改造：顶栏 ---------- */

  function activePageName() {
    var link = document.querySelector(
      '.app-sidebar__nav .app-sidebar__link--active,' +
      '.app-sidebar__nav .router-link-active');
    return labelOf(link);
  }

  function bindQuicknav(box) {
    var input = box.querySelector('.vm-quicknav__input');
    var panel = box.querySelector('.vm-quicknav__panel');

    function entries() {
      return navLinks().map(function (link) {
        return { label: labelOf(link), hash: linkHash(link) };
      }).filter(function (item) {
        return item.label && item.hash;
      });
    }

    function render() {
      var keyword = (input.value || '').trim().toLowerCase();
      var current = activePageName();
      var hits = entries().filter(function (item) {
        return !keyword || item.label.toLowerCase().indexOf(keyword) >= 0;
      });
      if (!hits.length) {
        panel.innerHTML = '<div class="vm-quicknav__empty">没有匹配的页面</div>';
        return;
      }
      panel.innerHTML = hits.map(function (item) {
        var active = item.label === current ? ' vm-quicknav__item--active' : '';
        return '<div class="vm-quicknav__item' + active + '" data-hash="' +
          item.hash.replace(/"/g, '&quot;') + '">' +
          '<span>' + item.label + '</span>' +
          '<span class="vm-quicknav__go">前往</span></div>';
      }).join('');
    }

    function open() {
      box.classList.add('vm-quicknav--open');
      render();
    }

    function close() {
      box.classList.remove('vm-quicknav--open');
      input.value = '';
    }

    input.addEventListener('focus', open);
    input.addEventListener('input', render);
    /* 焦点走了（Tab、切窗口、点别处）就把面板收掉；
       留 160ms 是为了点面板里的条目时别先被关掉 */
    input.addEventListener('blur', function () {
      setTimeout(function () {
        if (box.contains(document.activeElement)) return;
        close();
      }, 160);
    });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { input.blur(); close(); return; }
      if (event.key !== 'Enter') return;
      var first = panel.querySelector('.vm-quicknav__item');
      if (first) first.click();
    });
    panel.addEventListener('click', function (event) {
      var item = event.target.closest ? event.target.closest('.vm-quicknav__item') : null;
      if (!item) return;
      var hash = item.getAttribute('data-hash');
      if (hash) location.hash = hash;
      input.blur();
      close();
    });
    box._vmClose = close;
  }

  function markQuicknav(header) {
    var box = header.querySelector('.vm-quicknav');
    if (!box) {
      box = document.createElement('div');
      box.className = 'vm-quicknav';
      box.setAttribute('data-vm-chrome', 'quicknav');
      box.innerHTML =
        '<span class="vm-quicknav__icon">' + SEARCH + '</span>' +
        '<input class="vm-quicknav__input" type="text" spellcheck="false" ' +
        'placeholder="搜索页面…" aria-label="搜索页面" />' +
        '<div class="vm-quicknav__panel"></div>';
      var toggle = header.querySelector('.vm-theme-toggle');
      var user = header.querySelector('.app-header__user');
      var anchor = toggle || user;
      if (anchor && anchor.parentNode === header) header.insertBefore(box, anchor);
      else header.appendChild(box);
      bindQuicknav(box);
    }
    return box;
  }

  function markRefresh(header) {
    var btn = header.querySelector('.vm-icon-btn');
    if (btn) return;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vm-icon-btn';
    btn.setAttribute('data-vm-chrome', 'refresh');
    btn.title = '刷新界面';
    btn.setAttribute('aria-label', btn.title);
    btn.innerHTML = REFRESH;
    btn.addEventListener('click', function () {
      location.reload();
    });
    var toggle = header.querySelector('.vm-theme-toggle');
    if (toggle && toggle.parentNode === header) header.insertBefore(btn, toggle);
    else header.appendChild(btn);
  }

  function markHeader() {
    var header = document.querySelector('.app-header');
    if (!header) return;
    markBrand(header);
    markQuicknav(header);
    markRefresh(header);
  }

  /* logo 从侧栏搬到通栏品牌条最左边 */
  function markBrand(header) {
    var brand = header.querySelector('.app-header__brand');
    if (!brand || brand.querySelector('.vm-brand__mark')) return;
    var img = document.createElement('img');
    img.className = 'vm-brand__mark';
    img.setAttribute('data-vm-chrome', 'brand');
    img.alt = '';
    img.decoding = 'async';
    /* 顶栏品牌位放"横版字标"（长方形 logo，跟侧栏那张用同一份资源）。
       取不到字标才退回方形图标，方形也取不到就藏起来，别留破图。 */
    var wide = document.querySelector('.app-sidebar__logo-img');
    var wideSrc = wide && wide.getAttribute('src');
    var iconSrc = './app-icon.png';
    img.addEventListener('error', function () {
      if (wideSrc && img.getAttribute('src') !== iconSrc) {
        img.setAttribute('src', iconSrc);
        img.classList.remove('vm-brand__mark--wide');
        return;
      }
      img.style.display = 'none';
    });
    if (wideSrc) {
      img.classList.add('vm-brand__mark--wide');
      img.setAttribute('src', wideSrc);
    } else {
      img.setAttribute('src', iconSrc);
    }
    brand.insertBefore(img, brand.firstChild);
  }

  function closeQuicknav() {
    Array.prototype.forEach.call(
      document.querySelectorAll('.vm-quicknav'), function (box) {
        if (box._vmClose) box._vmClose();
      });
  }

  /* ---------- 结构改造：工作台「最近任务」的缩略图 ----------

     客户端把每条任务左边的 56×56 缩略图写成了一个空的 <div>（只有一层写死的
     渐变背景），里面本来什么都没有。这里按"这条任务第一个镜头选中的素材文件"
     抽一帧填进去：
       - 任务数据从 Pinia 的 mix store 读（组件就是拿它排的序，这里照抄同一套规则）
       - 素材文件走客户端自己的 assets:listSupportedVideosInFolder 接口
       - 抽帧和素材中心那个 VideoFirstFrameThumb 组件一样：video + canvas + toDataURL
     抽一帧要解一次码，所以串行跑，并且结果按"文件夹 + 序号"缓存。 */

  var THUMB_TASKS = 5;
  var THUMB_WIDTH = 224;
  var thumbCache = {};
  var thumbQueue = [];
  var thumbRunning = false;

  function mixStore() {
    try {
      var host = document.getElementById('app');
      var app = host && host.__vue_app__;
      var pinia = app && app.config.globalProperties && app.config.globalProperties.$pinia;
      return (pinia && pinia._s && pinia._s.get('mix')) || null;
    } catch (err) {
      return null;
    }
  }

  function rendererApi() {
    return (typeof window !== 'undefined' && window.electronAPI) || null;
  }

  function firstShot(store, task) {
    var shots = task && task.shots;
    if (!shots || !shots.length) return null;
    var shot = shots[0] || {};
    var folder = String(shot.folder || '').trim();
    if (!folder) return null;
    var chosen = 0;
    var indices = task.selectionIndices;
    if (indices && typeof indices === 'object' && indices[0] != null) {
      chosen = Number(indices[0]) || 0;
    } else if (shot.selectedFileIndex != null) {
      chosen = Number(shot.selectedFileIndex) || 0;
    }
    if (!isFinite(chosen) || chosen < 0) chosen = 0;
    return { folder: folder, index: chosen };
  }

  function thumbKey(spec) {
    return spec.folder + '\u0000' + spec.index;
  }

  function grabFirstFrame(url) {
    return new Promise(function (resolve, reject) {
      var video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.preload = 'auto';
      var drop = function () {
        try {
          video.removeAttribute('src');
          video.load();
          video.remove();
        } catch (err) {}
      };
      video.onerror = function () { drop(); reject(new Error('video error')); };
      video.onloadedmetadata = function () {
        var total = video.duration;
        var at = 0.1;
        if (isFinite(total) && total > 0) {
          at = Math.min(0.1, Math.max(0, total * 0.02));
          if (at >= total) at = Math.max(0, total - 0.05);
        } else {
          at = 0;
        }
        try { video.currentTime = at; } catch (err) { drop(); resolve(null); }
      };
      video.onseeked = function () {
        try {
          var width = video.videoWidth;
          var height = video.videoHeight;
          if (!width || !height) { drop(); resolve(null); return; }
          var canvas = document.createElement('canvas');
          var scale = Math.min(1, THUMB_WIDTH / width);
          canvas.width = Math.round(width * scale);
          canvas.height = Math.round(height * scale);
          var ctx = canvas.getContext('2d');
          if (!ctx) { drop(); resolve(null); return; }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          var data = canvas.toDataURL('image/jpeg', 0.8);
          drop();
          resolve(data);
        } catch (err) {
          drop();
          reject(err);
        }
      };
      video.src = url;
    });
  }

  function loadThumb(spec) {
    var key = thumbKey(spec);
    if (Object.prototype.hasOwnProperty.call(thumbCache, key)) {
      return Promise.resolve(thumbCache[key]);
    }
    var api = rendererApi();
    if (!api || !api.listSupportedVideosInFolder) return Promise.resolve(null);
    /* 只要一帧画面，不值得为每条任务再去探测 HDR，直接传 probeHdr:false */
    return api.listSupportedVideosInFolder(spec.folder, { probeHdr: false })
      .then(function (files) {
        if (!files || !files.length) return null;
        var pick = files[spec.index] || files[0];
        if (!pick || !pick.path) return null;
        return api.pathToFileUrl(pick.path).then(function (url) {
          if (!url) return null;
          return grabFirstFrame(url).then(function (data) { return data; },
                                         function () { return null; });
        });
      })
      .then(function (data) {
        thumbCache[key] = data || null;
        return thumbCache[key];
      }, function () {
        thumbCache[key] = null;
        return null;
      });
  }

  function paintThumb(node, data) {
    var box = node && node.querySelector('.workbench-task__thumb');
    if (!box || !data) return;
    box.classList.add('vm-task-thumb--image');
    box.style.backgroundImage = 'url("' + data + '")';
  }

  function pumpThumbs() {
    if (thumbRunning) return;
    var job = thumbQueue.shift();
    if (!job) return;
    thumbRunning = true;
    var next = function () {
      thumbRunning = false;
      /* 串行抽帧：同时开好几路 <video> 解码会把界面拖住 */
      setTimeout(pumpThumbs, 0);
    };
    try {
      job().then(next, next);
    } catch (err) {
      next();
    }
  }

  function markTaskThumbs() {
    var list = document.querySelector('.workbench-task-list');
    if (!list) return;
    var store = mixStore();
    if (!store || !store.tasks) return;
    var tasks = Array.prototype.slice.call(store.tasks)
      .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); })
      .slice(0, THUMB_TASKS);
    if (!tasks.length) return;
    var items = list.querySelectorAll('.workbench-task');
    for (var i = 0; i < items.length && i < tasks.length; i++) {
      (function (node, task) {
        var spec = firstShot(store, task);
        if (!spec) return;
        var key = thumbKey(spec);
        /* Vue 会复用 <li>，所以用 key 比对而不是只看"处理过没有" */
        if (node.getAttribute('data-vm-thumb') === key) return;
        node.setAttribute('data-vm-thumb', key);
        thumbQueue.push(function () {
          return loadThumb(spec).then(function (data) { paintThumb(node, data); });
        });
      })(items[i], tasks[i]);
    }
    pumpThumbs();
  }

  /* 工作台那颗「新建一个月的视频任务」：客户端源码里写死了 disabled
     （原版就是这么写的，是个没接线的占位按钮，连 onClick 都没有），
     所以它在原版里也永远点不动。这里把禁用状态摘掉，点击后跳到
     「任务中心」——批量建任务真正在那个页面里。 */
  function enableMonthButton() {
    var btn = document.querySelector('.workbench-actions__secondary');
    if (!btn) return;
    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') {
      btn.removeAttribute('disabled');
      btn.removeAttribute('aria-disabled');
      btn.classList.remove('is-disabled');
    }
    if (btn.getAttribute('data-vm-month') === '1') return;
    btn.setAttribute('data-vm-month', '1');
    btn.title = '进入「任务中心」批量新建任务';
    btn.addEventListener('click', function (event) {
      if (event && event.preventDefault) event.preventDefault();
      var link = document.querySelector('.workbench-panel__link');
      if (link) link.click();
    });
  }

  function markChrome() {
    markNavGroups();
    markHeader();
    markTaskThumbs();
    enableMonthButton();
    syncCollapsed();
  }

  document.addEventListener('mousedown', function (event) {
    if (event.target.closest && event.target.closest('.vm-quicknav')) return;
    closeQuicknav();
  });
  window.addEventListener('resize', function () {
    syncCollapsed();
  });

  var pending = null;
  function schedule() {
    if (pending) return;
    pending = setTimeout(function () {
      pending = null;
      keepSkinLast();
      ensureToggle();
      markChrome();
    }, 120);
  }

  function paintAll() {
    Array.prototype.forEach.call(document.querySelectorAll('.vm-theme-toggle'), paint);
  }

  function boot() {
    keepSkinLast();
    new MutationObserver(function () {
      schedule();
    }).observe(document.head, { childList: true });
    new MutationObserver(function () {
      schedule();
    }).observe(document.body, { childList: true, subtree: true });
    /* 侧栏折叠只改 class、不动 DOM，所以还得盯属性；
       只在侧栏 / 外壳的 class 变了时才重排，避免被 Element 的 hover 类刷屏。 */
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var target = records[i].target;
        if (!target || !target.classList) continue;
        if (target.classList.contains('app-sidebar') ||
            target.classList.contains('app-layout')) {
          schedule();
          return;
        }
      }
    }).observe(document.body, {
      attributes: true, subtree: true, attributeFilter: ['class']
    });
    ensureToggle();
    markChrome();
  }

  if (document.body) {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }

  /* 用户没手动选过时也保持默认主题，不跟随系统来回跳 */
})();
