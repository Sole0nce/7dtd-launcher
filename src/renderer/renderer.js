'use strict';

const api = window.launcher;

const state = {
  result: null,
  settings: null,
  mode: 'steam',
  launching: false,
  toastTimer: null
};

function $(id) { return document.getElementById(id); }

function fmtBytes(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const shown = value >= 100 ? Math.round(value).toString() : value.toFixed(1);
  return shown + ' ' + units[index];
}

function pad(number) { return String(number).padStart(2, '0'); }

function fmtDate(ms) {
  if (!ms) return '—';
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '—';
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function fmtDateTime(ms) {
  if (!ms) return '—';
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '—';
  return fmtDate(ms) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function fmtEpoch(seconds) {
  if (!seconds) return '—';
  return fmtDate(seconds * 1000);
}

const SOURCE_LABEL = {
  saved: '上次记录',
  manual: '手动指定',
  library: 'Steam 库',
  registry: '注册表',
  scan: '磁盘扫描'
};

const LANG_LABEL = {
  schinese: '简体中文',
  tchinese: '繁体中文',
  english: '英语',
  japanese: '日语',
  koreana: '韩语',
  russian: '俄语',
  german: '德语',
  french: '法语',
  spanish: '西班牙语',
  portuguese: '葡萄牙语',
  polish: '波兰语',
  turkish: '土耳其语'
};

function toast(message, kind) {
  const node = $('toast');
  node.textContent = message;
  node.className = 'toast show' + (kind ? ' ' + kind : '');
  if (state.toastTimer) clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(function () {
    node.className = 'toast' + (kind ? ' ' + kind : '');
  }, 4200);
}

function setBadge(mode, text) {
  const badge = $('detect-badge');
  badge.className = 'badge' + (mode === 'ok' ? ' ok' : mode === 'fail' ? ' fail' : '');
  $('detect-text').textContent = text;
}

function setStatus(text) { $('status-text').textContent = text; }

function emptyNode(text) {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = text;
  return p;
}

function rowItem(className, name, tag, broken) {
  const row = document.createElement('div');
  row.className = className + (broken ? ' broken' : '');
  const nameNode = document.createElement('div');
  nameNode.className = 'name';
  nameNode.textContent = name;
  nameNode.title = name;
  const tagNode = document.createElement('span');
  tagNode.className = 'tag';
  tagNode.textContent = tag;
  row.appendChild(nameNode);
  row.appendChild(tagNode);
  return row;
}

function renderMods(mods) {
  const list = $('mod-list');
  list.textContent = '';
  $('mod-count').textContent = String(mods ? mods.modCount : 0);
  $('btn-open-mods').disabled = !(mods && mods.dir);

  if (!mods || !mods.dir) {
    list.appendChild(emptyNode('未找到 Mods 目录'));
    $('mod-archives').textContent = '';
    return;
  }
  if (mods.installed.length === 0) {
    list.appendChild(emptyNode('Mods 目录是空的'));
  } else {
    mods.installed.slice(0, 120).forEach(function (item) {
      const info = item.info;
      const name = info && info.displayName ? info.displayName : item.folder;
      const tag = info && info.version ? info.version : '无 ModInfo';
      list.appendChild(rowItem('mod-item', name, tag, !info));
    });
  }
  $('mod-archives').textContent = mods.archives.length > 0 ? '另有 ' + mods.archives.length + ' 个压缩包未解压' : '';
}

function renderSaves(saves) {
  const list = $('save-list');
  list.textContent = '';
  $('save-count').textContent = String(saves ? saves.count : 0);
  $('save-size').textContent = saves && saves.count > 0 ? fmtBytes(saves.bytes) : '';
  $('btn-open-saves').disabled = !(saves && saves.roots && saves.roots.length > 0);

  if (!saves || saves.count === 0) {
    list.appendChild(emptyNode('还没有存档，进游戏开一局吧'));
    return;
  }
  saves.worlds.slice(0, 40).forEach(function (world) {
    list.appendChild(rowItem('save-item', world.name, world.saves + ' 存档 · ' + fmtDate(world.newest), false));
  });
}

function setMode(mode, persist) {
  state.mode = mode;
  document.querySelectorAll('.mode').forEach(function (button) {
    const active = button.getAttribute('data-mode') === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', active ? 'true' : 'false');
  });
  if (persist !== false) api.settings.set({ launchMode: mode });
}

function renderResult(result) {
  state.result = result;
  const found = Boolean(result && result.found);
  const info = found ? result.info : null;
  const manifest = result && result.manifest ? result.manifest : null;

  setBadge(found ? 'ok' : 'fail', found ? '已找到' : '未找到');

  const pathNode = $('game-path');
  if (found) {
    pathNode.textContent = result.gamePath;
    pathNode.title = result.gamePath;
    pathNode.classList.remove('missing');
  } else {
    pathNode.textContent = '没有找到《七日杀》，请手动指定游戏目录';
    pathNode.title = '';
    pathNode.classList.add('missing');
  }

  $('meta-source').textContent = found ? (SOURCE_LABEL[result.source] || result.source || '—') : '—';
  $('meta-build').textContent = manifest && manifest.buildId ? manifest.buildId : '—';
  $('meta-size').textContent = manifest && manifest.sizeOnDisk ? fmtBytes(manifest.sizeOnDisk) : '—';
  $('meta-updated').textContent = manifest && manifest.lastUpdated ? fmtEpoch(manifest.lastUpdated) : '—';
  $('meta-lang').textContent = manifest && manifest.language ? (LANG_LABEL[manifest.language] || manifest.language) : '—';
  const lastPlayed = manifest && manifest.lastPlayed ? manifest.lastPlayed : (state.settings ? state.settings.lastLaunch : null);
  $('meta-played').textContent = manifest && manifest.lastPlayed ? fmtEpoch(manifest.lastPlayed) : (lastPlayed ? fmtDateTime(lastPlayed) : '—');

  $('btn-open-game').disabled = !found;
  $('btn-launch').disabled = !found;
  $('launch-state').textContent = found ? '就绪 · ' + (info && info.mods ? info.mods.modCount : 0) + ' 个 Mod' : '等待指定游戏目录';

  renderMods(info ? info.mods : null);
  renderSaves(info ? info.saves : null);

  if (found) {
    setStatus('已定位：' + result.gamePath);
  } else if (result && result.attempts && result.attempts.length > 0) {
    setStatus('未找到游戏，已检查 ' + result.attempts.length + ' 个位置');
  }
}

async function detect() {
  setBadge('scan', '检测中');
  $('btn-redetect').disabled = true;
  setStatus('正在读取 Steam 注册表与库配置…');
  try {
    const response = await api.game.detect();
    if (!response.ok) {
      setBadge('fail', '检测失败');
      toast(response.error || '检测失败', 'err');
      return;
    }
    renderResult(response.result);
  } catch (error) {
    setBadge('fail', '检测失败');
    toast('检测失败：' + error.message, 'err');
  } finally {
    $('btn-redetect').disabled = false;
  }
}

async function applyPath(target, fromPicker) {
  if (!fromPicker && !target) return;
  const response = fromPicker ? await api.game.pick() : await api.game.setPath(target);
  if (response.canceled) return;
  if (!response.ok) {
    toast(response.error || '路径无效', 'err');
    return;
  }
  renderResult(response.result);
  toast('已切换到：' + response.result.gamePath, 'ok');
}

function resetLaunchButton() {
  const button = $('btn-launch');
  button.classList.remove('busy');
  button.textContent = '启 动 游 戏';
  button.disabled = !(state.result && state.result.found);
  state.launching = false;
}

async function launch() {
  if (state.launching) return;
  if (!state.result || !state.result.found) {
    toast('请先指定游戏目录', 'err');
    return;
  }

  const button = $('btn-launch');
  const args = $('extra-args').value.trim();
  state.launching = true;
  button.disabled = true;
  button.classList.add('busy');
  button.textContent = '启 动 中…';
  $('launch-state').textContent = '正在启动…';

  try {
    const response = await api.game.launch({ mode: state.mode, args: args });
    if (!response.ok) {
      toast(response.error || '启动失败', 'err');
      $('launch-state').textContent = '启动失败';
      resetLaunchButton();
      return;
    }
    if (state.settings) state.settings.lastLaunch = Date.now();
    if (response.mode === 'steam') {
      toast('已交给 Steam 启动，稍等片刻游戏窗口就会出现', 'ok');
      $('launch-state').textContent = '已通过 Steam 启动';
    } else {
      const name = response.executable ? String(response.executable).split(/[\\/]/).pop() : '游戏';
      toast('已启动 ' + name + (response.pid ? '（PID ' + response.pid + '）' : ''), 'ok');
      $('launch-state').textContent = '运行中 · ' + name;
    }
    setTimeout(resetLaunchButton, 2600);
  } catch (error) {
    toast('启动失败：' + error.message, 'err');
    resetLaunchButton();
  }
}

function bind() {
  $('win-min').addEventListener('click', function () { api.window.minimize(); });
  $('win-max').addEventListener('click', function () { api.window.maximize(); });
  $('win-close').addEventListener('click', function () { api.window.close(); });

  document.querySelector('.titlebar').addEventListener('dblclick', function (event) {
    if (event.target.closest('.win-controls')) return;
    api.window.maximize();
  });

  $('btn-redetect').addEventListener('click', detect);
  $('btn-pick').addEventListener('click', function () { applyPath(null, true); });
  $('btn-manual').addEventListener('click', function () { applyPath($('manual-path').value.trim(), false); });
  $('manual-path').addEventListener('keydown', function (event) {
    if (event.key === 'Enter') applyPath($('manual-path').value.trim(), false);
  });

  $('btn-open-game').addEventListener('click', function () { api.game.open('game'); });
  $('btn-open-mods').addEventListener('click', function () { api.game.open('mods'); });
  $('btn-open-saves').addEventListener('click', function () { api.game.open('saves'); });

  document.querySelectorAll('.mode').forEach(function (button) {
    button.addEventListener('click', function () { setMode(button.getAttribute('data-mode'), true); });
  });

  $('extra-args').addEventListener('change', function () {
    api.settings.set({ extraArgs: $('extra-args').value.trim() });
  });

  $('btn-launch').addEventListener('click', launch);

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) launch();
  });

  api.onDetectProgress(function (text) { setStatus(text); });
  api.onGameExited(function (payload) {
    $('launch-state').textContent = '已退出';
    resetLaunchButton();
    const code = payload && payload.code !== null && payload.code !== undefined ? '（退出码 ' + payload.code + '）' : '';
    toast('游戏已退出' + code, 'ok');
  });
  api.onGameError(function (payload) {
    toast(payload && payload.message ? payload.message : '启动进程出错', 'err');
    resetLaunchButton();
  });
}

(async function init() {
  try {
    const meta = await api.meta();
    $('app-version').textContent = 'v' + meta.version;
    $('status-right').textContent = 'Electron ' + meta.electron + ' · ' + meta.platform;
  } catch {
    /* 元信息拿不到不影响主流程 */
  }

  try {
    state.settings = await api.settings.get();
    setMode(state.settings.launchMode || 'steam', false);
    $('extra-args').value = state.settings.extraArgs || '';
  } catch {
    setMode('steam', false);
  }

  bind();
  await detect();
})();
