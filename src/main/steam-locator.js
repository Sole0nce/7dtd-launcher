'use strict';

/**
 * Steam 库与《七日杀》安装位置探测（纯 Node，不依赖 Electron，便于单测）。
 *
 * 探测顺序：
 *   1. 用户上次选择/手动指定的路径
 *   2. 注册表里的 Steam 安装目录（HKCU / HKLM 32 位视图 / 64 位视图）
 *   3. 各 Steam 库的 steamapps/libraryfolders.vdf
 *   4. 常见磁盘布局兜底扫描（SteamLibrary、Steam、Program Files ...）
 *
 * 游戏标识：AppID 251570，可执行文件 7DaysToDie.exe。
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const APP_ID = '251570';
const GAME_EXE = '7DaysToDie.exe';
const EAC_EXE = '7DaysToDie_EAC.exe';
const MANIFEST_NAME = 'appmanifest_' + APP_ID + '.acf';
const DEFAULT_INSTALL_DIR = '7 Days To Die';

const REGISTRY_KEYS = [
  { key: 'HKCU\\Software\\Valve\\Steam', value: 'SteamPath' },
  { key: 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', value: 'InstallPath' },
  { key: 'HKLM\\SOFTWARE\\Valve\\Steam', value: 'InstallPath' }
];

function isWindows() {
  return process.platform === 'win32';
}

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

/** 按名字忽略大小写地取子项完整路径（Windows 文件名大小写不可靠）。 */
function resolveChild(dir, name) {
  const wanted = String(name).toLowerCase();
  for (const entry of listDir(dir)) {
    if (entry.name.toLowerCase() === wanted) return path.join(dir, entry.name);
  }
  return null;
}

/** 按相对路径（可含多级、忽略大小写）解析到实际存在的绝对路径。 */
function resolveRelative(dir, relative) {
  let current = dir;
  const parts = String(relative).split(/[\\/]+/).filter(Boolean);
  for (const part of parts) {
    const next = resolveChild(current, part);
    if (!next) return null;
    current = next;
  }
  return current;
}

