/* VideoMix 授权中心 —— 前端（原生 JS，无外部依赖） */
(function () {
  'use strict';

  var state = {
    user: null,
    agents: [],
    batches: [],
    codes: [],
    page: 'overview',
    codePage: 1,
    pageSize: 50,
    selection: new Set(),
    filters: { batchId: '', ownerId: '', status: '', q: '' }
  };

  var NAV = [
    { id: 'overview', title: '概览', icon: '◧', sub: '激活码、代理商与近期激活情况' },
    { id: 'codes', title: '激活码', icon: '▤', sub: '查询、分配、吊销与解绑设备' },
    { id: 'batches', title: '批次', icon: '❐', sub: '按批次生成与整批分配', master: true },
    { id: 'agents', title: '代理商', icon: '⛭', sub: '创建与管理一级 / 二级代理商' },
    { id: 'records', title: '激活记录', icon: '✓', sub: '客户设备指纹与激活时间' },
    { id: 'logs', title: '操作日志', icon: '☰', sub: '后台操作与激活流水', master: true },
    { id: 'update', title: '客户端升级', icon: '⇪', sub: '发布新版本，客户自动升级', master: true },
    { id: 'backup', title: '数据备份', icon: '⛁', sub: '整库备份、下载与搬迁恢复', master: true },
    { id: 'settings', title: '设置', icon: '⚙', sub: '修改密码与数据导出' }
  ];

  var STATE_TEXT = {
    unused: ['未使用', 'tag-gray'],
    active: ['部分绑定', 'tag-blue'],
    bound: ['已绑定满', 'tag-green'],
    expired: ['已过期', 'tag-amber'],
    revoked: ['已吊销', 'tag-rose']
  };

  // ---------------------------------------------------------------- 工具
  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtTime(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' +
      pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function fmtDay(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function daysLeft(value) {
    if (!value) return '未开始计时';
    var diff = new Date(value).getTime() - Date.now();
    if (isNaN(diff)) return '—';
    if (diff <= 0) return '已过期';
    return Math.floor(diff / 86400000) + ' 天';
  }

  function toast(message, kind) {
    var wrap = $('toasts');
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
    var done = function () { toast('已复制：' + text, 'ok'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else { fallback(); }
    function fallback() {
      var area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败，请手动选择', 'err'); }
      area.remove();
    }
  }

  function openModal(html, wide) {
    $('modal').className = 'modal' + (wide ? ' wide' : '');
    $('modal').innerHTML = html;
    $('modalMask').hidden = false;
  }

  function closeModal() {
    $('modalMask').hidden = true;
    $('modal').innerHTML = '';
  }

  document.addEventListener('click', function (event) {
    if (event.target === $('modalMask')) closeModal();
    var closer = event.target.closest ? event.target.closest('[data-close]') : null;
    if (closer) closeModal();
  });

  // ---------------------------------------------------------------- 登录
  function showLogin(message) {
    $('app').hidden = true;
    $('loginPage').hidden = false;
    if (message) $('loginHint').textContent = message;
    setTimeout(function () { $('loginUser').focus(); }, 50);
  }

  function showApp() {
    $('loginPage').hidden = true;
    $('app').hidden = false;
    $('sidebarUser').innerHTML = '<strong>' + esc(state.user.displayName || state.user.username) +
      '</strong><span>' + roleText(state.user) + '</span>';
    $('roleBadge').textContent = roleText(state.user);
    renderNav();
  }

  function roleText(user) {
    if (!user) return '';
    if (user.role === 'master') return '总账号';
    return user.level === 1 ? '一级代理商' : '二级代理商';
  }

  function renderNav() {
    var isMaster = state.user && state.user.role === 'master';
    $('nav').innerHTML = NAV.filter(function (item) {
      return !item.master || isMaster;
    }).map(function (item) {
      return '<button class="nav-item' + (state.page === item.id ? ' active' : '') +
        '" data-nav="' + item.id + '"><span class="nav-item__icon">' + item.icon + '</span>' +
        esc(item.title) + '</button>';
    }).join('');
  }

  $('loginForm').addEventListener('submit', function (event) {
    event.preventDefault();
    var button = $('loginSubmit');
    button.disabled = true;
    button.textContent = '登录中…';
    api('/api/login', {
      method: 'POST',
      body: { username: $('loginUser').value.trim(), password: $('loginPass').value }
    }).then(function (data) {
      state.user = data.user;
      $('loginPass').value = '';
      $('loginHint').textContent = '总账号与代理商账号使用同一个后台';
      showApp();
      navigate('overview');
      toast('欢迎回来，' + (state.user.displayName || state.user.username), 'ok');
    }).catch(function (error) {
      $('loginHint').textContent = error.message;
    }).finally(function () {
      button.disabled = false;
      button.textContent = '登录';
    });
  });

  $('logoutBtn').addEventListener('click', function () {
    api('/api/logout', { method: 'POST' }).catch(function () { }).finally(function () {
      state.user = null;
      showLogin('已退出登录');
    });
  });

  $('refreshBtn').addEventListener('click', function () { render(); });

  document.addEventListener('click', function (event) {
    var nav = event.target.closest ? event.target.closest('[data-nav]') : null;
    if (nav) navigate(nav.getAttribute('data-nav'));
  });

  function navigate(page) {
    state.page = page;
    state.selection.clear();
    state.codePage = 1;
    if (location.hash !== '#/' + page) location.hash = '#/' + page;
    renderNav();
    render();
  }

  window.addEventListener('hashchange', function () {
    var page = (location.hash || '').replace('#/', '') || 'overview';
    if (page !== state.page) { state.page = page; renderNav(); render(); }
  });

  // ---------------------------------------------------------------- 渲染
  function render() {
    var meta = NAV.filter(function (i) { return i.id === state.page; })[0] || NAV[0];
    $('pageTitle').textContent = meta.title;
    $('pageSub').textContent = meta.sub;
    var content = $('content');
    content.innerHTML = '<div class="loading">加载中…</div>';
    var jobs = {
      overview: renderOverview,
      codes: renderCodes,
      batches: renderBatches,
      agents: renderAgents,
      records: renderRecords,
      logs: renderLogs,
      update: renderUpdate,
      backup: renderBackup,
      settings: renderSettings
    };
    (jobs[state.page] || renderOverview)(content);
  }

  // ---- 概览 -----------------------------------------------------------
  function renderOverview(content) {
    api('/api/overview').then(function (data) {
      var d = data.data;
      var cards = [
        ['blue', '▤', d.totalCodes, '激活码总数'],
        ['green', '✓', d.boundCodes, '已激活使用'],
        ['amber', '◷', d.availableCodes, '可发放（未使用）'],
        ['rose', '✕', d.revokedCodes + d.expiredCodes, '已吊销 / 已过期']
      ];
      content.innerHTML =
        '<div class="stat-grid">' + cards.map(function (card) {
          return '<div class="stat stat--' + card[0] + '"><div class="stat__icon">' + card[1] +
            '</div><div><div class="stat__value">' + card[2] + '</div>' +
            '<div class="stat__label">' + card[3] + '</div></div></div>';
        }).join('') + '</div>' +
        '<div class="grid-2">' +
        '  <div class="panel"><div class="panel__head"><div><div class="panel__title">代理商</div>' +
        '  <div class="panel__desc">' + (d.scope === 'all' ? '全部代理商账号' : '你的下级账号') + '</div></div></div>' +
        '  <div class="stat-grid" style="grid-template-columns:repeat(3,1fr);margin:0">' +
        statMini('一级代理商', d.level1) + statMini('二级代理商', d.level2) + statMini('绑定设备数', d.devices) +
        '  </div></div>' +
        '  <div class="panel"><div class="panel__head"><div class="panel__title">最近激活</div></div>' +
        (d.recentActivations.length ? '<div class="table-wrap"><table class="vm"><thead><tr>' +
          '<th>激活码</th><th>设备指纹</th><th>激活时间</th></tr></thead><tbody>' +
          d.recentActivations.map(function (item) {
            return '<tr><td class="mono">' + esc((item.code_id || '')) + '</td><td class="mono">' +
              esc(String(item.device_id || '').slice(0, 18)) + '…</td><td>' + fmtTime(item.activated_at) +
              '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="empty">近 7 天还没有新的激活</div>') +
        '  </div>' +
        '</div>' +
        (state.user.role === 'master'
          ? '<div class="hint">你现在的身份是<b>总账号</b>：可以新建批次、创建一级代理商，并把整批或单个激活码分配给他们。' +
            '一级代理商自己登录后，可以继续创建二级代理商并把激活码往下分配。</div>'
          : '<div class="hint">你现在的身份是<b>' + roleText(state.user) + '</b>：' +
            (state.user.level === 1
              ? '可以创建二级代理商，并把名下（或总账号分配给你的）激活码分配给下级。'
              : '可以查看和管理自己名下的激活码，包括发给客户、吊销与解绑设备。') + '</div>');
    }).catch(function (error) { content.innerHTML = errorBox(error); });
  }

  function statMini(label, value) {
    return '<div class="stat stat--blue" style="padding:14px 16px"><div><div class="stat__value" ' +
      'style="font-size:20px">' + value + '</div><div class="stat__label">' + label + '</div></div></div>';
  }

  function errorBox(error) {
    return '<div class="panel"><div class="empty">加载失败：' + esc(error.message) + '</div></div>';
  }

  // ---- 激活码 ---------------------------------------------------------
  function loadBase() {
    return Promise.all([api('/api/agents'), api('/api/batches')]).then(function (result) {
      state.agents = result[0].data;
      state.batches = result[1].data;
    });
  }

  function renderCodes(content, keepScroll) {
    loadBase().then(function () {
      var query = '?q=' + encodeURIComponent(state.filters.q) +
        '&batchId=' + encodeURIComponent(state.filters.batchId) +
        '&ownerId=' + encodeURIComponent(state.filters.ownerId) +
        '&status=' + encodeURIComponent(state.filters.status);
      return api('/api/codes' + query);
    }).then(function (data) {
      state.codes = data.data;
      drawCodes(content);
    }).catch(function (error) { content.innerHTML = errorBox(error); });
  }

  function agentOptions(includeMaster, selected) {
    var options = includeMaster ? '<option value="master">总账号（收回）</option>' : '';
    var canAll = state.user.role === 'master';
    var pool = state.agents.filter(function (a) {
      if (a.role !== 'agent') return false;
      if (canAll) return true;
      return a.parentId === state.user.id && a.status === 'active';
    });
    options += pool.map(function (a) {
      return '<option value="' + a.id + '"' + (String(selected) === String(a.id) ? ' selected' : '') + '>' +
        esc(a.displayName || a.username) + '（' + (a.level === 1 ? '一级' : '二级') + ' · ' + esc(a.username) + '）</option>';
    }).join('');
    return options;
  }

  function drawCodes(content) {
    var rows = state.codes;
    var totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
    if (state.codePage > totalPages) state.codePage = totalPages;
    var start = (state.codePage - 1) * state.pageSize;
    var pageRows = rows.slice(start, start + state.pageSize);
    var canAllocate = state.user.role === 'master' || state.user.level === 1;

    content.innerHTML =
      '<div class="panel">' +
      '  <div class="toolbar">' +
      '    <input class="grow" id="fq" placeholder="搜索激活码 / 备注" value="' + esc(state.filters.q) + '">' +
      '    <select id="fbatch"><option value="">全部批次</option>' + state.batches.map(function (b) {
        return '<option value="' + b.id + '"' + (String(state.filters.batchId) === String(b.id) ? ' selected' : '') +
          '>' + esc(b.name) + '</option>';
      }).join('') + '</select>' +
      '    <select id="fowner"><option value="">全部归属</option><option value="master"' +
      (state.filters.ownerId === 'master' ? ' selected' : '') + '>总账号</option>' +
      state.agents.filter(function (a) { return a.role === 'agent'; }).map(function (a) {
        return '<option value="' + a.id + '"' + (String(state.filters.ownerId) === String(a.id) ? ' selected' : '') +
          '>归属：' + esc(a.displayName || a.username) + '</option>';
      }).join('') + '</select>' +
      '    <select id="fstatus"><option value="">全部状态</option>' + Object.keys(STATE_TEXT).map(function (key) {
        return '<option value="' + key + '"' + (state.filters.status === key ? ' selected' : '') + '>' +
          STATE_TEXT[key][0] + '</option>';
      }).join('') + '</select>' +
      '    <button class="btn btn-ghost btn-small" id="fclear">清空条件</button>' +
      (state.user.role === 'master'
        ? '<button class="btn btn-primary btn-small" id="newBatch2">新建批次</button>' : '') +
      '  </div>' +
      '  <div class="toolbar">' +
      '    <span class="tag tag-soft">共 ' + rows.length + ' 个 · 已选 ' + state.selection.size + '</span>' +
      (canAllocate
        ? '<button class="btn btn-small" id="allocateSel" ' + (state.selection.size ? '' : 'disabled') + '>分配给代理商</button>' : '') +
      '    <button class="btn btn-small" id="revokeSel" ' + (state.selection.size ? '' : 'disabled') + '>批量吊销</button>' +
      '    <button class="btn btn-small" id="restoreSel" ' + (state.selection.size ? '' : 'disabled') + '>批量恢复</button>' +
      '    <button class="btn btn-small btn-danger" id="deleteSel" ' + (state.selection.size ? '' : 'disabled') + '>批量删除</button>' +
      '  </div>' +
      '  <div class="table-wrap"><table class="vm"><thead><tr>' +
      '    <th style="width:34px"><input type="checkbox" id="checkAll"></th>' +
      '    <th>激活码</th><th>批次</th><th>归属</th><th>备注</th><th>到期时间</th><th>剩余</th>' +
      '    <th>设备</th><th>状态</th><th>操作</th>' +
      '  </tr></thead><tbody>' +
      (pageRows.length ? pageRows.map(function (item) {
        var st = STATE_TEXT[item.state] || ['未知', 'tag-gray'];
        return '<tr>' +
          '<td><input type="checkbox" data-pick="' + item.id + '"' +
          (state.selection.has(item.id) ? ' checked' : '') + '></td>' +
          '<td class="mono">' + esc(item.code) + '</td>' +
          '<td>' + esc(item.batchName) + '</td>' +
          '<td>' + esc(item.ownerName) + '</td>' +
          '<td class="wrap">' + esc(item.label || item.note || '—') + '</td>' +
          '<td title="' + esc(fmtTime(item.expiresAt)) + '">' +
          (item.expiresAt ? fmtDay(item.expiresAt) : '激活后 ' + item.days + ' 天') + '</td>' +
          '<td>' + daysLeft(item.expiresAt) + '</td>' +
          '<td>' + item.deviceCount + ' / ' + item.maxDevices + '</td>' +
          '<td><span class="tag ' + st[1] + '">' + st[0] + '</span></td>' +
          '<td><div class="row-actions">' +
          '<button class="btn btn-small" data-copy="' + esc(item.code) + '">复制</button>' +
          '<button class="btn btn-small" data-devices="' + item.id + '">设备</button>' +
          (item.revoked
            ? '<button class="btn btn-small" data-restore="' + item.id + '">恢复</button>'
            : '<button class="btn btn-small btn-danger" data-revoke="' + item.id + '">吊销</button>') +
          '<button class="btn btn-small btn-danger" data-delete="' + item.id + '">删除</button>' +
          '</div></td></tr>';
      }).join('') : '<tr><td colspan="10"><div class="empty">没有符合条件的激活码</div></td></tr>') +
      '</tbody></table></div>' +
      '  <div class="pager">第 ' + state.codePage + ' / ' + totalPages + ' 页' +
      '   <button class="btn btn-small" data-page="prev"' + (state.codePage <= 1 ? ' disabled' : '') + '>上一页</button>' +
      '   <button class="btn btn-small" data-page="next"' + (state.codePage >= totalPages ? ' disabled' : '') + '>下一页</button>' +
      '  </div>' +
      '</div>';

    $('fq').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { state.filters.q = this.value.trim(); state.codePage = 1; renderCodes(content); }
    });
    $('fbatch').addEventListener('change', function () { state.filters.batchId = this.value; state.codePage = 1; renderCodes(content); });
    $('fowner').addEventListener('change', function () { state.filters.ownerId = this.value; state.codePage = 1; renderCodes(content); });
    $('fstatus').addEventListener('change', function () { state.filters.status = this.value; state.codePage = 1; renderCodes(content); });
    $('fclear').addEventListener('click', function () {
      state.filters = { batchId: '', ownerId: '', status: '', q: '' };
      state.codePage = 1;
      renderCodes(content);
    });
    if ($('newBatch2')) $('newBatch2').addEventListener('click', function () { batchDialog(); });
    $('checkAll').addEventListener('change', function () {
      var checked = this.checked;
      pageRows.forEach(function (item) { if (checked) state.selection.add(item.id); else state.selection.delete(item.id); });
      drawCodes(content);
    });
    content.querySelectorAll('[data-page]').forEach(function (button) {
      button.addEventListener('click', function () {
        state.codePage += this.getAttribute('data-page') === 'next' ? 1 : -1;
        drawCodes(content);
      });
    });
    content.querySelectorAll('[data-pick]').forEach(function (box) {
      box.addEventListener('change', function () {
        var id = Number(this.getAttribute('data-pick'));
        if (this.checked) state.selection.add(id); else state.selection.delete(id);
        drawCodes(content);
      });
    });
    content.querySelectorAll('[data-copy]').forEach(function (button) {
      button.addEventListener('click', function () { copyText(this.getAttribute('data-copy')); });
    });
    content.querySelectorAll('[data-devices]').forEach(function (button) {
      button.addEventListener('click', function () { devicesDialog(Number(this.getAttribute('data-devices'))); });
    });
    content.querySelectorAll('[data-revoke]').forEach(function (button) {
      button.addEventListener('click', function () {
        var id = Number(this.getAttribute('data-revoke'));
        api('/api/codes/' + id + '/revoke', { method: 'POST' }).then(function (data) {
          toast(data.message, 'ok'); renderCodes(content);
        }).catch(function (error) { toast(error.message, 'err'); });
      });
    });
    content.querySelectorAll('[data-restore]').forEach(function (button) {
      button.addEventListener('click', function () {
        var id = Number(this.getAttribute('data-restore'));
        api('/api/codes/' + id + '/restore', { method: 'POST' }).then(function (data) {
          toast(data.message, 'ok'); renderCodes(content);
        }).catch(function (error) { toast(error.message, 'err'); });
      });
    });
    content.querySelectorAll('[data-delete]').forEach(function (button) {
      button.addEventListener('click', function () {
        var id = Number(this.getAttribute('data-delete'));
        if (!confirm('删除后无法恢复，确认删除这个激活码？')) return;
        api('/api/codes/' + id, { method: 'DELETE' }).then(function (data) {
          toast(data.message, 'ok'); renderCodes(content);
        }).catch(function (error) { toast(error.message, 'err'); });
      });
    });
    if ($('allocateSel')) {
      $('allocateSel').addEventListener('click', function () {
        allocateDialog(Array.from(state.selection), content);
      });
    }
    bindBulk(content, 'revokeSel', 'revoke', '吊销');
    bindBulk(content, 'restoreSel', 'restore', '恢复');
    bindBulk(content, 'deleteSel', 'delete', '删除');
  }

  function bindBulk(content, buttonId, action, label) {
    var button = $(buttonId);
    if (!button) return;
    button.addEventListener('click', function () {
      var ids = Array.from(state.selection);
      if (!ids.length) return;
      if (!confirm('确认' + label + '选中的 ' + ids.length + ' 个激活码？')) return;
      var chain = Promise.resolve();
      ids.forEach(function (id) {
        chain = chain.then(function () {
          if (action === 'delete') return api('/api/codes/' + id, { method: 'DELETE' });
          return api('/api/codes/' + id + '/' + action, { method: 'POST' });
        });
      });
      chain.then(function () {
        toast('已' + label + ' ' + ids.length + ' 个激活码', 'ok');
        state.selection.clear();
        renderCodes(content);
      }).catch(function (error) { toast(error.message, 'err'); });
    });
  }

  function allocateDialog(ids, content) {
    openModal(
      '<div class="modal__head"><div class="modal__title">分配激活码</div>' +
      '<button class="modal__close" data-close>×</button></div>' +
      '<div class="hint">已选择 <b>' + ids.length + '</b> 个激活码，选择要分配给哪个代理商。</div>' +
      '<div class="field"><label>目标代理商</label><select id="allocAgent">' + agentOptions(true, '') + '</select></div>' +
      '<div class="modal__foot"><button class="btn" data-close>取消</button>' +
      '<button class="btn btn-primary" id="allocOk">确认分配</button></div>'
    );
    $('allocOk').addEventListener('click', function () {
      var value = $('allocAgent').value;
      if (!value) { toast('请选择代理商', 'warn'); return; }
      var agentId = value === 'master' ? null : Number(value);
      api('/api/codes/allocate', { method: 'POST', body: { agentId: agentId, ids: ids } })
        .then(function (data) {
          toast(data.message, 'ok');
          closeModal();
          state.selection.clear();
          renderCodes(content);
        }).catch(function (error) { toast(error.message, 'err'); });
    });
  }

  function devicesDialog(codeId) {
    api('/api/codes/' + codeId + '/devices').then(function (data) {
      openModal(
        '<div class="modal__head"><div class="modal__title">绑定设备 · ' + esc(data.code.code) + '</div>' +
        '<button class="modal__close" data-close>×</button></div>' +
        '<p class="panel__desc" style="margin-bottom:12px">设备上限 ' + data.code.maxDevices +
        ' 台，已绑定 ' + data.data.length + ' 台。解绑后该设备下次校验会退回激活页。</p>' +
        (data.data.length
          ? '<div class="table-wrap"><table class="vm"><thead><tr><th>设备指纹</th><th>激活时间</th>' +
            '<th>最后校验</th><th>IP</th><th>操作</th></tr></thead><tbody>' +
            data.data.map(function (device) {
              return '<tr><td class="mono">' + esc(device.device_id) + '</td>' +
                '<td>' + fmtTime(device.activated_at) + '</td><td>' + fmtTime(device.last_seen_at) + '</td>' +
                '<td>' + esc(device.ip || '—') + '</td>' +
                '<td><button class="btn btn-small btn-danger" data-unbind="' + esc(device.device_id) +
                '">解绑</button></td></tr>';
            }).join('') + '</tbody></table></div>'
          : '<div class="empty">该激活码还没有绑定任何设备</div>') +
        '<div class="modal__foot"><button class="btn btn-primary" data-close>关闭</button></div>', true);
      $('modal').querySelectorAll('[data-unbind]').forEach(function (button) {
        button.addEventListener('click', function () {
          var deviceId = this.getAttribute('data-unbind');
          if (!confirm('确认解绑该设备？')) return;
          api('/api/codes/' + codeId + '/devices/' + encodeURIComponent(deviceId) + '/unbind', { method: 'POST' })
            .then(function (result) { toast(result.message, 'ok'); closeModal(); render(); })
            .catch(function (error) { toast(error.message, 'err'); });
        });
      });
    }).catch(function (error) { toast(error.message, 'err'); });
  }

  // ---- 批次 -----------------------------------------------------------
  function renderBatches(content) {
    loadBase().then(function () {
      content.innerHTML =
        '<div class="panel"><div class="panel__head"><div><div class="panel__title">批次列表</div>' +
        '<div class="panel__desc">一个批次可以整批分配给某个一级代理商，也可以在“激活码”里挑单个分配</div></div>' +
        '<div class="panel__actions"><button class="btn btn-primary btn-small" id="newBatch">新建批次</button></div></div>' +
        '<div class="table-wrap"><table class="vm"><thead><tr><th>批次</th><th>数量</th><th>有效期</th>' +
        '<th>设备上限</th><th>当前归属</th><th>已激活</th><th>已吊销</th><th>分配情况</th><th>创建时间</th><th>操作</th>' +
        '</tr></thead><tbody>' +
        (state.batches.length ? state.batches.map(function (batch) {
          var distribution = Object.keys(batch.distribution || {}).map(function (name) {
            return esc(name) + ' × ' + batch.distribution[name];
          }).join('、') || '—';
          return '<tr><td class="wrap"><b>' + esc(batch.name) + '</b>' +
            (batch.note ? '<div class="panel__desc">' + esc(batch.note) + '</div>' : '') + '</td>' +
            '<td>' + batch.total + '</td><td>' + batch.days + ' 天</td><td>' + batch.maxDevices + ' 台</td>' +
            '<td>' + esc(batch.ownerName) + '</td><td>' + batch.bound + '</td><td>' + batch.revoked + '</td>' +
            '<td class="wrap">' + distribution + '</td><td>' + fmtTime(batch.createdAt) + '</td>' +
            '<td><div class="row-actions">' +
            '<button class="btn btn-small" data-batch-alloc="' + batch.id + '">整批分配</button>' +
            '<button class="btn btn-small" data-batch-view="' + batch.id + '">查看激活码</button>' +
            '<button class="btn btn-small btn-danger" data-batch-del="' + batch.id + '">删除</button>' +
            '</div></td></tr>';
        }).join('') : '<tr><td colspan="10"><div class="empty">还没有批次，先点“新建批次”生成一批激活码</div></td></tr>') +
        '</tbody></table></div></div>';
      $('newBatch').addEventListener('click', function () { batchDialog(); });
      content.querySelectorAll('[data-batch-view]').forEach(function (button) {
        button.addEventListener('click', function () {
          state.filters = { batchId: this.getAttribute('data-batch-view'), ownerId: '', status: '', q: '' };
          navigate('codes');
        });
      });
      content.querySelectorAll('[data-batch-alloc]').forEach(function (button) {
        button.addEventListener('click', function () {
          var batchId = this.getAttribute('data-batch-alloc');
          openModal(
            '<div class="modal__head"><div class="modal__title">整批分配</div>' +
            '<button class="modal__close" data-close>×</button></div>' +
            '<div class="hint">整批分配会把该批次里<b>所有</b>激活码的归属改成所选代理商（含尚未使用的）。</div>' +
            '<div class="field"><label>目标代理商</label><select id="batchAgent">' + agentOptions(true, '') + '</select></div>' +
            '<div class="modal__foot"><button class="btn" data-close>取消</button>' +
            '<button class="btn btn-primary" id="batchAllocOk">确认</button></div>');
          $('batchAllocOk').addEventListener('click', function () {
            var value = $('batchAgent').value;
            api('/api/batches/' + batchId + '/allocate', {
              method: 'POST', body: { agentId: value === 'master' ? null : Number(value) }
            }).then(function (data) { toast(data.message, 'ok'); closeModal(); render(); })
              .catch(function (error) { toast(error.message, 'err'); });
          });
        });
      });
      content.querySelectorAll('[data-batch-del]').forEach(function (button) {
        button.addEventListener('click', function () {
          var batchId = this.getAttribute('data-batch-del');
          if (!confirm('删除批次会一并删除里面未被使用、未被吊销的激活码，确认继续？')) return;
          api('/api/batches/' + batchId, { method: 'DELETE' })
            .then(function (data) { toast(data.message, 'ok'); render(); })
            .catch(function (error) { toast(error.message, 'err'); });
        });
      });
    }).catch(function (error) { content.innerHTML = errorBox(error); });
  }

  function batchDialog() {
    openModal(
      '<div class="modal__head"><div class="modal__title">新建批次</div>' +
      '<button class="modal__close" data-close>×</button></div>' +
      '<div class="field"><label>批次名称</label><input id="bName" placeholder="例如：2026 春季 一级代理-张三"></div>' +
      '<div class="modal-row">' +
      '  <div class="field"><label>生成数量</label><input id="bQty" type="number" min="1" max="5000" value="100"></div>' +
      '  <div class="field"><label>有效期（天）</label><input id="bDays" type="number" min="1" max="3650" value="365"></div>' +
      '</div>' +
      '<div class="modal-row">' +
      '  <div class="field"><label>可绑定设备数</label><input id="bDevices" type="number" min="1" max="50" value="1"></div>' +
      '  <div class="field"><label>计时方式</label><select id="bStart"><option value="0">从生成之日起算</option>' +
      '    <option value="1">从首次激活起算</option></select></div>' +
      '</div>' +
      '<div class="field"><label>备注</label><input id="bNote" placeholder="可选，例如渠道名"></div>' +
      '<div class="modal__foot"><button class="btn" data-close>取消</button>' +
      '<button class="btn btn-primary" id="bOk">生成批次</button></div>');
    $('bOk').addEventListener('click', function () {
      var body = {
        name: $('bName').value.trim(),
        quantity: Number($('bQty').value || 0),
        days: Number($('bDays').value || 0),
        maxDevices: Number($('bDevices').value || 1),
        startOnActivation: $('bStart').value === '1',
        note: $('bNote').value.trim()
      };
      this.disabled = true;
      api('/api/batches', { method: 'POST', body: body }).then(function (data) {
        toast('已生成 ' + data.created + ' 个激活码', 'ok');
        closeModal();
        render();
      }).catch(function (error) { toast(error.message, 'err'); })
        .finally(function () { $('bOk').disabled = false; });
    });
  }

  // ---- 代理商 ---------------------------------------------------------
  function renderAgents(content) {
    loadBase().then(function () {
      var agents = state.agents;
      var byId = {};
      agents.forEach(function (a) { byId[a.id] = a; });
      var canCreate = state.user.role === 'master' || state.user.level === 1;
      content.innerHTML =
        '<div class="panel"><div class="panel__head">' +
        '<div><div class="panel__title">代理商账号</div><div class="panel__desc">' +
        (state.user.role === 'master'
          ? '总账号可以创建一级代理商；一级代理商登录后可以创建二级代理商'
          : (state.user.level === 1 ? '你可以创建二级代理商，并把激活码分配给他们' : '你只能查看自己名下激活码')) +
        '</div></div>' +
        '<div class="panel__actions">' +
        (canCreate ? '<button class="btn btn-primary btn-small" id="newAgent">' +
          (state.user.role === 'master' ? '新建一级代理商' : '新建二级代理商') + '</button>' : '') +
        '</div></div>' +
        '<div class="table-wrap"><table class="vm"><thead><tr><th>账号</th><th>名称</th><th>级别</th>' +
        '<th>上级</th><th>名下激活码</th><th>可用</th><th>状态</th><th>最后登录</th><th>操作</th></tr></thead><tbody>' +
        agents.map(function (agent) {
          var parent = agent.parentId ? (byId[agent.parentId] || {}) : null;
          var isSelf = agent.id === state.user.id;
          return '<tr><td class="mono">' + esc(agent.username) + (isSelf ? ' <span class="tag tag-soft">自己</span>' : '') + '</td>' +
            '<td>' + esc(agent.displayName || '—') + '</td>' +
            '<td>' + (agent.role === 'master' ? '<span class="tag tag-soft">总账号</span>' :
              '<span class="tag tag-gray">' + (agent.level === 1 ? '一级代理' : '二级代理') + '</span>') + '</td>' +
            '<td>' + (parent ? esc(parent.displayName || parent.username || '—') : '—') + '</td>' +
            '<td>' + agent.codeCount + '</td><td>' + agent.activeCodes + '</td>' +
            '<td>' + (agent.status === 'active'
              ? '<span class="tag tag-green">正常</span>'
              : '<span class="tag tag-rose">已停用</span>') + '</td>' +
            '<td>' + fmtTime(agent.lastLogin) + '</td>' +
            '<td><div class="row-actions">' +
            (agent.role === 'agent'
              ? '<button class="btn btn-small" data-edit="' + agent.id + '">编辑</button>' +
                '<button class="btn btn-small" data-pass="' + agent.id + '">重置密码</button>' +
                (agent.status === 'active'
                  ? '<button class="btn btn-small btn-danger" data-toggle="' + agent.id + '" data-status="disabled">停用</button>'
                  : '<button class="btn btn-small" data-toggle="' + agent.id + '" data-status="active">启用</button>') +
                '<button class="btn btn-small btn-danger" data-del="' + agent.id + '">删除</button>'
              : '') +
            '</div></td></tr>';
        }).join('') +
        '</tbody></table></div></div>';
      if ($('newAgent')) $('newAgent').addEventListener('click', function () { agentDialog(); });
      content.querySelectorAll('[data-edit]').forEach(function (button) {
        button.addEventListener('click', function () { agentDialog(Number(this.getAttribute('data-edit'))); });
      });
      content.querySelectorAll('[data-pass]').forEach(function (button) {
        button.addEventListener('click', function () { passwordDialog(Number(this.getAttribute('data-pass'))); });
      });
      content.querySelectorAll('[data-toggle]').forEach(function (button) {
        button.addEventListener('click', function () {
          var id = Number(this.getAttribute('data-toggle'));
          var status = this.getAttribute('data-status');
          api('/api/agents/' + id, { method: 'PATCH', body: { status: status } })
            .then(function () { toast('已' + (status === 'active' ? '启用' : '停用'), 'ok'); render(); })
            .catch(function (error) { toast(error.message, 'err'); });
        });
      });
      content.querySelectorAll('[data-del]').forEach(function (button) {
        button.addEventListener('click', function () {
          var id = Number(this.getAttribute('data-del'));
          if (!confirm('确认删除该代理商账号？')) return;
          api('/api/agents/' + id, { method: 'DELETE' })
            .then(function (data) { toast(data.message, 'ok'); render(); })
            .catch(function (error) { toast(error.message, 'err'); });
        });
      });
    }).catch(function (error) { content.innerHTML = errorBox(error); });
  }

  function agentDialog(agentId) {
    var editing = agentId ? state.agents.filter(function (a) { return a.id === agentId; })[0] : null;
    var title = editing ? '编辑代理商' : (state.user.role === 'master' ? '新建一级代理商' : '新建二级代理商');
    openModal(
      '<div class="modal__head"><div class="modal__title">' + title + '</div>' +
      '<button class="modal__close" data-close>×</button></div>' +
      (editing ? '' :
        '<div class="field"><label>登录账号</label><input id="aUser" placeholder="字母 / 数字，3-32 位"></div>' +
        '<div class="field"><label>登录密码</label><input id="aPass" type="text" placeholder="至少 6 位"></div>') +
      '<div class="field"><label>显示名称</label><input id="aName" value="' + esc(editing ? editing.displayName : '') +
      '" placeholder="例如：张三"></div>' +
      '<div class="field"><label>联系方式</label><input id="aPhone" value="' + esc(editing ? editing.phone : '') +
      '" placeholder="手机号 / 微信，可选"></div>' +
      '<div class="field"><label>备注</label><input id="aNote" value="' + esc(editing ? editing.note : '') + '"></div>' +
      '<div class="modal__foot"><button class="btn" data-close>取消</button>' +
      '<button class="btn btn-primary" id="aOk">保存</button></div>');
    $('aOk').addEventListener('click', function () {
      var body = {
        displayName: $('aName').value.trim(),
        phone: $('aPhone').value.trim(),
        note: $('aNote').value.trim()
      };
      var request;
      if (editing) {
        request = api('/api/agents/' + editing.id, { method: 'PATCH', body: body });
      } else {
        body.username = $('aUser').value.trim();
        body.password = $('aPass').value;
        request = api('/api/agents', { method: 'POST', body: body });
      }
      request.then(function (data) {
        toast(data.message || '已保存', 'ok');
        closeModal();
        render();
      }).catch(function (error) { toast(error.message, 'err'); });
    });
  }

  function passwordDialog(agentId) {
    openModal(
      '<div class="modal__head"><div class="modal__title">重置密码</div>' +
      '<button class="modal__close" data-close>×</button></div>' +
      '<div class="field"><label>新密码</label><input id="pNew" type="text" placeholder="至少 6 位"></div>' +
      '<div class="modal__foot"><button class="btn" data-close>取消</button>' +
      '<button class="btn btn-primary" id="pOk">确认重置</button></div>');
    $('pOk').addEventListener('click', function () {
      api('/api/agents/' + agentId + '/password', { method: 'POST', body: { password: $('pNew').value } })
        .then(function (data) { toast(data.message, 'ok'); closeModal(); })
        .catch(function (error) { toast(error.message, 'err'); });
    });
  }

  // ---- 激活记录 / 日志 / 设置 ------------------------------------------
  function renderRecords(content) {
    api('/api/records?limit=500').then(function (data) {
      content.innerHTML =
        '<div class="panel"><div class="panel__head"><div><div class="panel__title">设备激活记录</div>' +
        '<div class="panel__desc">客户机上报的设备指纹与激活时间（IP 是客户端的公网出口）</div></div>' +
        '<div class="panel__actions"><input id="rq" placeholder="搜索设备 / 激活码" style="height:36px;padding:0 12px;' +
        'border:1px solid var(--vm-border);border-radius:12px"></div></div>' +
        '<div class="table-wrap"><table class="vm" id="rtable"><thead><tr><th>激活码</th><th>归属</th>' +
        '<th>设备指纹</th><th>激活时间</th><th>最后校验</th><th>IP</th><th>操作</th></tr></thead><tbody>' +
        (data.data.length ? data.data.map(function (row) {
          return '<tr data-row="' + esc((row.code || '') + ' ' + row.deviceId + ' ' + row.ownerName) + '">' +
            '<td class="mono">' + esc(row.code || '—') + '</td><td>' + esc(row.ownerName) + '</td>' +
            '<td class="mono">' + esc(row.deviceId) + '</td><td>' + fmtTime(row.activatedAt) + '</td>' +
            '<td>' + fmtTime(row.lastSeenAt) + '</td><td>' + esc(row.ip || '—') + '</td>' +
            '<td><button class="btn btn-small" data-copy="' + esc(row.deviceId) + '">复制设备ID</button></td></tr>';
        }).join('') : '<tr><td colspan="7"><div class="empty">还没有激活记录</div></td></tr>') +
        '</tbody></table></div></div>';
      content.querySelectorAll('[data-copy]').forEach(function (button) {
        button.addEventListener('click', function () { copyText(this.getAttribute('data-copy')); });
      });
      $('rq').addEventListener('input', function () {
        var keyword = this.value.trim().toLowerCase();
        content.querySelectorAll('#rtable tbody tr').forEach(function (row) {
          var hay = (row.getAttribute('data-row') || '').toLowerCase();
          row.style.display = !keyword || hay.indexOf(keyword) >= 0 ? '' : 'none';
        });
      });
    }).catch(function (error) { content.innerHTML = errorBox(error); });
  }

  function renderLogs(content) {
    api('/api/logs?limit=300').then(function (data) {
      content.innerHTML =
        '<div class="panel"><div class="panel__head"><div class="panel__title">操作日志</div></div>' +
        '<div class="table-wrap"><table class="vm"><thead><tr><th>时间</th><th>账号</th><th>动作</th>' +
        '<th>详情</th><th>IP</th></tr></thead><tbody>' +
        (data.data.length ? data.data.map(function (row) {
          return '<tr><td>' + fmtTime(row.ts) + '</td><td>' + esc(row.actor_name) + '</td>' +
            '<td>' + esc(row.action) + '</td><td class="wrap">' + esc(row.detail) + '</td>' +
            '<td>' + esc(row.ip || '—') + '</td></tr>';
        }).join('') : '<tr><td colspan="5"><div class="empty">暂无日志</div></td></tr>') +
        '</tbody></table></div></div>';
    }).catch(function (error) { content.innerHTML = errorBox(error); });
  }

  function clientUrlPanel() {
    return '<div class="panel">' +
      '  <div class="panel__head"><div><div class="panel__title">客户端授权地址</div>' +
      '  <div class="panel__desc">安装包内置默认地址；改这里，已经装好的客户端会自动切换过来</div></div></div>' +
      '  <div class="field"><label>下发给客户端的地址</label>' +
      '  <input id="clientUrlInput" class="mono" placeholder="例如 http://1.2.3.4:8082 或 https://license.example.com"></div>' +
      '  <div class="row-actions" style="align-items:center">' +
      '    <button class="btn btn-primary" id="clientUrlSave">保存并下发</button>' +
      '    <button class="btn" id="clientUrlClear">清空</button>' +
      '    <span class="tag tag-soft" id="clientUrlState">读取中…</span>' +
      '  </div>' +
      '  <div class="hint" id="clientUrlStats" style="margin-top:14px">正在读取客户端取用情况…</div>' +
      '</div>';
  }

  function loadClientUrl() {
    api('/api/settings/client-url')
      .then(function (data) { fillClientUrl(data.data); })
      .catch(function (error) { toast(error.message, 'err'); });
  }

  function fillClientUrl(data) {
    if (!data) return;
    if ($('clientUrlInput')) $('clientUrlInput').value = data.serverUrl || '';
    var badge = $('clientUrlState');
    if (badge) {
      badge.textContent = data.serverUrl
        ? '已启用 · 第 ' + (data.version || 0) + ' 版 · 更新于 ' + fmtTime(data.updatedAt)
        : '未启用（客户端保持各自现有地址）';
    }
    var box = $('clientUrlStats');
    if (!box) return;
    var dist = data.distribution || {};
    var keys = Object.keys(dist);
    var lines = keys.map(function (key) {
      var isNew = key === data.serverUrl;
      return '<div style="display:flex;gap:8px;align-items:center;margin-top:6px">' +
        '<span class="tag ' + (isNew ? 'tag-green' : 'tag-amber') + '">' +
        (isNew ? '新地址' : '旧地址') + '</span>' +
        '<span class="mono">' + esc(key) + '</span><span>' + dist[key] + ' 台</span></div>';
    });
    box.innerHTML =
      '<div><b>已取过配置的机器：</b>' + (data.listeners || 0) + ' 台 · 累计下发 ' +
      (data.totalFetches || 0) + ' 次' + (data.lastFetchAt ? ' · 最近 ' + fmtTime(data.lastFetchAt) : '') + '</div>' +
      (lines.length ? lines.join('') : '<div style="margin-top:6px">还没有客户端来取过配置。</div>');
  }

  function signingPanel() {
    return '<div class="panel">' +
      '  <div class="panel__head"><div><div class="panel__title">授权签名密钥</div>' +
      '  <div class="panel__desc">客户端只认带着你这把私钥签名的授权结果；别人自己搭一个假服务器返回“激活成功”会被直接拒绝</div></div>' +
      '  <span class="tag tag-soft" id="signState">读取中…</span></div>' +
      '  <div class="field"><label>当前指纹（要和安装包里内置的公钥一致）</label>' +
      '  <input id="signKeyId" class="mono" readonly></div>' +
      '  <div class="field"><label>公钥（复制出来内置进安装包：work\\videomix-rebuild\\keys\\license-public.xml）</label>' +
      '  <textarea id="signPublic" class="mono" readonly style="height:96px"></textarea></div>' +
      '  <div class="row-actions" style="align-items:center">' +
      '    <button class="btn" id="signCopy">复制公钥</button>' +
      '    <span class="hint" id="signHint" style="margin:0">共用一个后台的总账号与代理商都能看到这个页面，但只有总账号能改。</span>' +
      '  </div>' +
      '  <div class="field" style="margin-top:18px"><label>授权票据有效期（天）</label>' +
      '  <input id="signTtl" type="number" min="1" max="3650" style="max-width:160px"></div>' +
      '  <div class="hint">票据是客户端离线时能坚持的最长时间；联网的客户端每 2 分钟会自动续期一次。</div>' +
      '  <div class="field" style="margin-top:18px"><label>换密钥（把另一台服务器导出的私钥贴进来，可整站迁移）</label>' +
      '  <textarea id="signPrivate" class="mono" placeholder="&lt;RSAKeyValue&gt;...&lt;/RSAKeyValue&gt;" style="height:96px"></textarea></div>' +
      '  <div class="row-actions">' +
      '    <button class="btn btn-primary" id="signSave">保存密钥与有效期</button>' +
      '  </div>' +
      '</div>';
  }

  function loadSigningKey() {
    api('/api/settings/signing-key')
      .then(function (data) { fillSigningKey(data.data); })
      .catch(function (error) { toast(error.message, 'err'); });
  }

  function fillSigningKey(data) {
    if (!data) return;
    if ($('signKeyId')) $('signKeyId').value = data.keyId || '';
    if ($('signPublic')) $('signPublic').value = data.publicKeyXml || '';
    if ($('signTtl')) $('signTtl').value = data.ttlDays || 30;
    if ($('signState')) {
      $('signState').textContent = data.keyId
        ? (data.autoGenerated ? '使用中（后台自动生成）' : '使用中')
        : '未配置';
    }
  }

  function renderSettings(content) {
    content.innerHTML =
      '<div class="grid-2">' +
      '  <div class="panel"><div class="panel__head"><div class="panel__title">修改密码</div></div>' +
      '    <div class="field"><label>原密码</label><input id="oldPass" type="password"></div>' +
      '    <div class="field"><label>新密码</label><input id="newPass" type="password" placeholder="至少 6 位"></div>' +
      '    <button class="btn btn-primary" id="passOk">保存新密码</button></div>' +
      '  <div class="panel"><div class="panel__head"><div class="panel__title">数据与部署</div></div>' +
      '    <dl class="kv">' +
      '      <dt>当前账号</dt><dd>' + esc(state.user.username) + '（' + roleText(state.user) + '）</dd>' +
      '      <dt>客户端接口</dt><dd class="mono">/rpc/authActivateCode · /rpc/judgeActivateCode</dd>' +
      '      <dt>客户端配置</dt><dd class="mono">/api/client-config</dd>' +
      '      <dt>数据目录</dt><dd>程序目录下的 data/updates（客户端更新包）与 data/backups（数据库备份）</dd>' +
      '    </dl>' +
      (state.user.role === 'master'
        ? '<div style="margin-top:16px"><button class="btn" id="exportBtn">导出全部数据（JSON）</button></div>' : '') +
      '  </div>' +
      '</div>' +
      (state.user.role === 'master' ? clientUrlPanel() : '') +
      (state.user.role === 'master' ? signingPanel() : '') +
      '<div class="panel"><div class="panel__head"><div class="panel__title">使用说明</div></div>' +
      '<div class="hint" style="margin:0">安装包里已经内置了默认授权地址，客户安装时不需要填写。要换服务器，就改上面的“客户端授权地址”：' +
      '客户端每次启动、以及运行中每隔几分钟会回来问一次，拿到新地址后自动切换并写进本机配置。' +
      '改完请让<b>旧地址继续在线一段时间</b>，等上面的“还在用旧地址”归零后再下线。' +
      '客户输入激活码后，客户端每 2 分钟回来校验一次；在这里点“吊销”或“解绑设备”，最长 2 分钟生效。</div></div>';

    if (state.user.role === 'master') {
      loadClientUrl();
      loadSigningKey();
      $('clientUrlSave').addEventListener('click', function () {
        var value = $('clientUrlInput').value.trim();
        api('/api/settings/client-url', { method: 'POST', body: { serverUrl: value } })
          .then(function (data) { toast(data.message, 'ok'); fillClientUrl(data.data); })
          .catch(function (error) { toast(error.message, 'err'); });
      });
      $('clientUrlClear').addEventListener('click', function () {
        if (!window.confirm('清空后客户端会保持当前地址不变，确定吗？')) return;
        api('/api/settings/client-url', { method: 'POST', body: { serverUrl: '' } })
          .then(function (data) { toast(data.message, 'ok'); fillClientUrl(data.data); })
          .catch(function (error) { toast(error.message, 'err'); });
      });
      $('signCopy').addEventListener('click', function () {
        copyText($('signPublic').value);
      });
      $('signSave').addEventListener('click', function () {
        var privateKey = $('signPrivate').value.trim();
        if (privateKey && !window.confirm('换密钥后，老安装包（内置旧公钥）将无法激活，确定继续吗？')) return;
        api('/api/settings/signing-key', {
          method: 'POST',
          body: { privateKeyXml: privateKey, ttlDays: $('signTtl').value }
        }).then(function (data) {
          toast(data.message, 'ok');
          $('signPrivate').value = '';
          fillSigningKey(data.data);
        }).catch(function (error) { toast(error.message, 'err'); });
      });
    }

    $('passOk').addEventListener('click', function () {
      api('/api/password', {
        method: 'POST',
        body: { oldPassword: $('oldPass').value, newPassword: $('newPass').value }
      }).then(function (data) { toast(data.message, 'ok'); $('oldPass').value = ''; $('newPass').value = ''; })
        .catch(function (error) { toast(error.message, 'err'); });
    });
    if ($('exportBtn')) {
      $('exportBtn').addEventListener('click', function () {
        api('/api/export').then(function (data) {
          var blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' });
          var link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = 'videomix-license-export.json';
          link.click();
          URL.revokeObjectURL(link.href);
        }).catch(function (error) { toast(error.message, 'err'); });
      });
    }
  }

  // ---- 客户端升级 -----------------------------------------------------
  function fmtSize(bytes) {
    var value = Number(bytes) || 0;
    if (value >= 1024 * 1024 * 1024) return (value / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    if (value >= 1024 * 1024) return (value / 1024 / 1024).toFixed(1) + ' MB';
    if (value >= 1024) return Math.round(value / 1024) + ' KB';
    return value + ' 字节';
  }

  // ---- 数据备份 -------------------------------------------------------
  function renderBackup(content) {
    content.innerHTML =
      '<div class="panel">' +
      '  <div class="panel__head"><div><div class="panel__title">数据库备份</div>' +
      '    <div class="panel__desc">把整个授权库（激活码、代理商账号、签名私钥、日志）导成一个 .sql 文件</div></div>' +
      '    <button class="btn btn-primary" id="bkNew">立即备份</button></div>' +
      '  <div class="hint" id="bkInfo" style="margin:0 0 14px">读取中…</div>' +
      '  <div id="bkList"><div class="loading">加载中…</div></div>' +
      '  <div class="hint" style="margin:14px 0 0">' +
      '换服务器就这样搬：在这里点「立即备份」→ 在列表里点「下载」存到本地 → 新服务器装好后访问 ' +
      '<span class="mono">你的域名/install.php</span>，「安装方式」选<b>用备份文件恢复</b>、' +
      '上传刚才那个 .sql → 用原来的账号密码登录。' +
      '</div>' +
      '</div>';

    $('bkNew').addEventListener('click', function () {
      var button = $('bkNew');
      button.disabled = true;
      button.textContent = '备份中…';
      api('/api/backups', { method: 'POST', body: {} }).then(function (data) {
        toast(data.message, 'ok');
        loadBackupList();
      }).catch(function (error) {
        toast(error.message, 'err');
      }).finally(function () {
        button.disabled = false;
        button.textContent = '立即备份';
      });
    });
    loadBackupList();
  }

  function loadBackupList() {
    var box = $('bkList');
    if (!box) return;
    api('/api/backups').then(function (data) {
      fillBackupList(data.data);
    }).catch(function (error) {
      box.innerHTML = errorBox(error);
      var info = $('bkInfo');
      if (info) info.textContent = error.message;
    });
  }

  function fillBackupList(data) {
    var box = $('bkList');
    if (!box || !data) return;
    var info = $('bkInfo');
    if (info) {
      info.innerHTML = '备份目录：<span class="mono">' + esc(data.relativeDir || 'data/backups') + '</span>' +
        ' · 共 <b>' + (data.count || 0) + '</b> 个文件，合计 ' + esc(data.totalSizeText || '0 B') +
        (data.writable === false ? ' · <b style="color:#b91c1c">目录不可写，请给 data/backups 写权限</b>' : '') +
        '<br>PHP 允许的上传上限：<span class="mono">' + esc(data.uploadMax || '未知') + '</span>' +
        '（不够大就在宝塔的 PHP 设置里调 post_max_size / upload_max_filesize）';
    }
    var items = data.items || [];
    if (!items.length) {
      box.innerHTML = '<div class="empty">还没有备份，点右上角「立即备份」生成第一个。</div>';
      return;
    }
    box.innerHTML = '<div class="table-wrap"><table class="vm"><thead><tr>' +
      '<th>备份文件</th><th>大小</th><th>生成时间</th><th style="width:250px">操作</th>' +
      '</tr></thead><tbody>' +
      items.map(function (item) {
        return '<tr><td class="mono">' + esc(item.name) + '</td>' +
          '<td>' + esc(item.sizeText) + '</td>' +
          '<td>' + fmtTime(item.createdAt) + '</td>' +
          '<td class="row-actions" style="margin:0">' +
          '<a class="btn" href="' + esc(item.download) + '">下载</a>' +
          '<button class="btn" data-restore="' + esc(item.name) + '">恢复</button>' +
          '<button class="btn btn-danger" data-del="' + esc(item.name) + '">删除</button>' +
          '</td></tr>';
      }).join('') + '</tbody></table></div>';

    box.onclick = function (event) {
      var restore = event.target.closest ? event.target.closest('[data-restore]') : null;
      if (restore) {
        var restoreName = restore.getAttribute('data-restore');
        if (!window.confirm('把备份「' + restoreName + '」导回当前数据库？\n\n' +
          '当前数据库里的数据会被覆盖成备份里的内容（系统会先自动另存一份当前数据）。\n' +
          '恢复后需要重新登录，确定吗？')) return;
        restore.disabled = true;
        var oldText = restore.textContent;
        restore.textContent = '恢复中…';
        api('/api/backups/' + encodeURIComponent(restoreName) + '/restore', {
          method: 'POST',
          body: { confirm: 'RESTORE' }
        }).then(function (data) {
          toast(data.message, 'ok');
          fillBackupList(data.data.list);
        }).catch(function (error) {
          toast(error.message, 'err');
        }).finally(function () {
          restore.disabled = false;
          restore.textContent = oldText;
        });
        return;
      }
      var del = event.target.closest ? event.target.closest('[data-del]') : null;
      if (del) {
        var delName = del.getAttribute('data-del');
        if (!window.confirm('删除备份「' + delName + '」？删了就找不回来了。')) return;
        api('/api/backups/delete', { method: 'POST', body: { name: delName } })
          .then(function (data) { toast(data.message, 'ok'); fillBackupList(data.data); })
          .catch(function (error) { toast(error.message, 'err'); });
      }
    };
  }

  function renderUpdate(content) {
    content.innerHTML =
      clientUpdatePanel() +
      '<div class="panel"><div class="panel__head"><div><div class="panel__title">客户版本分布</div>' +
      '  <div class="panel__desc">客户端每次启动、以及运行中每 30 分钟上报一次自己的版本号</div></div></div>' +
      '  <div id="upClients"><div class="loading">加载中…</div></div>' +
      '</div>' +
      '<div class="panel"><div class="panel__head"><div class="panel__title">怎么发新版本</div></div>' +
      '<div class="hint" style="margin:0">' +
      '1）在开发机上改完代码，重新打一个<b>新版本的安装包</b>，同时生成一个只含“变化文件”的 ' +
      '<span class="mono">update-client-版本号.zip</span>。<br>' +
      '2）在这个页面上传它、写一句更新说明、点“发布更新”。<br>' +
      '3）客户那边什么都不用做：客户端下次检查（最长 30 分钟）会自己下载，' +
      '<b>校验签名 + 校验 SHA256</b>，然后自动重启换成新版本，并在日志里记下结果。<br>' +
      '4）发布后盯着下面的版本分布，等“还没升级”归零就发完了。发现有问题可以立刻点“撤回”，' +
      '没升级的客户端就不会再升；已经升级的要发一个更高版本号才能纠正。<br>' +
      '<b>注意：</b>客户端连不上服务器时不会升级；只改界面的小修补可以用更新包，' +
      '改动很大或依赖变了就直接发新安装包让客户重装。</div></div>';
    loadClientUpdate();
    loadUpdateClients();
  }

  function clientUpdatePanel() {
    return '<div class="panel">' +
      '  <div class="panel__head"><div><div class="panel__title">客户端在线升级</div>' +
      '  <div class="panel__desc">上传新版本的更新包，发布后客户端下次联网检查会自动下载、验签、重启生效</div></div>' +
      '  <span class="tag tag-soft" id="upState">读取中…</span></div>' +
      '  <div class="modal-row">' +
      '    <div class="field"><label>新版本号（上传时写入，要比客户当前版本大）</label>' +
      '      <input id="upVersion" class="mono" placeholder="例如 1.1.3"></div>' +
      '    <div class="field"><label>更新包文件（update-client-版本号.zip）</label>' +
      '      <input id="upFile" type="file" accept=".zip,application/zip"></div>' +
      '  </div>' +
      '  <div class="field"><label>更新说明（客户端弹窗里会显示，可留空）</label>' +
      '    <textarea id="upNotes" placeholder="例如：新增批量导出；修复窗口尺寸记忆"></textarea></div>' +
      '  <div style="display:flex;align-items:center;gap:10px">' +
      '    <label class="tag tag-soft" style="cursor:pointer;padding:8px 14px;white-space:nowrap">' +
      '      <input id="upForce" type="checkbox" style="margin-right:8px">强制更新（不弹确认，直接升级）</label>' +
      '  </div>' +
      '  <div class="row-actions" style="align-items:center;margin-top:16px">' +
      '    <button class="btn btn-primary" id="upUpload">上传更新包</button>' +
      '    <button class="btn btn-primary" id="upPublish">发布更新</button>' +
      '    <button class="btn" id="upWithdraw">撤回</button>' +
      '    <button class="btn btn-danger" id="upRemove">删除更新包</button>' +
      '  </div>' +
      '  <progress id="upProgress" max="100" value="0" style="width:100%;height:8px;margin-top:16px"></progress>' +
      '  <div class="hint" id="upProgressText" style="margin:8px 0 0">等待上传</div>' +
      '  <div class="hint" id="upInfo" style="margin:8px 0 0"></div>' +
      '</div>';
  }

  function loadClientUpdate() {
    api('/api/settings/client-update')
      .then(function (data) { fillClientUpdate(data.data); })
      .catch(function (error) { toast(error.message, 'err'); });
    $('upUpload').addEventListener('click', onUploadUpdate);
    $('upPublish').addEventListener('click', function () {
      updateAction('publish', '发布后，客户端会在几分钟内自动升级到 v' + $('upVersion').value.trim() + '，确定吗？');
    });
    $('upWithdraw').addEventListener('click', function () {
      updateAction('withdraw', '撤回后，还没升级的客户端不会再收到这次更新。已升级的机器不受影响，确定吗？');
    });
    $('upRemove').addEventListener('click', function () {
      updateAction('remove', '删除更新包后需要重新上传才能发布，确定吗？');
    });
    $('upNotes').addEventListener('blur', function () { updateAction('save', ''); });
    $('upForce').addEventListener('change', function () { updateAction('save', ''); });
  }

  function fillClientUpdate(data) {
    if (!data) return;
    if ($('upVersion') && !$('upVersion').value && data.version) $('upVersion').value = data.version;
    if ($('upNotes') && document.activeElement !== $('upNotes')) $('upNotes').value = data.notes || '';
    if ($('upForce')) $('upForce').checked = !!data.force;

    var badge = $('upState');
    if (badge) {
      badge.textContent = data.enabled
        ? '已发布 v' + data.version + (data.force ? ' · 强制更新' : '')
        : (data.hasPackage ? '已上传 v' + data.version + '，未发布' : '还没有更新包');
      badge.className = 'tag ' + (data.enabled ? 'tag-green' : (data.hasPackage ? 'tag-amber' : 'tag-soft'));
    }

    var box = $('upInfo');
    if (box) {
      if (data.packageMissing) {
        box.innerHTML = '<b>当前更新包：</b>数据库里记着 ' + esc(data.fileName) +
          '，但服务器上找不到这个文件，请重新上传。';
      } else if (!data.hasPackage && !data.fileName) {
        box.innerHTML = '还没有上传更新包。先做出新版本的 update-client-版本号.zip，再点上面的“上传更新包”。';
      } else {
        box.innerHTML =
          '<b>当前更新包：</b>' + esc(data.fileName) + ' · ' + fmtSize(data.size) +
          '<br><b>SHA256：</b><span class="mono">' + esc(data.sha256 || '') + '</span>' +
          '<br><b>状态：</b>' + (data.enabled ? '已发布（客户端会自动升级）' : '未发布（客户端看不到）') +
          (data.publishedAt ? ' · 发布于 ' + fmtTime(data.publishedAt) : '') +
          (data.uploadedAt ? ' · 上传于 ' + fmtTime(data.uploadedAt) : '') +
          '<br><b>发布时的签名指纹：</b>' + esc(data.signingKeyId || '未配置') +
          ' · 被下载 ' + (data.downloads || 0) + ' 次';
      }
    }

    if ($('upPublish')) $('upPublish').disabled = !data.hasPackage;
    if ($('upWithdraw')) $('upWithdraw').disabled = !data.enabled;
    if ($('upRemove')) $('upRemove').disabled = !data.hasPackage && !data.fileName;
  }

  function onUploadUpdate() {
    var file = $('upFile').files && $('upFile').files[0];
    var version = $('upVersion').value.trim();
    if (!/^\d+(\.\d+){0,3}$/.test(version)) { toast('版本号请填 1.2.3 这样的数字', 'err'); return; }
    if (!file) { toast('请先选择更新包（zip）', 'err'); return; }
    var button = $('upUpload');
    button.disabled = true;
    button.textContent = '上传中…';
    if ($('upProgress')) $('upProgress').value = 0;
    uploadUpdatePackage(file, version).then(function (data) {
      toast(data.message || '上传完成', 'ok');
      fillClientUpdate(data.data);
      loadUpdateClients();
    }).catch(function (error) {
      toast(error.message, 'err');
    }).finally(function () {
      button.disabled = false;
      button.textContent = '上传更新包';
    });
  }

  function uploadUpdatePackage(file, version) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/settings/client-update/upload?version=' + encodeURIComponent(version));
      xhr.withCredentials = true;
      xhr.setRequestHeader('Content-Type', 'application/zip');
      xhr.upload.onprogress = function (event) {
        if (!event.lengthComputable) return;
        var percent = Math.round(event.loaded / event.total * 100);
        if ($('upProgress')) $('upProgress').value = percent;
        if ($('upProgressText')) {
          $('upProgressText').textContent = '上传中 ' + percent + '%（' + fmtSize(event.loaded) +
            ' / ' + fmtSize(event.total) + '）';
        }
      };
      xhr.onload = function () {
        var payload = {};
        try { payload = JSON.parse(xhr.responseText); } catch (e) { payload = {}; }
        if (xhr.status === 401) { state.user = null; showLogin(); reject(new Error('登录已过期，请重新登录')); return; }
        if (xhr.status < 200 || xhr.status >= 300 || payload.success === false) {
          reject(new Error(payload.message || ('上传失败 (' + xhr.status + ')')));
          return;
        }
        if ($('upProgressText')) $('upProgressText').textContent = '上传完成：' + file.name + '（' + fmtSize(file.size) + '）';
        resolve(payload);
      };
      xhr.onerror = function () {
        if ($('upProgressText')) $('upProgressText').textContent = '上传失败';
        reject(new Error('网络错误，上传失败'));
      };
      xhr.send(file);
    });
  }

  function updateAction(action, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    api('/api/settings/client-update', {
      method: 'POST',
      body: { action: action, notes: $('upNotes').value, force: $('upForce').checked }
    }).then(function (data) {
      if (action !== 'save') toast(data.message, 'ok');
      fillClientUpdate(data.data);
      loadUpdateClients();
    }).catch(function (error) { toast(error.message, 'err'); });
  }

  function loadUpdateClients() {
    api('/api/settings/client-update/clients')
      .then(function (data) { fillUpdateClients(data.data); })
      .catch(function (error) {
        var box = $('upClients');
        if (box) box.innerHTML = errorBox(error);
      });
  }

  function fillUpdateClients(data) {
    var box = $('upClients');
    if (!box || !data) return;
    var distribution = data.distribution || {};
    var lines = Object.keys(distribution).map(function (version) {
      var stale = data.latest && version !== data.latest;
      return '<div style="display:flex;gap:10px;align-items:center;margin-top:6px">' +
        '<span class="tag ' + (stale ? 'tag-amber' : 'tag-green') + '">' +
        (stale ? '旧版本' : '最新') + '</span><span class="mono">' + esc(version) + '</span>' +
        '<span>' + distribution[version] + ' 台</span></div>';
    });
    var rows = (data.clients || []).slice(0, 50).map(function (row) {
      return '<tr><td class="mono">' + esc(String(row.device || '').slice(0, 22)) + '…</td>' +
        '<td><span class="tag ' + (row.outdated ? 'tag-amber' : 'tag-green') + '">' + esc(row.version) + '</span></td>' +
        '<td>' + esc(row.ip || '—') + '</td><td>' + fmtTime(row.lastAt) + '</td></tr>';
    });
    box.innerHTML =
      '<div><b>已上报的客户端：</b>' + data.total + ' 台' +
      (data.latest ? ' · 后台最新版本 ' + esc(data.latest) + ' · 还没升级 ' + data.outdated + ' 台' : '') +
      '</div>' +
      (lines.length ? lines.join('') : '<div style="margin-top:6px">还没有客户端上报过版本号。</div>') +
      (rows.length
        ? '<div class="table-wrap" style="margin-top:16px"><table class="vm"><thead><tr><th>设备指纹</th>' +
          '<th>版本</th><th>IP</th><th>最近上报</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>'
        : '');
  }

  // ---------------------------------------------------------------- 启动
  api('/api/me').then(function (data) {
    state.user = data.user;
    showApp();
    var page = (location.hash || '').replace('#/', '') || 'overview';
    state.page = page;
    renderNav();
    render();
  }).catch(function () {
    showLogin();
  });
}());
