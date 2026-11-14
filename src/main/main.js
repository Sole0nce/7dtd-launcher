'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { detectGame, inspectGameTarget } = require('./steam-locator');
const { getGameInfo } = require('./game-info');
const { Settings } = require('./settings');
const { buildLaunchPlan } = require('./launcher');

const isDev = process.argv.includes('--dev');

// 某些开发环境会全局设置 ELECTRON_RUN_AS_NODE=1，此时 Electron 会退化成 Node，
// require('electron') 拿不到 app。给出明确提示，避免出现难以理解的 undefined 报错。
if (!app || typeof app.requestSingleInstanceLock !== 'function') {
  console.error('[7dtd-launcher] 当前进程没有 Electron API。请确认没有设置 ELECTRON_RUN_AS_NODE=1，再重新启动。');
  process.exit(1);
}

let mainWindow = null;
let settings = null;
let detected = null;
let detectPromise = null;
let runningChild = null;

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function createWindow() {
  // 按当前显示器工作区收敛窗口尺寸：高分屏缩放后 1180 逻辑像素可能超出屏幕
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1180, workArea.width - 60);
  const height = Math.min(780, workArea.height - 80);

  mainWindow = new BrowserWindow({
    width: width,
    height: height,
    minWidth: Math.min(980, width),
    minHeight: Math.min(660, height),
    frame: false,
    show: false,
    backgroundColor: '#0b0a09',
    title: '七日杀启动器',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', function () { mainWindow.show(); });
  mainWindow.on('closed', function () { mainWindow = null; });
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

/** 探测并返回「路径 + 周边信息」，结果缓存在 detected。 */
async function detectAndDescribe() {
  const result = await detectGame({
    savedPath: settings.get('gamePath'),
    onStep: function (text) { send('detect:progress', text); }
  });

  if (result.found) {
    settings.set({ gamePath: result.gamePath, lastCheck: Date.now(), autoDetect: result.source !== 'manual' });
    detected = Object.assign({}, result, {
      info: getGameInfo(result.gamePath, result.manifest)
    });
  } else {
    settings.set({ lastCheck: Date.now() });
    detected = Object.assign({}, result, { info: null });
  }
  return detected;
}

function ensureDetected(force) {
  if (!force && detected) return Promise.resolve(detected);
  if (!detectPromise) {
    detectPromise = detectAndDescribe().finally(function () { detectPromise = null; });
  }
  return detectPromise;
}

function applyManualPath(rawPath) {
  const hit = inspectGameTarget(rawPath);
  if (!hit) return null;
  settings.set({ gamePath: hit.gamePath, lastCheck: Date.now() });
  detected = Object.assign({}, hit, { info: getGameInfo(hit.gamePath, hit.manifest), source: 'manual' });
  return detected;
}

function sanitizeOpenKind(kind) {
  if (!detected || !detected.found) return null;
  if (kind === 'game') return detected.gamePath;
  if (kind === 'mods') return detected.info && detected.info.mods ? detected.info.mods.dir : null;
  if (kind === 'saves') {
    const roots = detected.info && detected.info.saves ? detected.info.saves.roots : [];
    return roots.length > 0 ? roots[0] : null;
  }
  if (kind === 'userdata') return app.getPath('userData');
  return null;
}

function registerIpc() {
  ipcMain.handle('meta', function () {
    return {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      settingsPath: settingsFile()
    };
  });

  ipcMain.handle('settings:get', function () { return settings.all(); });
  ipcMain.handle('settings:set', function (_event, patch) { return settings.set(patch); });

  ipcMain.handle('game:detect', async function () {
    try {
      const result = await ensureDetected(true);
      return { ok: true, result: result };
    } catch (error) {
      return { ok: false, error: String(error && error.message ? error.message : error) };
    }
  });

  ipcMain.handle('game:set-path', function (_event, rawPath) {
    try {
      const result = applyManualPath(String(rawPath || ''));
      if (!result) return { ok: false, error: '这个路径下没有找到 7DaysToDie.exe' };
      return { ok: true, result: result };
    } catch (error) {
      return { ok: false, error: String(error && error.message ? error.message : error) };
    }
  });

  ipcMain.handle('game:pick', async function () {
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: '选择《七日杀》游戏目录',
      properties: ['openDirectory', 'dontAddToRecent']
    });
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false, canceled: true };
    const result = applyManualPath(picked.filePaths[0]);
    if (!result) return { ok: false, error: '所选目录里没有 7DaysToDie.exe，请选到游戏根目录' };
    return { ok: true, result: result };
  });

  ipcMain.handle('game:launch', async function (_event, payload) {
    try {
      const state = await ensureDetected(false);
      if (!state.found) return { ok: false, error: '还没有定位到游戏，请先指定游戏目录' };
      if (runningChild) return { ok: false, error: '游戏已经在运行中' };

      const mode = (payload && payload.mode) || settings.get('launchMode');
      const extraArgs = payload && typeof payload.args === 'string' ? payload.args : settings.get('extraArgs');
      const plan = buildLaunchPlan({
        mode: mode,
        args: extraArgs,
        gameDir: state.gamePath,
        executable: state.info ? state.info.executable : state.executable,
        eacExecutable: state.info ? state.info.eacExecutable : state.eacExecutable
      });

      settings.set({ launchMode: mode, extraArgs: extraArgs, lastLaunch: Date.now() });

      if (plan.kind === 'steam') {
        await shell.openExternal(plan.url);
        return { ok: true, mode: 'steam', url: plan.url };
      }

      const child = spawn(plan.executable, plan.args, {
        cwd: plan.cwd,
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      });
      runningChild = child;

      child.once('error', function (error) {
        runningChild = null;
        send('game:error', { message: String(error && error.message ? error.message : error) });
      });
      child.once('exit', function (code, signal) {
        if (runningChild === child) runningChild = null;
        send('game:exited', { code: code, signal: signal });
      });
      child.unref();

      return { ok: true, mode: plan.mode, pid: child.pid, executable: plan.executable };
    } catch (error) {
      runningChild = null;
      return { ok: false, error: String(error && error.message ? error.message : error) };
    }
  });

  ipcMain.handle('shell:open', async function (_event, payload) {
    const kind = payload && payload.kind;
    const target = sanitizeOpenKind(kind);
    if (!target) return { ok: false, error: '没有可打开的目录' };
    const error = await shell.openPath(target);
    return error ? { ok: false, error: error } : { ok: true, target: target };
  });

  ipcMain.handle('window:action', function (_event, action) {
    if (!mainWindow) return { ok: false };
    if (action === 'minimize') mainWindow.minimize();
    else if (action === 'maximize') {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    } else if (action === 'close') mainWindow.close();
    return { ok: true, maximized: mainWindow.isMaximized() };
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', function () {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(function () {
    settings = new Settings(settingsFile());
    registerIpc();
    createWindow();

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
  });
}