/** 还原 VDF 里的双反斜杠转义。 */
function decodeVdfString(value) {
  return value.replace(/\\\\/g, '\\').replace(/\\"/g, '"');
}

/**
 * 解析 steamapps/libraryfolders.vdf，兼容新旧两种格式：
 *   新："libraryfolders" { "0" { "path" "D:\\\\SteamLibrary" } }
 *   旧："libraryfolders" { "1" "D:\\\\SteamLibrary" }
 * 返回值不含 Steam 自身目录，由调用方决定是否加入。
 */
function parseLibraryFolders(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const found = [];
  const pathRe = /"path"\s+"([^"]+)"/gi;
  let match;
  while ((match = pathRe.exec(text))) found.push(decodeVdfString(match[1]));

  if (found.length === 0) {
    const legacyRe = /"(\d+)"\s+"([^"]+)"/g;
    while ((match = legacyRe.exec(text))) {
      if (match[1] === '0') continue;
      const value = decodeVdfString(match[2]);
      if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\')) found.push(value);
    }
  }

  const seen = new Set();
  return found.filter(function (item) {
    let key;
    try {
      key = path.resolve(item).toLowerCase();
    } catch {
      key = item.toLowerCase();
    }
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 解析 appmanifest_251570.acf 中的关键字段。 */
function parseAppManifest(text) {
  if (typeof text !== 'string') return null;
  function read(name) {
    const re = new RegExp('"' + name + '"\\s+"([^"]*)"', 'i');
    const match = re.exec(text);
    return match ? decodeVdfString(match[1]) : null;
  }
  const manifest = {
    appid: read('appid'),
    name: read('name'),
    installDir: read('installdir'),
    buildId: read('buildid'),
    stateFlags: read('StateFlags') === null ? null : Number(read('StateFlags')),
    sizeOnDisk: read('SizeOnDisk') === null ? null : Number(read('SizeOnDisk')),
    lastUpdated: read('LastUpdated') === null ? null : Number(read('LastUpdated')),
    lastPlayed: read('LastPlayed') === null ? null : Number(read('LastPlayed')),
    language: read('language'),
    betaKey: read('BetaKey')
  };
  if (!manifest.appid && !manifest.installDir) return null;
  return manifest;
}

/** 在 common 目录下扫描任意包含 7DaysToDie.exe 的文件夹。 */
function findGameDirInCommon(commonDir) {
  for (const entry of listDir(commonDir)) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(commonDir, entry.name);
    if (resolveChild(dir, GAME_EXE)) return dir;
  }
  return null;
}

/** 用指定游戏目录组装完整的探测结果。 */
function describe(gameDir, steamappsPath) {
  const exe = resolveChild(gameDir, GAME_EXE);
  if (!exe) return null;

  let steamapps = steamappsPath || null;
  if (!steamapps) {
    const common = path.dirname(gameDir);
    if (path.basename(common).toLowerCase() === 'common') {
      const candidate = path.dirname(common);
      if (path.basename(candidate).toLowerCase() === 'steamapps') steamapps = candidate;
    }
  }

  let manifestPath = null;
  let manifest = null;
  if (steamapps) {
    manifestPath = resolveChild(steamapps, MANIFEST_NAME);
    if (manifestPath) manifest = parseAppManifest(readText(manifestPath) || '');
  }

  return {
    found: true,
    gamePath: gameDir,
    executable: exe,
    eacExecutable: resolveChild(gameDir, EAC_EXE),
    steamappsPath: steamapps,
    libraryPath: steamapps ? path.dirname(steamapps) : null,
    manifestPath: manifestPath,
    manifest: manifest
  };
}

/** 从 steamapps 目录解析游戏安装。 */
function fromSteamapps(steamappsPath) {
  const acf = resolveChild(steamappsPath, MANIFEST_NAME);
  const manifest = acf ? parseAppManifest(readText(acf) || '') : null;
  const common = resolveChild(steamappsPath, 'common');
  if (!common) return null;

  let gameDir = null;
  const installDir = (manifest && manifest.installDir) || DEFAULT_INSTALL_DIR;
  gameDir = resolveRelative(common, installDir);
  if (!gameDir || !resolveChild(gameDir, GAME_EXE)) gameDir = findGameDirInCommon(common);
  if (!gameDir) return null;

  return describe(gameDir, steamappsPath);
}

/** 从任意路径推断游戏安装位置，失败返回 null。 */
function inspectGameTarget(target) {
  if (!target || typeof target !== 'string') return null;
  const cleaned = target.trim().replace(/^"+|"+$/g, '');
  if (!cleaned) return null;

  let absolute;
  try {
    absolute = path.resolve(cleaned);
  } catch {
    return null;
  }

  const stat = statSafe(absolute);
  if (!stat) return null;

  if (stat.isFile()) {
    const base = path.basename(absolute).toLowerCase();
    if (base === GAME_EXE.toLowerCase() || base === EAC_EXE.toLowerCase()) {
      return describe(path.dirname(absolute));
    }
    if (base.endsWith('.acf')) {
      const steamapps = path.dirname(absolute);
      const manifest = parseAppManifest(readText(absolute) || '');
      const common = resolveChild(steamapps, 'common');
      if (!common) return null;
      const installDir = (manifest && manifest.installDir) || DEFAULT_INSTALL_DIR;
      const resolved = resolveRelative(common, installDir) || findGameDirInCommon(common);
      return resolved ? describe(resolved, steamapps) : null;
    }
    if (base === 'steam.exe') return fromSteamapps(resolveChild(path.dirname(absolute), 'steamapps') || '');
    return null;
  }

  if (!stat.isDirectory()) return null;

  if (resolveChild(absolute, GAME_EXE)) return describe(absolute);

  const baseName = path.basename(absolute).toLowerCase();
  if (baseName === 'steamapps') return fromSteamapps(absolute);
  if (baseName === 'common') {
    const found = findGameDirInCommon(absolute);
    return found ? describe(found, path.dirname(absolute)) : null;
  }

  const childSteamapps = resolveChild(absolute, 'steamapps');
  if (childSteamapps) {
    const hit = fromSteamapps(childSteamapps);
    if (hit) return hit;

    // 传进来的可能是 Steam 根目录：顺着 libraryfolders.vdf 找到其它库
    for (const library of discoverLibraries(absolute)) {
      const librarySteamapps = resolveChild(library, 'steamapps');
      if (!librarySteamapps) continue;
      const libraryHit = fromSteamapps(librarySteamapps);
      if (libraryHit) return libraryHit;
    }
  }

  const childCommon = resolveChild(absolute, 'common');
  if (childCommon) {
    const found = findGameDirInCommon(childCommon);
    if (found) return describe(found);
  }

  const acf = resolveChild(absolute, MANIFEST_NAME);
  if (acf) {
    const manifest = parseAppManifest(readText(acf) || '');
    const steamapps = absolute;
    const found = findGameDirInCommon(resolveChild(steamapps, 'common') || '');
    if (found) return describe(found, steamapps);
    if (manifest && manifest.installDir) {
      const resolved = resolveRelative(path.join(steamapps, 'common'), manifest.installDir);
      if (resolved) return describe(resolved, steamapps);
    }
  }

  return null;
}

/** 注册表读取（仅 Windows，失败静默返回 null）。 */
function readRegistryValue(key, value) {
  return new Promise(function (resolve) {
    if (!isWindows()) return resolve(null);
    execFile('reg', ['query', key, '/v', value], { windowsHide: true, timeout: 5000 }, function (error, stdout) {
      if (error || !stdout) return resolve(null);
      const lines = String(stdout).split(/\r?\n/);
      for (const line of lines) {
        const match = line.match(/^\s*(\S+)\s+REG_[A-Z_]+\s+(.*?)\s*$/);
        if (match && match[1].toLowerCase() === value.toLowerCase()) return resolve(match[2]);
      }
      resolve(null);
    });
  });
}

/** 由 Steam 根目录得到它自己 + libraryfolders.vdf 里登记的所有库根目录。 */
function discoverLibraries(steamRoot) {
  const steamapps = resolveChild(steamRoot, 'steamapps');
  if (!steamapps) return [];
  const libraries = [steamRoot];
  const vdf = resolveChild(steamapps, 'libraryfolders.vdf');
  if (vdf) {
    for (const lib of parseLibraryFolders(readText(vdf) || '')) {
      if (!libraries.some(function (item) { return item.toLowerCase() === lib.toLowerCase(); })) libraries.push(lib);
    }
  }
  return libraries;
}

/** 常见磁盘布局（兜底扫描用）。 */
function defaultScanCandidates() {
  const relative = [
    'SteamLibrary\\steamapps',
    'Steam\\steamapps',
    'Games\\SteamLibrary\\steamapps',
    'Program Files (x86)\\Steam\\steamapps',
    'Program Files\\Steam\\steamapps'
  ];
  const out = [];
  for (let code = 67; code <= 90; code += 1) {
    const drive = String.fromCharCode(code) + ':';
    if (!statSafe(drive + '\\')) continue;
    for (const rel of relative) out.push(path.join(drive + '\\', rel));
  }
  return out;
}

/**
 * 主入口：探测《七日杀》安装位置。
 * options.savedPath    上次记录的路径（优先）
 * options.extraPaths   额外候选（手动指定）
 * options.includeRegistry  是否读注册表（默认仅 Windows）
 * options.includeDriveScan 是否兜底扫盘（默认 true）
 * options.onStep       进度回调 (text) => void
 */
async function detectGame(options) {
  const opts = options || {};
  const attempts = [];
  const log = typeof opts.onStep === 'function' ? opts.onStep : function () {};
  const includeRegistry = opts.includeRegistry === undefined ? isWindows() : Boolean(opts.includeRegistry);
  const includeDriveScan = opts.includeDriveScan === undefined ? true : Boolean(opts.includeDriveScan);

  const initial = [opts.savedPath].concat(opts.extraPaths || []).filter(Boolean);
  for (const target of initial) {
    const hit = inspectGameTarget(target);
    if (hit) return Object.assign(hit, { source: target === opts.savedPath ? 'saved' : 'manual', attempts: attempts });
    attempts.push({ path: String(target), reason: '路径无效或该处没有七日杀' });
  }

  const roots = [];
  if (includeRegistry) {
    for (const entry of REGISTRY_KEYS) {
      const value = await readRegistryValue(entry.key, entry.value);
      if (!value) {
        log('注册表未找到：' + entry.key);
        continue;
      }
      const cleaned = value.replace(/^"+|"+$/g, '').trim();
      if (!cleaned) continue;
      const root = path.resolve(cleaned);
      if (!roots.some(function (item) { return item.toLowerCase() === root.toLowerCase(); })) roots.push(root);
    }
  }

  const libraries = [];
  for (const root of roots) {
    const found = discoverLibraries(root);
    if (found.length === 0) attempts.push({ path: root, reason: '缺少 steamapps 目录' });
    for (const lib of found) {
      if (!libraries.some(function (item) { return item.toLowerCase() === lib.toLowerCase(); })) libraries.push(lib);
    }
  }

  for (const lib of libraries) {
    const hit = inspectGameTarget(lib);
    if (hit) return Object.assign(hit, { source: 'library', attempts: attempts });
    attempts.push({ path: lib, reason: '该库未安装七日杀' });
  }

  if (includeDriveScan) {
    log('正在扫描常见磁盘位置…');
    for (const candidate of defaultScanCandidates()) {
      if (!statSafe(candidate)) continue;
      const hit = inspectGameTarget(candidate);
      if (hit) return Object.assign(hit, { source: 'scan', attempts: attempts });
    }
  }

  return { found: false, gamePath: null, executable: null, eacExecutable: null, manifest: null, source: null, attempts: attempts };
}

module.exports = {
  APP_ID: APP_ID,
  GAME_EXE: GAME_EXE,
  EAC_EXE: EAC_EXE,
  MANIFEST_NAME: MANIFEST_NAME,
  DEFAULT_INSTALL_DIR: DEFAULT_INSTALL_DIR,
  decodeVdfString: decodeVdfString,
  parseLibraryFolders: parseLibraryFolders,
  parseAppManifest: parseAppManifest,
  resolveChild: resolveChild,
  resolveRelative: resolveRelative,
  inspectGameTarget: inspectGameTarget,
  discoverLibraries: discoverLibraries,
  detectGame: detectGame,
  defaultScanCandidates: defaultScanCandidates
};
