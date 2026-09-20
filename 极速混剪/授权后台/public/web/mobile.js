/* VideoMix 授权中心 · 手机端 H5
   同一套后端接口，只做窄屏交互；电脑版走 pc.html + app.js。 */
(function () {
  'use strict';

  var VIEW_KEY = 'vm-admin-view';

  var state = {
    user: null,
    page: 'overview',
    overview: null,
    codes: [],
    codeStatus: 'all',
    codeQuery: '',
    codeLimit: 60,
    agents: [],
    batches: [],
    update: null,
    updateClients: null
  };

  var TABS = [
    { id: 'overview', title: '概览', icon: '◧', sub: '激活码与代理商概况' },
    { id: 'codes', title: '激活码', icon: '▤', sub: '查询、分配、吊销与解绑' },
    { id: 'batches', title: '批次', icon: '❐', sub: '生成与整批分配', master: true },
    { id: 'agents', title: '代理商', icon: '⛭', sub: '一级 / 二级代理商' },
    { id: 'me', title: '我的', icon: '☰', sub: '账号、安全与客户端升级' }
  ];

  var STATE_TEXT = {
    unused: ['未使用', 'gray'],
    active: ['部分绑定', 'blue'],
    bound: ['已绑定满', 'green'],
    expired: ['已过期', 'amber'],
    revoked: ['已吊销', 'rose']
  };

  var STATUS_CHIPS = [
    ['all', '全部'], ['unused', '未使用'], ['active', '部分绑定'],
    ['bound', '已绑定满'], ['expired', '已过期'], ['revoked', '已吊销']
  ];

  // ---------------------------------------------------------------- 工具
  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function fmtTime(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) +
      ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
  }

  function fmtDay(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function daysLeft(value) {
    if (!value) return '未开始计时';
    var diff = new Date(value).getTime() - Date.now();
    if (isNaN(diff)) return '—';
    if (diff <= 0) return '已过期';
    return Math.floor(diff / 86400000) + ' 天';
  }

  function fmtSize(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  function roleText(user) {
    if (!user) return '';
    if (user.role === 'master') return '总账号';
    return user.level === 1 ? '一级代理商' : '二级代理商';
  }

  function canCreateAgent() {
    return !!state.user && (state.user.role === 'master' || state.user.level === 1);
  }

  function isMaster() { return !!state.user && state.user.role === 'master'; }

  function toast(message, kind) {
    var wrap = $('mToasts');
    if (!wrap) return;
    var node = document.createElement('div');
    node.className = 'toast ' + (kind || '');
    node.textContent = message;
    wrap.appendChild(node);
    setTimeout(function () { node.remove(); }, 3200);
  }

  function api(path, options) {
    options = options || {};
    var init = {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }
    };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);
    return fetch(path, init).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (response.status === 401) {
          state.user = null;
          showLogin();
          throw new Error(data.message || '登录已过期，请重新登录');
        }
        if (!response.ok || data.success === false) {
          throw new Error(data.message || ('请求失败 (' + response.status + ')'));
        }
        return data;
      });
    });
  }

  function copyText(text) {
    var value = String(text || '');
    var done = function () { toast('已复制：' + value, 'ok'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(done, fallback);
    } else {
      fallback();
    }
    function fallback() {
      var area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', 'readonly');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      area.setSelectionRange(0, value.length);
      try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败，请手动选择', 'err'); }
      area.remove();
    }
  }

  // ---------------------------------------------------------------- 弹层
  function sheet(html) {
    // 每次重新渲染都换一个新节点，避免旧的 click 监听残留导致动作执行两次
    var current = $('mSheet');
    var fresh = current.cloneNode(false);
    current.parentNode.replaceChild(fresh, current);
    fresh.innerHTML = html;
    $('mSheetMask').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeSheet() {
    $('mSheetMask').hidden = true;
    $('mSheet').innerHTML = '';
    document.body.style.overflow = '';
  }

  $('mSheetMask').addEventListener('click', function (event) {
    if (event.target === $('mSheetMask')) closeSheet();
  });

  document.addEventListener('click', function (event) {
    var closer = event.target.closest ? event.target.closest('[data-m-close]') : null;
    if (closer) closeSheet();
  });

  function sheetHead(title, sub) {
    return '<div class="m-sheet__head"><div class="m-sheet__title">' + esc(title) + '</div>' +
      (sub ? '<div class="m-sheet__sub">' + esc(sub) + '</div>' : '') +
      '<button class="m-sheet__close" type="button" data-m-close>✕</button></div>';
  }

  function kvRow(label, value, mono) {
    return '<div><dt>' + esc(label) + '</dt><dd' + (mono ? ' class="mono"' : '') + '>' +
      esc(value === null || value === undefined || value === '' ? '—' : value) + '</dd></div>';
  }

  function pill(state) {
    var meta = STATE_TEXT[state] || [state || '—', 'gray'];
    return '<span class="m-pill m-pill--' + meta[1] + '">' + esc(meta[0]) + '</span>';
  }

  // ---------------------------------------------------------------- 登录
  function showLogin(message) {
    $('mApp').hidden = true;
    $('mLogin').hidden = false;
    if (message) $('mLoginHint').textContent = message;
  }

  function showApp() {
    $('mLogin').hidden = true;
    $('mApp').hidden = false;
    var tabs = visibleTabs();
    if (!tabs.some(function (t) { return t.id === state.page; })) state.page = 'overview';
    render();
  }

  function visibleTabs() {
    return TABS.filter(function (tab) { return !tab.master || isMaster(); });
  }

  $('mLoginForm').addEventListener('submit', function (event) {
    event.preventDefault();
    var button = $('mLoginBtn');
    button.disabled = true;
    button.textContent = '登录中…';
    api('/api/login', {
      method: 'POST',
      body: { username: $('mUser').value.trim(), password: $('mPass').value }
    }).then(function (data) {
      state.user = data.user || null;
      $('mPass').value = '';
      toast('登录成功', 'ok');
      showApp();
    }).catch(function (error) {
      toast(error.message, 'err');
      $('mLoginHint').textContent = error.message;
    }).finally(function () {
      button.disabled = false;
      button.textContent = '登录';
    });
  });

  // ---------------------------------------------------------------- 骨架
  function renderTabs() {
    $('mTabs').innerHTML = visibleTabs().map(function (tab) {
      return '<button class="m-tab' + (state.page === tab.id ? ' active' : '') +
        '" type="button" data-tab="' + tab.id + '">' +
        '<span class="m-tab__icon">' + tab.icon + '</span>' + esc(tab.title) + '</button>';
    }).join('');
  }

  function render() {
    var meta = visibleTabs().filter(function (t) { return t.id === state.page; })[0] || TABS[0];
    $('mTitle').innerHTML = esc(meta.title) +
      '<span class="m-header__sub">' + esc(meta.sub) + '</span>';
    if ($('mWho')) {
      var who = '';
      if (state.user) {
        var name = state.user.displayName || state.user.username;
        var role = roleText(state.user);
        who = name === role ? role : name + ' · ' + role;
      }
      $('mWho').textContent = who;
      $('mWho').title = roleText(state.user);
    }
    renderTabs();
    var body = $('mBody');
    body.onclick = null;
    body.innerHTML = '<div class="m-loading">加载中…</div>';
    body.scrollTop = 0;
    window.scrollTo(0, 0);
    PAGES[state.page](body);
  }

  $('mTabs').addEventListener('click', function (event) {
    var button = event.target.closest ? event.target.closest('[data-tab]') : null;
    if (!button) return;
    state.page = button.dataset.tab;
    render();
  });

  $('mRefresh').addEventListener('click', function () {
    toast('已刷新');
    render();
  });

  function statCard(label, value, hint, tone) {
    return '<div class="m-stat' + (tone ? ' m-stat--' + tone : '') + '">' +
      '<div class="m-stat__label">' + esc(label) + '</div>' +
      '<div class="m-stat__value">' + esc(value) + '</div>' +
      (hint ? '<div class="m-stat__hint">' + esc(hint) + '</div>' : '') + '</div>';
  }

  function emptyBox(text) {
    return '<div class="m-empty">' + esc(text) + '</div>';
  }

  function fabButton(label, key) {
    return '<button class="m-fab" type="button" data-fab="' + esc(key) + '">' + esc(label) + '</button>';
  }

  // ---------------------------------------------------------------- 概览
  var PAGES = {
    overview: function (body) {
      api('/api/overview').then(function (data) {
        var o = state.overview = data.data;
        var html = '<div class="m-stats">' +
          statCard('激活码总数', o.totalCodes, '可用 ' + o.availableCodes, 'blue') +
          statCard('已绑定', o.boundCodes, '设备 ' + o.devices + ' 台', 'green') +
          statCard('已过期', o.expiredCodes, '待续期', 'amber') +
          statCard('已吊销', o.revokedCodes, '不可再用', 'rose') +
          '</div>';

        html += '<div class="m-section"><div class="m-section__head">快捷操作</div>' +
          '<div class="m-section__body"><div class="m-field__row">' +
          '<button class="m-btn" type="button" data-quick="codes">激活码</button>' +
          '<button class="m-btn" type="button" data-quick="records">激活记录</button>' +
          (isMaster()
            ? '<button class="m-btn" type="button" data-quick="new-batch">新建批次</button>'
            : '') +
          (canCreateAgent()
            ? '<button class="m-btn" type="button" data-quick="new-agent">新建代理商</button>'
            : '') +
          '</div></div></div>';

        var recent = o.recentActivations || [];
        html += '<div class="m-section"><div class="m-section__head">最近 7 天激活' +
          '<small>' + recent.length + ' 条</small></div><div class="m-list">';
        if (!recent.length) {
          html += emptyBox('最近 7 天没有新的设备激活');
        } else {
          html += recent.map(function (row) {
            var done = new Date(row.activated_at).getTime();
            var diff = Date.now() - done;
            var ago = diff < 60000 ? '刚刚' : diff < 3600000 ? Math.floor(diff / 60000) + ' 分钟前'
              : diff < 86400000 ? Math.floor(diff / 3600000) + ' 小时前' : Math.floor(diff / 86400000) + ' 天前';
            return '<div class="m-item"><div class="m-item__top">' +
              '<span class="m-item__title m-item__code">' + esc(row.code || '—') + '</span>' +
              '<span class="m-pill m-pill--green">' + esc(ago) + '</span></div>' +
              '<div class="m-item__meta">' +
              '<span>设备 <b>' + esc(String(row.device_id || '').slice(0, 16)) + '</b></span>' +
              '<span>归属 <b>' + esc(row.owner_name || '总账号') + '</b></span>' +
              '</div></div>';
          }).join('');
        }
        html += '</div></div>';

        var logs = o.logins || [];
        if (logs.length) {
          html += '<div class="m-section"><div class="m-section__head">最近操作</div><div class="m-list">' +
            logs.map(function (row) {
              return '<div class="m-item"><div class="m-item__top">' +
                '<span class="m-item__title">' + esc(row.actor_name || row.action) + '</span>' +
                '<span class="m-pill m-pill--gray">' + esc(fmtTime(row.ts)) + '</span></div>' +
                '<div class="m-item__meta"><span>' + esc(row.detail || '') + '</span></div></div>';
            }).join('') + '</div></div>';
        }

        body.innerHTML = html;

        body.onclick = function (event) {
          var button = event.target.closest ? event.target.closest('[data-quick]') : null;
          if (!button) return;
          var action = button.dataset.quick;
          if (action === 'codes') { state.page = 'codes'; render(); }
          if (action === 'records') openRecordsSheet();
          if (action === 'new-batch') openNewBatchSheet();
          if (action === 'new-agent') openNewAgentSheet();
        };
      }).catch(function (error) {
        body.innerHTML = emptyBox(error.message);
      });
    },

    // ------------------------------------------------------------ 激活码
    codes: function (body) {
      body.innerHTML =
        '<div class="m-search"><input id="mQ" type="search" placeholder="搜索激活码 / 备注" ' +
        'value="' + esc(state.codeQuery) + '" enterkeyhint="search">' +
        '<button type="button" id="mSearchBtn">搜索</button></div>' +
        '<div class="m-chips" id="mChips">' + STATUS_CHIPS.map(function (chip) {
          return '<button class="m-chip' + (state.codeStatus === chip[0] ? ' active' : '') +
            '" type="button" data-status="' + chip[0] + '">' + esc(chip[1]) + '</button>';
        }).join('') + '</div>' +
        '<div id="mCodeList"><div class="m-loading">加载中…</div></div>';

      $('mSearchBtn').addEventListener('click', function () {
        state.codeQuery = $('mQ').value.trim();
        state.codeLimit = 60;
        loadCodes();
      });
      $('mQ').addEventListener('keydown', function (event) {
        if (event.key === 'Enter') { event.preventDefault(); $('mSearchBtn').click(); $('mQ').blur(); }
      });
      $('mChips').addEventListener('click', function (event) {
        var chip = event.target.closest ? event.target.closest('[data-status]') : null;
        if (!chip) return;
        state.codeStatus = chip.dataset.status;
        state.codeLimit = 60;
        Array.prototype.forEach.call($('mChips').children, function (node) {
          node.classList.toggle('active', node.dataset.status === state.codeStatus);
        });
        loadCodes();
      });
      $('mCodeList').addEventListener('click', function (event) {
        var more = event.target.closest ? event.target.closest('[data-more]') : null;
        if (more) { state.codeLimit += 60; renderCodeList(); return; }
        var item = event.target.closest ? event.target.closest('[data-code-id]') : null;
        if (!item) return;
        var found = state.codes.filter(function (c) { return String(c.id) === item.dataset.codeId; })[0];
        if (found) openCodeSheet(found);
      });
      loadCodes();
    },

    // -------------------------------------------------------------- 批次
    batches: function (body) {
      Promise.all([
        api('/api/batches'),
        api('/api/agents').catch(function () { return { data: [] }; })
      ]).then(function (result) {
        state.batches = result[0].data || [];
        state.agents = (result[1].data || []).filter(function (a) { return a.role === 'agent'; });
        var html = '<div id="mBatchList"><div class="m-list">';
        if (!state.batches.length) {
          html += emptyBox('还没有批次，点右下角新建');
        } else {
          html += state.batches.map(function (batch) {
            var dist = Object.keys(batch.distribution || {}).map(function (key) {
              return key + ' ' + batch.distribution[key];
            }).join(' · ') || '尚未分配';
            return '<div class="m-item" data-batch-id="' + batch.id + '">' +
              '<div class="m-item__top">' +
              '<span class="m-item__title">' + esc(batch.name) + '</span>' +
              '<span class="m-pill m-pill--blue">' + esc(batch.quantity) + ' 个</span></div>' +
              '<div class="m-item__meta">' +
              '<span>有效期 <b>' + esc(batch.days) + ' 天</b></span>' +
              '<span>可绑 <b>' + esc(batch.maxDevices) + ' 台</b></span>' +
              '<span>已绑 <b>' + esc(batch.bound) + '</b></span>' +
              '<span>吊销 <b>' + esc(batch.revoked) + '</b></span>' +
              '</div>' +
              '<div class="m-item__meta"><span>' + esc(dist) + '</span></div>' +
              '<div class="m-item__meta"><span>' + esc(fmtTime(batch.createdAt)) + '</span></div>' +
              '</div>';
          }).join('');
        }
        html += '</div></div>';
        if (isMaster()) html += fabButton('＋ 新建批次', 'batch');
        body.innerHTML = html;

        body.onclick = function (event) {
          var fab = event.target.closest ? event.target.closest('[data-fab]') : null;
          if (fab) { openNewBatchSheet(); return; }
          var item = event.target.closest ? event.target.closest('[data-batch-id]') : null;
          if (!item) return;
          var found = state.batches.filter(function (b) { return String(b.id) === item.dataset.batchId; })[0];
          if (found) openBatchSheet(found);
        };
      }).catch(function (error) {
        body.innerHTML = emptyBox(error.message);
      });
    },

    // ------------------------------------------------------------ 代理商
    agents: function (body) {
      api('/api/agents').then(function (data) {
        state.agents = (data.data || []).filter(function (a) { return a.role === 'agent'; });
        var html = '<div id="mAgentList"><div class="m-list">';
        if (!state.agents.length) {
          html += emptyBox(canCreateAgent() ? '还没有代理商，点右下角新建' : '还没有下级代理商');
        } else {
          html += state.agents.map(function (agent) {
            var level = agent.level === 1 ? '一级' : '二级';
            var tone = agent.status === 'disabled' ? 'rose' : 'green';
            var statusText = agent.status === 'disabled' ? '已停用' : '正常';
            return '<div class="m-item" data-agent-id="' + agent.id + '">' +
              '<div class="m-item__top">' +
              '<span class="m-item__title">' + esc(agent.displayName || agent.username) + '</span>' +
              '<span class="m-pill m-pill--' + tone + '">' + esc(statusText) + '</span></div>' +
              '<div class="m-item__meta">' +
              '<span>账号 <b>' + esc(agent.username) + '</b></span>' +
              '<span>' + esc(level) + '代理商</span>' +
              '<span>激活码 <b>' + esc(agent.codeCount) + '</b></span>' +
              '</div></div>';
          }).join('');
        }
        html += '</div></div>';
        if (canCreateAgent()) html += fabButton('＋ 新建代理商', 'agent');
        body.innerHTML = html;

        body.onclick = function (event) {
          var fab = event.target.closest ? event.target.closest('[data-fab]') : null;
          if (fab) { openNewAgentSheet(); return; }
          var item = event.target.closest ? event.target.closest('[data-agent-id]') : null;
          if (!item) return;
          var found = state.agents.filter(function (a) { return String(a.id) === item.dataset.agentId; })[0];
          if (found) openAgentSheet(found);
        };
      }).catch(function (error) {
        body.innerHTML = emptyBox(error.message);
      });
    },

    // --------------------------------------------------------------- 我的
    me: function (body) {
      var user = state.user || {};
      var html = '<div class="m-section"><div class="m-section__head">账号信息</div>' +
        '<dl class="m-kv">' +
        kvRow('名称', user.displayName || user.username) +
        kvRow('账号', user.username) +
        kvRow('身份', roleText(user)) +
        kvRow('上次登录', fmtTime(user.lastLogin)) +
        '</dl></div>';

      html += '<div class="m-section"><div class="m-section__head">安全与设置</div>' +
        '<button class="m-sheet__action" type="button" data-me="password">修改密码' +
        '<span style="flex:1"></span><span style="color:#c3c8d4">›</span></button>' +
        (isMaster()
          ? '<button class="m-sheet__action" type="button" data-me="update">客户端升级' +
            '<span style="flex:1"></span><span style="color:#c3c8d4">›</span></button>' +
            '<button class="m-sheet__action" type="button" data-me="backup">数据备份' +
            '<span style="flex:1"></span><span style="color:#c3c8d4">›</span></button>'
          : '') +
        '<button class="m-sheet__action" type="button" data-me="pc">切换到电脑版' +
        '<span style="flex:1"></span><span style="color:#c3c8d4">›</span></button>' +
        '</div>';

      html += '<div class="m-section"><div class="m-section__body" style="padding:14px">' +
        '<button class="m-btn m-btn--block" type="button" data-me="logout">退出登录</button>' +
        '</div></div>';

      body.innerHTML = html;

      body.onclick = function (event) {
        var button = event.target.closest ? event.target.closest('[data-me]') : null;
        if (!button) return;
        var action = button.dataset.me;
        if (action === 'password') openPasswordSheet();
        if (action === 'update') openUpdateSheet();
        if (action === 'backup') openBackupSheet();
        if (action === 'pc') {
          try { localStorage.setItem(VIEW_KEY, 'pc'); } catch (e) { }
          location.href = 'pc.html';
        }
        if (action === 'logout') {
          api('/api/logout', { method: 'POST' }).catch(function () { }).then(function () {
            state.user = null;
            showLogin('已退出登录');
          });
        }
      };
    }
  };

  // ------------------------------------------------------------ 激活码列表
  function loadCodes() {
    var box = $('mCodeList');
    if (!box) return;
    box.innerHTML = '<div class="m-loading">加载中…</div>';
    var query = '/api/codes?status=' + encodeURIComponent(state.codeStatus) +
      '&q=' + encodeURIComponent(state.codeQuery);
    api(query).then(function (data) {
      state.codes = data.data || [];
      renderCodeList();
    }).catch(function (error) {
      box.innerHTML = emptyBox(error.message);
    });
  }

  function renderCodeList() {
    var box = $('mCodeList');
    if (!box) return;
    if (!state.codes.length) {
      box.innerHTML = emptyBox(state.codeQuery ? '没有匹配的激活码' : '这里还没有激活码');
      return;
    }
    var shown = state.codes.slice(0, state.codeLimit);
    var html = '<div class="m-list">' + shown.map(function (item) {
      return '<div class="m-item" data-code-id="' + item.id + '">' +
        '<div class="m-item__top">' +
        '<span class="m-item__title m-item__code">' + esc(item.code) + '</span>' +
        pill(item.state) + '</div>' +
        '<div class="m-item__meta">' +
        '<span>归属 <b>' + esc(item.ownerName) + '</b></span>' +
        '<span>设备 <b>' + esc(item.deviceCount) + '/' + esc(item.maxDevices) + '</b></span>' +
        '<span>' + (item.expiresAt ? '到期 <b>' + esc(fmtDay(item.expiresAt)) + '</b>' : '激活后开始计时') + '</span>' +
        (item.label ? '<span>' + esc(item.label) + '</span>' : '') +
        '</div></div>';
    }).join('') + '</div>';

    if (state.codes.length > shown.length) {
      html += '<button class="m-btn m-btn--block" type="button" data-more="1" style="margin-top:12px">' +
        '加载更多（还有 ' + (state.codes.length - shown.length) + ' 个）</button>';
    } else {
      html += '<div class="m-empty">共 ' + state.codes.length + ' 个激活码</div>';
    }
    box.innerHTML = html;
  }

  // ------------------------------------------------------------ 激活码详情
  function openCodeSheet(item) {
    var html = sheetHead(item.code, STATE_TEXT[item.state] ? STATE_TEXT[item.state][0] : '') +
      '<div class="m-sheet__body">' +
      '<div class="m-sheet__group"><dl class="m-kv">' +
      kvRow('归属', item.ownerName) +
      kvRow('批次', item.batchName) +
      kvRow('可绑设备', item.maxDevices + ' 台') +
      kvRow('已绑定', item.deviceCount + ' 台') +
      kvRow('有效期', item.days + ' 天') +
      kvRow('到期时间', item.expiresAt ? fmtDay(item.expiresAt) : '激活后开始计时') +
      kvRow('剩余', daysLeft(item.expiresAt)) +
      kvRow('创建时间', fmtTime(item.createdAt)) +
      (item.note ? kvRow('备注', item.note) : '') +
      '</dl></div>' +
      '<div class="m-sheet__group">' +
      '<button class="m-sheet__action" type="button" data-act="copy">复制激活码' +
      '<span style="flex:1"></span><span style="color:#c3c8d4">›</span></button>' +
      '<button class="m-sheet__action" type="button" data-act="devices">查看绑定设备（' + item.deviceCount + '）' +
      '<span style="flex:1"></span><span style="color:#c3c8d4">›</span></button>' +
      '<button class="m-sheet__action m-sheet__action--primary" type="button" data-act="allocate">分配给代理商' +
      '<span style="flex:1"></span><span style="color:#c3c8d4">›</span></button>' +
      '<button class="m-sheet__action" type="button" data-act="toggle">' +
      (item.revoked ? '恢复使用' : '吊销激活码') +
      '<span style="flex:1"></span><span style="color:#c3c8d4">›</span></button>' +
      '<button class="m-sheet__action m-sheet__action--danger" type="button" data-act="delete">删除激活码' +
      '<span style="flex:1"></span><span style="color:#c3c8d4">›</span></button>' +
      '</div></div>';
    sheet(html);

    $('mSheet').addEventListener('click', function (event) {
      var button = event.target.closest ? event.target.closest('[data-act]') : null;
      if (!button) return;
      var action = button.dataset.act;
      if (action === 'copy') copyText(item.code);
      if (action === 'devices') openDevicesSheet(item);
      if (action === 'allocate') openAllocateSheet([item.id], item.code);
      if (action === 'toggle') {
        var path = '/api/codes/' + item.id + (item.revoked ? '/restore' : '/revoke');
        api(path, { method: 'POST' }).then(function (data) {
          toast(data.message || '已更新', 'ok');
          closeSheet();
          loadCodes();
        }).catch(function (error) { toast(error.message, 'err'); });
      }
      if (action === 'delete') {
        if (!window.confirm('删除后设备和记录都会一起清掉，确定删除 ' + item.code + ' ？')) return;
        api('/api/codes/' + item.id, { method: 'DELETE' }).then(function (data) {
          toast(data.message || '已删除', 'ok');
          closeSheet();
          loadCodes();
        }).catch(function (error) { toast(error.message, 'err'); });
      }
    });
  }

  function openDevicesSheet(item) {
    sheet(sheetHead('绑定设备', item.code) +
      '<div class="m-sheet__body"><div class="m-loading">加载中…</div></div>');
    api('/api/codes/' + item.id + '/devices').then(function (data) {
      var devices = data.data || [];
      var html = sheetHead('绑定设备', item.code + ' · ' + devices.length + '/' + (data.code ? data.code.maxDevices : item.maxDevices)) +
        '<div class="m-sheet__body">';
      if (!devices.length) {
        html += emptyBox('这个激活码还没有绑定设备');
      } else {
        html += '<div class="m-sheet__group"><dl class="m-kv">' + devices.map(function (device) {
          return '<div><dt>设备</dt><dd class="mono">' + esc(device.device_id) +
            '<br><span style="color:#9ca3af;font-size:12px">激活 ' + esc(fmtTime(device.activated_at)) +
            ' · 最近 ' + esc(fmtTime(device.last_seen_at)) + '</span>' +
            (device.ip ? '<br><span style="color:#9ca3af;font-size:12px">IP ' + esc(device.ip) + '</span>' : '') +
            '<br><button class="m-btn" type="button" style="height:34px;margin-top:8px;max-width:120px" ' +
            'data-unbind="' + esc(device.device_id) + '">解绑该设备</button></dd></div>';
        }).join('') + '</dl></div>';
      }
      html += '</div>';
      sheet(html);

      $('mSheet').addEventListener('click', function (event) {
        var button = event.target.closest ? event.target.closest('[data-unbind]') : null;
        if (!button) return;
        var deviceId = button.dataset.unbind;
        if (!window.confirm('解绑后这台电脑需要重新输入激活码，确定？')) return;
        api('/api/codes/' + item.id + '/devices/' + encodeURIComponent(deviceId) + '/unbind', { method: 'POST' })
          .then(function (data) {
            toast(data.message || '设备已解绑', 'ok');
            closeSheet();
            loadCodes();
          }).catch(function (error) { toast(error.message, 'err'); });
      });
    }).catch(function (error) {
      sheet(sheetHead('绑定设备', item.code) + '<div class="m-sheet__body">' + emptyBox(error.message) + '</div>');
    });
  }

  function openAllocateSheet(ids, title) {
    if (!state.agents.length) {
      api('/api/agents').then(function (data) {
        state.agents = (data.data || []).filter(function (a) { return a.role === 'agent'; });
        openAllocateSheet(ids, title);
      }).catch(function (error) { toast(error.message, 'err'); });
      return;
    }
    var list = state.agents;
    var html = sheetHead('分配给代理商', title || (ids.length + ' 个激活码')) +
      '<div class="m-sheet__body">';
    if (!list.length) {
      html += emptyBox('还没有代理商，先去「代理商」建一个');
    } else {
      html += '<div class="m-sheet__group">' + list.map(function (agent) {
        return '<button class="m-sheet__action" type="button" data-agent="' + agent.id + '">' +
          '<span>' + esc(agent.displayName || agent.username) + '</span>' +
          '<span style="flex:1"></span>' +
          '<span style="color:#9ca3af;font-size:12px">' +
          (agent.level === 1 ? '一级' : '二级') + ' · ' + esc(agent.username) + '</span></button>';
      }).join('') + '</div>';
      if (isMaster()) {
        html += '<div class="m-sheet__group"><button class="m-sheet__action" type="button" data-agent="">' +
          '收回给总账号<span style="flex:1"></span><span style="color:#c3c8d4">›</span></button></div>';
      }
    }
    html += '</div>';
    sheet(html);

    $('mSheet').addEventListener('click', function (event) {
      var button = event.target.closest ? event.target.closest('[data-agent]') : null;
      if (!button) return;
      var agentId = button.dataset.agent ? Number(button.dataset.agent) : null;
      api('/api/codes/allocate', { method: 'POST', body: { agentId: agentId, ids: ids } })
        .then(function (data) {
          toast(data.message || '已分配', 'ok');
          closeSheet();
          if (state.page === 'codes') loadCodes();
          else render();
        }).catch(function (error) { toast(error.message, 'err'); });
    });
  }

  // ---------------------------------------------------------------- 批次
  function openRecordsSheet() {
    sheet(sheetHead('激活记录', '最近 100 台设备') +
      '<div class="m-sheet__body"><div class="m-loading">加载中…</div></div>');
    api('/api/records?limit=100').then(function (data) {
      var rows = data.data || [];
      var html = sheetHead('激活记录', rows.length + ' 条') + '<div class="m-sheet__body">';
      if (!rows.length) {
        html += emptyBox('还没有设备激活记录');
      } else {
        html += '<div class="m-sheet__group"><dl class="m-kv">' + rows.map(function (row) {
          return '<div><dt>' + esc(fmtTime(row.activatedAt)) + '</dt><dd>' +
            '<span class="mono">' + esc(row.code || '—') + '</span>' +
            '<br><span style="color:#6b7280;font-size:12px">设备 ' +
            esc(String(row.deviceId || '').slice(0, 20)) + ' · 归属 ' + esc(row.ownerName) + '</span>' +
            (row.ip ? '<br><span style="color:#9ca3af;font-size:12px">IP ' + esc(row.ip) + '</span>' : '') +
            '</dd></div>';
        }).join('') + '</dl></div>';
      }
      html += '</div>';
      sheet(html);
    }).catch(function (error) {
      sheet(sheetHead('激活记录') + '<div class="m-sheet__body">' + emptyBox(error.message) + '</div>');
    });
  }

  // ---------------------------------------------------------------- 批次
  function openBatchSheet(batch) {
    var dist = Object.keys(batch.distribution || {}).map(function (key) {
      return key + ' ' + batch.distribution[key];
    }).join(' · ') || '尚未分配';
    var html = sheetHead(batch.name, batch.quantity + ' 个激活码') +
      '<div class="m-sheet__body">' +
      '<div class="m-sheet__group"><dl class="m-kv">' +
      kvRow('数量', batch.quantity + ' 个') +
      kvRow('有效期', batch.days + ' 天') +
      kvRow('可绑设备', batch.maxDevices + ' 台') +
      kvRow('已绑定', batch.bound + ' 个') +
      kvRow('已吊销', batch.revoked + ' 个') +
      kvRow('归属分布', dist) +
      kvRow('创建时间', fmtTime(batch.createdAt)) +
      (batch.note ? kvRow('备注', batch.note) : '') +
      '</dl></div>' +
      '<div class="m-sheet__group">' +
      '<button class="m-sheet__action m-sheet__action--primary" type="button" data-act="allocate">整批分配给代理商' +
      '<span style="flex:1"></span><span style="color:#c3c8d4">›</span></button>' +
      '<button class="m-sheet__action" type="button" data-act="codes">查看这批激活码' +
      '<span style="flex:1"></span><span style="color:#c3c8d4">›</span></button>' +
      '<button class="m-sheet__action m-sheet__action--danger" type="button" data-act="delete">删除批次' +
      '<span style="flex:1"></span><span style="color:#c3c8d4">›</span></button>' +
      '</div></div>';
    sheet(html);

    $('mSheet').addEventListener('click', function (event) {
      var button = event.target.closest ? event.target.closest('[data-act]') : null;
      if (!button) return;
      var action = button.dataset.act;
      if (action === 'codes') {
        closeSheet();
        state.page = 'codes';
        state.codeStatus = 'all';
        state.codeQuery = batch.name;
        state.codeLimit = 60;
        render();
        return;
      }
      if (action === 'allocate') {
        var list = state.agents;
        sheet(sheetHead('整批分配', batch.name) + '<div class="m-sheet__body">' +
          (list.length
            ? '<div class="m-sheet__group">' + list.map(function (agent) {
                return '<button class="m-sheet__action" type="button" data-agent="' + agent.id + '">' +
                  '<span>' + esc(agent.displayName || agent.username) + '</span>' +
                  '<span style="flex:1"></span><span style="color:#9ca3af;font-size:12px">' +
                  (agent.level === 1 ? '一级' : '二级') + '</span></button>';
              }).join('') + '</div>'
            : emptyBox('还没有代理商')) + '</div>');
        $('mSheet').addEventListener('click', function (inner) {
          var target = inner.target.closest ? inner.target.closest('[data-agent]') : null;
          if (!target) return;
          api('/api/batches/' + batch.id + '/allocate', {
            method: 'POST', body: { agentId: Number(target.dataset.agent) }
          }).then(function (data) {
            toast(data.message || '已分配', 'ok');
            closeSheet();
            render();
          }).catch(function (error) { toast(error.message, 'err'); });
        });
        return;
      }
      if (action === 'delete') {
        if (!window.confirm('删除批次会连同这批激活码一起删掉，确定？')) return;
        api('/api/batches/' + batch.id, { method: 'DELETE' }).then(function (data) {
          toast(data.message || '已删除', 'ok');
          closeSheet();
          render();
        }).catch(function (error) { toast(error.message, 'err'); });
      }
    });
  }

  function openNewBatchSheet() {
    if (!state.agents.length) {
      api('/api/agents').then(function (data) {
        state.agents = (data.data || []).filter(function (a) { return a.role === 'agent'; });
      }).catch(function () { });
    }
    var html = sheetHead('新建批次', '一次生成一批激活码') +
      '<div class="m-sheet__body">' +
      '<div class="m-field"><label>批次名称</label><input id="mBatchName" type="text" placeholder="例如：9 月新客户"></div>' +
      '<div class="m-field__row">' +
      '<div class="m-field"><label>数量</label><input id="mBatchQty" type="number" inputmode="numeric" value="10" min="1" max="5000"></div>' +
      '<div class="m-field"><label>有效期（天）</label><input id="mBatchDays" type="number" inputmode="numeric" value="365" min="1" max="3650"></div>' +
      '</div>' +
      '<div class="m-field"><label>每码可绑设备数</label><input id="mBatchDevices" type="number" inputmode="numeric" value="1" min="1" max="50"></div>' +
      '<div class="m-field"><label>备注</label><textarea id="mBatchNote" placeholder="可留空"></textarea></div>' +
      '<div class="m-field"><label>计时方式</label><select id="mBatchStart">' +
      '<option value="0">生成时开始计时</option><option value="1">首次激活时开始计时</option>' +
      '</select></div>' +
      '<div class="m-note">生成后可以在「批次」里整批分配给某个代理商。</div>' +
      '</div><div class="m-sheet__foot">' +
      '<button class="m-btn" type="button" data-m-close>取消</button>' +
      '<button class="m-btn m-btn--primary" type="button" id="mBatchSubmit">生成</button></div>';
    sheet(html);

    $('mBatchSubmit').addEventListener('click', function () {
      var button = $('mBatchSubmit');
      button.disabled = true;
      api('/api/batches', {
        method: 'POST',
        body: {
          name: $('mBatchName').value.trim(),
          quantity: Number($('mBatchQty').value || 0),
          days: Number($('mBatchDays').value || 365),
          maxDevices: Number($('mBatchDevices').value || 1),
          note: $('mBatchNote').value.trim(),
          startOnActivation: $('mBatchStart').value === '1'
        }
      }).then(function (data) {
        toast(data.message || '批次已生成', 'ok');
        closeSheet();
        render();
      }).catch(function (error) {
        toast(error.message, 'err');
        button.disabled = false;
      });
    });
  }

  // ---------------------------------------------------------------- 代理商
  function openAgentSheet(agent) {
    var canManage = isMaster() || (state.user && state.user.level === 1 &&
      (agent.id === state.user.id || agent.parentId === state.user.id));
    var html = sheetHead(agent.displayName || agent.username, '@' + agent.username) +
      '<div class="m-sheet__body">' +
      '<div class="m-sheet__group"><dl class="m-kv">' +
      kvRow('身份', agent.level === 1 ? '一级代理商' : '二级代理商') +
      kvRow('状态', agent.status === 'disabled' ? '已停用' : '正常') +
      kvRow('激活码', agent.codeCount + ' 个（可用 ' + agent.activeCodes + '）') +
      kvRow('手机', agent.phone) +
      kvRow('创建时间', fmtTime(agent.createdAt)) +
      kvRow('上次登录', fmtTime(agent.lastLogin)) +
      (agent.note ? kvRow('备注', agent.note) : '') +
      '</dl></div>' +
      (canManage ? '<div class="m-sheet__group">' +
        '<button class="m-sheet__action m-sheet__action--primary" type="button" data-act="password">重置密码' +
        '<span style="flex:1"></span><span style="color:#c3c8d4">›</span></button>' +
        '<button class="m-sheet__action" type="button" data-act="status">' +
        (agent.status === 'disabled' ? '启用账号' : '停用账号') +
        '<span style="flex:1"></span><span style="color:#c3c8d4">›</span></button>' +
        '<button class="m-sheet__action m-sheet__action--danger" type="button" data-act="delete">删除账号' +
        '<span style="flex:1"></span><span style="color:#c3c8d4">›</span></button>' +
        '</div>' : '') + '</div>';
    sheet(html);

    $('mSheet').addEventListener('click', function (event) {
      var button = event.target.closest ? event.target.closest('[data-act]') : null;
      if (!button) return;
      var action = button.dataset.act;
      if (action === 'password') {
        var value = window.prompt('给「' + (agent.displayName || agent.username) + '」设置新密码（至少 6 位）');
        if (!value) return;
        api('/api/agents/' + agent.id + '/password', { method: 'POST', body: { password: value } })
          .then(function (data) { toast(data.message || '密码已重置', 'ok'); })
          .catch(function (error) { toast(error.message, 'err'); });
      }
      if (action === 'status') {
        var next = agent.status === 'disabled' ? 'active' : 'disabled';
        api('/api/agents/' + agent.id, { method: 'PATCH', body: { status: next } })
          .then(function (data) {
            toast(data.message || '已更新', 'ok');
            closeSheet();
            render();
          }).catch(function (error) { toast(error.message, 'err'); });
      }
      if (action === 'delete') {
        if (!window.confirm('确定删除代理账号「' + agent.username + '」？')) return;
        api('/api/agents/' + agent.id, { method: 'DELETE' }).then(function (data) {
          toast(data.message || '已删除', 'ok');
          closeSheet();
          render();
        }).catch(function (error) { toast(error.message, 'err'); });
      }
    });
  }

  function openNewAgentSheet() {
    var html = sheetHead('新建代理商', isMaster() ? '创建一级代理商' : '创建二级代理商') +
      '<div class="m-sheet__body">' +
      '<div class="m-field"><label>登录账号</label><input id="mAgentUser" type="text" ' +
      'autocapitalize="off" autocorrect="off" placeholder="字母数字，3-32 位"></div>' +
      '<div class="m-field"><label>登录密码</label><input id="mAgentPass" type="text" placeholder="至少 6 位"></div>' +
      '<div class="m-field"><label>显示名称</label><input id="mAgentName" type="text" placeholder="例如：华东-张三"></div>' +
      '<div class="m-field"><label>手机号</label><input id="mAgentPhone" type="tel" placeholder="可留空"></div>' +
      '<div class="m-field"><label>备注</label><textarea id="mAgentNote" placeholder="可留空"></textarea></div>' +
      '<div class="m-note">代理商登录同一个后台，只能看到自己名下的激活码和下级账号。</div>' +
      '</div><div class="m-sheet__foot">' +
      '<button class="m-btn" type="button" data-m-close>取消</button>' +
      '<button class="m-btn m-btn--primary" type="button" id="mAgentSubmit">创建</button></div>';
    sheet(html);

    $('mAgentSubmit').addEventListener('click', function () {
      var button = $('mAgentSubmit');
      button.disabled = true;
      api('/api/agents', {
        method: 'POST',
        body: {
          username: $('mAgentUser').value.trim(),
          password: $('mAgentPass').value,
          displayName: $('mAgentName').value.trim(),
          phone: $('mAgentPhone').value.trim(),
          note: $('mAgentNote').value.trim()
        }
      }).then(function (data) {
        toast(data.message || '账号已创建', 'ok');
        closeSheet();
        render();
      }).catch(function (error) {
        toast(error.message, 'err');
        button.disabled = false;
      });
    });
  }

  // ------------------------------------------------------------ 我的 · 安全
  function openPasswordSheet() {
    sheet(sheetHead('修改密码', state.user ? state.user.username : '') +
      '<div class="m-sheet__body">' +
      '<div class="m-field"><label>原密码</label><input id="mOldPass" type="password" autocomplete="current-password"></div>' +
      '<div class="m-field"><label>新密码</label><input id="mNewPass" type="password" autocomplete="new-password" placeholder="至少 6 位"></div>' +
      '</div><div class="m-sheet__foot">' +
      '<button class="m-btn" type="button" data-m-close>取消</button>' +
      '<button class="m-btn m-btn--primary" type="button" id="mPassSubmit">保存</button></div>');

    $('mPassSubmit').addEventListener('click', function () {
      var button = $('mPassSubmit');
      button.disabled = true;
      api('/api/password', {
        method: 'POST',
        body: { oldPassword: $('mOldPass').value, newPassword: $('mNewPass').value }
      }).then(function (data) {
        toast(data.message || '密码已更新', 'ok');
        closeSheet();
      }).catch(function (error) {
        toast(error.message, 'err');
        button.disabled = false;
      });
    });
  }

  // ------------------------------------------------------ 我的 · 客户端升级
  function openUpdateSheet() {
    sheet(sheetHead('客户端升级', '发布新版本，客户端自动升级') +
      '<div class="m-sheet__body"><div class="m-loading">加载中…</div></div>');
    Promise.all([
      api('/api/settings/client-update'),
      api('/api/settings/client-update/clients').catch(function () { return { data: null }; })
    ]).then(function (result) {
      var update = result[0].data;
      var clients = result[1].data;
      state.update = update;
      state.updateClients = clients;
      sheet(sheetHead('客户端升级', update.enabled
        ? ('正在发布 v' + update.version)
        : (update.version ? ('已上传 v' + update.version + '，未发布') : '还没有更新包')) +
        '<div class="m-sheet__body">' +
        '<div class="m-sheet__group"><dl class="m-kv">' +
        kvRow('当前版本', update.version || '—') +
        kvRow('状态', update.enabled ? '已发布' : '未发布') +
        kvRow('强制更新', update.force ? '是' : '否') +
        kvRow('文件', update.fileName || '—') +
        kvRow('大小', update.size ? fmtSize(update.size) : '—') +
        kvRow('下载次数', update.downloads || 0) +
        kvRow('发布时间', update.publishedAt ? fmtTime(update.publishedAt) : '—') +
        (update.notes ? kvRow('说明', update.notes) : '') +
        '</dl></div>' +
        (clients ? '<div class="m-sheet__group"><dl class="m-kv">' +
          kvRow('客户端台数', String(clients.total || 0)) +
          kvRow('已是最新', String(clients.upToDate || 0)) +
          kvRow('待升级', String(clients.outdated || 0)) +
          kvRow('版本分布', Object.keys(clients.distribution || {}).map(function (key) {
            return key + ' ×' + clients.distribution[key];
          }).join('，') || '—') +
          '</dl></div>' : '') +
        '<div class="m-note">安卓 / iOS 的浏览器可以直接选择本地更新包上传；' +
        '包体积较大时建议连 Wi-Fi。</div>' +
        '<div class="m-field"><label>上传新版本号</label>' +
        '<input id="mUpVersion" type="text" inputmode="decimal" placeholder="例如 1.0.2" ' +
        'value="' + esc(update.version || '') + '"></div>' +
        '<div class="m-field"><label>更新包（zip）</label>' +
        '<input id="mUpFile" type="file" accept=".zip,application/zip"></div>' +
        '<button class="m-btn m-btn--block" type="button" data-act="upload" style="margin-bottom:12px">上传更新包</button>' +
        '<div id="mUpProgress" class="m-note" style="display:none"></div>' +
        '<div class="m-field"><label>发布说明</label>' +
        '<textarea id="mUpNotes" placeholder="这次更新改了什么">' + esc(update.notes || '') + '</textarea></div>' +
        '<div class="m-field"><label>强制更新</label><select id="mUpForce">' +
        '<option value="0"' + (update.force ? '' : ' selected') + '>否，客户可稍后更新</option>' +
        '<option value="1"' + (update.force ? ' selected' : '') + '>是，启动就升级</option>' +
        '</select></div>' +
        '</div>' +
        '<div class="m-sheet__foot">' +
        '<button class="m-btn" type="button" data-act="save">保存</button>' +
        (update.enabled
          ? '<button class="m-btn m-btn--danger" type="button" data-act="withdraw">撤回发布</button>'
          : '<button class="m-btn m-btn--primary" type="button" data-act="publish">立即发布</button>') +
        '</div>');

      $('mSheet').addEventListener('click', function (event) {
        var button = event.target.closest ? event.target.closest('[data-act]') : null;
        if (!button) return;
        var action = button.dataset.act;
        if (action === 'upload') {
          var file = $('mUpFile') && $('mUpFile').files && $('mUpFile').files[0];
          var version = ($('mUpVersion').value || '').trim();
          if (!/^\d+(\.\d+){0,3}$/.test(version)) { toast('版本号请填 1.2.3 这样的数字', 'err'); return; }
          if (!file) { toast('请先选择更新包（zip）', 'err'); return; }
          button.disabled = true;
          button.textContent = '上传中…';
          uploadPackage(file, version, button);
          return;
        }
        var body = {
          action: action === 'save' ? 'save' : action,
          notes: $('mUpNotes') ? $('mUpNotes').value.trim() : '',
          force: $('mUpForce') ? $('mUpForce').value === '1' : false
        };
        api('/api/settings/client-update', { method: 'POST', body: body }).then(function (data) {
          toast(data.message || '已保存', 'ok');
          openUpdateSheet();
        }).catch(function (error) { toast(error.message, 'err'); });
      });
    }).catch(function (error) {
      sheet(sheetHead('客户端升级') + '<div class="m-sheet__body">' + emptyBox(error.message) + '</div>');
    });
  }

  function uploadPackage(file, version, button) {
    var bar = $('mUpProgress');
    if (bar) { bar.style.display = 'block'; bar.textContent = '准备上传…'; }
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/settings/client-update/upload?version=' + encodeURIComponent(version));
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', 'application/zip');
    xhr.upload.onprogress = function (event) {
      if (!event.lengthComputable || !bar) return;
      var percent = Math.round(event.loaded / event.total * 100);
      bar.textContent = '上传中 ' + percent + '%（' + fmtSize(event.loaded) + ' / ' + fmtSize(event.total) + '）';
    };
    xhr.onload = function () {
      var payload = {};
      try { payload = JSON.parse(xhr.responseText); } catch (e) { payload = {}; }
      if (xhr.status === 401) {
        state.user = null;
        showLogin('登录已过期，请重新登录');
        return;
      }
      if (xhr.status >= 400 || payload.success === false) {
        toast(payload.message || '上传失败', 'err');
        if (button) { button.disabled = false; button.textContent = '上传更新包'; }
        return;
      }
      toast(payload.message || '上传完成，确认后点「立即发布」', 'ok');
      openUpdateSheet();
    };
    xhr.onerror = function () {
      toast('网络异常，上传失败', 'err');
      if (button) { button.disabled = false; button.textContent = '上传更新包'; }
    };
    xhr.send(file);
  }

  // ------------------------------------------------------ 我的 · 数据备份
  function openBackupSheet() {
    sheet(sheetHead('数据备份', '整库备份与搬迁恢复') +
      '<div class="m-sheet__body"><div class="m-loading">加载中…</div></div>');
    api('/api/backups').then(function (data) {
      renderBackupSheet(data.data);
    }).catch(function (error) {
      sheet(sheetHead('数据备份') + '<div class="m-sheet__body">' + emptyBox(error.message) + '</div>');
    });
  }

  function renderBackupSheet(data) {
    data = data || {};
    var items = data.items || [];
    var rows = items.length
      ? items.map(function (item) {
        return '<div class="m-section__body" style="padding:12px 14px;border-bottom:1px solid #eef0f5">' +
          '<div style="font-size:13px;word-break:break-all">' + esc(item.name) + '</div>' +
          '<div class="m-note" style="margin:4px 0 10px">' + esc(item.sizeText) + ' · ' + fmtTime(item.createdAt) + '</div>' +
          '<div class="m-row-actions">' +
          '<a class="m-btn m-btn--sm" href="' + esc(item.download) + '">下载</a>' +
          '<button class="m-btn m-btn--sm" type="button" data-bk-restore="' + esc(item.name) + '">恢复</button>' +
          '<button class="m-btn m-btn--sm m-btn--danger" type="button" data-bk-del="' + esc(item.name) + '">删除</button>' +
          '</div></div>';
      }).join('')
      : '<div class="m-section__body" style="padding:14px">' + emptyBox('还没有备份，点下面的「立即备份」生成一个') + '</div>';

    sheet(sheetHead('数据备份', '共 ' + (data.count || 0) + ' 个文件 · ' + (data.totalSizeText || '0 B')) +
      '<div class="m-sheet__body">' +
      '<div class="m-note">备份目录：' + esc(data.relativeDir || 'data/backups') +
      (data.writable === false ? '（<b>目录不可写，请给 data/backups 写权限</b>）' : '') +
      '<br>换服务器时：先在旧后台备份并下载，新服务器部署后访问 <b>/install.php</b>，' +
      '「安装方式」选「用备份文件恢复」上传即可，账号密码沿用原来的。</div>' +
      '<button class="m-btn m-btn--block m-btn--primary" type="button" data-bk-new style="margin-bottom:12px">立即备份</button>' +
      '</div>' +
      '<div class="m-section"><div class="m-section__head">备份文件</div>' + rows + '</div>' +
      '<div class="m-sheet__body">' +
      '<div class="m-note">点「下载」可以把 .sql 存到手机；点「恢复」会把备份导回当前数据库' +
      '（覆盖现有数据，系统会先自动另存一份当前数据，恢复后需要重新登录）。</div>' +
      '</div>');

    $('mSheet').addEventListener('click', function (event) {
      var target = event.target.closest ? event.target.closest('[data-bk-new],[data-bk-restore],[data-bk-del]') : null;
      if (!target) return;

      if (target.hasAttribute('data-bk-new')) {
        target.disabled = true;
        target.textContent = '备份中…';
        api('/api/backups', { method: 'POST', body: {} }).then(function (result) {
          toast(result.message, 'ok');
          renderBackupSheet(result.data && result.data.list ? result.data.list : data);
        }).catch(function (error) {
          toast(error.message, 'err');
          target.disabled = false;
          target.textContent = '立即备份';
        });
        return;
      }

      var restoreName = target.getAttribute('data-bk-restore');
      if (restoreName) {
        if (!window.confirm('把备份「' + restoreName + '」导回当前数据库？\n\n' +
          '当前数据会被覆盖（系统会先自动另存一份）。恢复后需要重新登录。')) return;
        target.disabled = true;
        target.textContent = '恢复中…';
        api('/api/backups/' + encodeURIComponent(restoreName) + '/restore', {
          method: 'POST',
          body: { confirm: 'RESTORE' }
        }).then(function (result) {
          toast(result.message, 'ok');
          renderBackupSheet(result.data.list);
        }).catch(function (error) {
          toast(error.message, 'err');
          target.disabled = false;
          target.textContent = '恢复';
        });
        return;
      }

      var delName = target.getAttribute('data-bk-del');
      if (delName) {
        if (!window.confirm('删除备份「' + delName + '」？删了就找不回来了。')) return;
        api('/api/backups/delete', { method: 'POST', body: { name: delName } })
          .then(function (result) { toast(result.message, 'ok'); renderBackupSheet(result.data); })
          .catch(function (error) { toast(error.message, 'err'); });
      }
    });
  }

  // ---------------------------------------------------------------- 启动
  function boot() {
    api('/api/me').then(function (data) {
      state.user = data.user || null;
      showApp();
    }).catch(function () {
      showLogin();
    });
  }

  boot();
})();
