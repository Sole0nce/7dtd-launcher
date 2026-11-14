'use strict';

/**
 * 读取游戏目录周边信息：Mod 列表、存档统计、可执行文件状态。
 * 纯 Node 实现，方便测试。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const GAME_EXE = '7DaysToDie.exe';
const EAC_EXE = '7DaysToDie_EAC.exe';
const LAUNCHER_EXE = '7dLauncher.exe';

function statSafe(target) {
  try {
    return fs.statSync(target);
  } catch {
    return null;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function resolveChild(dir, name) {
  const wanted = String(name).toLowerCase();
  for (const entry of listDir(dir)) {
    if (entry.name.toLowerCase() === wanted) return path.join(dir, entry.name);
  }
  return null;
}

/** 兼容两种 ModInfo 写法：<Name value="x" /> 与 <Name>x</Name>。 */
function xmlValue(xml, tag) {
  const attrRe = new RegExp('<' + tag + '\\s[^>]*value\\s*=\\s*"([^"]*)"', 'i');
  const attr = attrRe.exec(xml);
  if (attr) return attr[1].trim();
  const textRe = new RegExp('<' + tag + '[^>]*>([^<]*)</' + tag + '>', 'i');
  const text = textRe.exec(xml);
  return text ? text[1].trim() : null;
}

function parseModInfo(xml) {
  if (typeof xml !== 'string' || !xml) return null;
  return {
    name: xmlValue(xml, 'Name'),
    displayName: xmlValue(xml, 'DisplayName') || xmlValue(xml, 'Name'),
    version: xmlValue(xml, 'Version'),
    author: xmlValue(xml, 'Author'),
    description: xmlValue(xml, 'Description'),
    skipWithAntiCheat: /<SkipWithAntiCheat\s+value="true"/i.test(xml)
  };
}

/** 列出 Mods 目录里已安装的 Mod（文件夹）与压缩包。 */
function readMods(gameDir) {
  const modsDir = gameDir ? resolveChild(gameDir, 'Mods') : null;
  if (!modsDir) return { dir: null, installed: [], archives: [], modCount: 0 };

  const installed = [];
  const archives = [];
  for (const entry of listDir(modsDir)) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      const modPath = path.join(modsDir, entry.name);
      const infoFile = resolveChild(modPath, 'ModInfo.xml');
      installed.push({
        folder: entry.name,
        path: modPath,
        info: infoFile ? parseModInfo(readText(infoFile) || '') : null
      });
    } else if (/\.(zip|rar|7z)$/i.test(entry.name)) {
      archives.push(entry.name);
    }
  }
  installed.sort(function (a, b) { return a.folder.localeCompare(b.folder, 'zh-CN'); });

  return { dir: modsDir, installed: installed, archives: archives, modCount: installed.length };
}

function savesRoots() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return [
    path.join(appData, '7DaysToDie', 'Saves'),
    path.join(appData, '7DaysToDie', 'SavesLocal')
  ];
}

/** 有上限地统计目录体积（避免存档特别大时卡住界面）。 */
function walkStats(dir, limit) {
  const maxFiles = limit || 3000;
  let bytes = 0;
  let files = 0;
  let newest = 0;
  const stack = [dir];
  while (stack.length > 0 && files < maxFiles) {
    const current = stack.pop();
    for (const entry of listDir(current)) {
      const full = path.join(current, entry.name);
      const stat = statSafe(full);
      if (!stat) continue;
      if (stat.mtimeMs > newest) newest = stat.mtimeMs;
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        bytes += stat.size;
        files += 1;
        if (files >= maxFiles) break;
      }
    }
  }
  return { bytes: bytes, files: files, newest: newest };
}

/** 统计所有存档：按世界分组，附带总量、最新时间。 */
function readSaves() {
  const roots = savesRoots().filter(function (item) { return Boolean(statSafe(item)); });
  let count = 0;
  let bytes = 0;
  let newest = 0;
  const worlds = [];

  for (const root of roots) {
    for (const entry of listDir(root)) {
      if (!entry.isDirectory()) continue;
      const full = path.join(root, entry.name);
      const isSaveFolder = Boolean(resolveChild(full, 'main.ttw'));
      const saveDirs = [];

      if (isSaveFolder) {
        saveDirs.push({ name: entry.name, dir: full });
      } else {
        for (const child of listDir(full)) {
          if (!child.isDirectory()) continue;
          const childPath = path.join(full, child.name);
          if (resolveChild(childPath, 'main.ttw')) saveDirs.push({ name: child.name, dir: childPath });
        }
      }

      if (saveDirs.length === 0) continue;
      let worldNewest = 0;
      for (const save of saveDirs) {
        const stats = walkStats(save.dir);
        count += 1;
        bytes += stats.bytes;
        if (stats.newest > newest) newest = stats.newest;
        if (stats.newest > worldNewest) worldNewest = stats.newest;
      }
      worlds.push({ name: isSaveFolder ? entry.name : entry.name, saves: saveDirs.length, newest: worldNewest });
    }
  }

  worlds.sort(function (a, b) { return b.newest - a.newest; });
  return { roots: roots, count: count, bytes: bytes, newest: newest, worlds: worlds };
}

function getGameInfo(gameDir, manifest) {
  if (!gameDir) return null;
  const executable = resolveChild(gameDir, GAME_EXE);
  const eacExecutable = resolveChild(gameDir, EAC_EXE);
  const launcherExe = resolveChild(gameDir, LAUNCHER_EXE);
  const exeStat = executable ? statSafe(executable) : null;

  return {
    gameDir: gameDir,
    executable: executable,
    eacExecutable: eacExecutable,
    launcherExe: launcherExe,
    manifest: manifest || null,
    exeModified: exeStat ? exeStat.mtimeMs : null,
    mods: readMods(gameDir),
    saves: readSaves()
  };
}

module.exports = {
  parseModInfo: parseModInfo,
  xmlValue: xmlValue,
  readMods: readMods,
  readSaves: readSaves,
  savesRoots: savesRoots,
  getGameInfo: getGameInfo
};
