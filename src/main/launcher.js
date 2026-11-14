'use strict';

/**
 * 启动计划：把界面上的选择翻译成「走 Steam」或「直接跑某个 exe」，
 * 真正的进程创建在主进程里执行，方便测试计划本身。
 */

const fs = require('node:fs');
const path = require('node:path');

const APP_ID = '251570';
const STEAM_RUN_URL = 'steam://rungameid/' + APP_ID;

const MODES = {
  steam: { id: 'steam', label: '通过 Steam 启动', executable: null },
  eac: { id: 'eac', label: '带反作弊直启（EAC）', executable: 'eac' },
  direct: { id: 'direct', label: '无反作弊直启', executable: 'exe' }
};

/** 命令行参数切分：支持双引号、单引号与多余空白。 */
function splitArgs(input) {
  if (!input || typeof input !== 'string') return [];
  const out = [];
  let current = '';
  let quote = null;

  for (const char of input) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        out.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) out.push(current);
  return out;
}

function exists(target) {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * 生成启动计划。
 * 返回 { kind: 'steam', url } 或 { kind: 'process', executable, args, cwd, mode }
 * 找不到可执行文件时抛错，由主进程转成界面提示。
 */
function buildLaunchPlan(options) {
  const opts = options || {};
  const mode = MODES[opts.mode] ? opts.mode : 'steam';
  const args = splitArgs(opts.args || '');

  if (mode === 'steam') {
    return { kind: 'steam', mode: mode, url: STEAM_RUN_URL, args: args };
  }

  const gameDir = opts.gameDir;
  if (!gameDir) throw new Error('尚未定位游戏目录');

  const executable = mode === 'eac' ? opts.eacExecutable : opts.executable;
  if (!executable) {
    throw new Error(mode === 'eac' ? '游戏目录里没有 7DaysToDie_EAC.exe，请改用其他启动方式' : '游戏目录里没有 7DaysToDie.exe');
  }
  if (!exists(executable)) throw new Error('可执行文件不存在：' + executable);

  return {
    kind: 'process',
    mode: mode,
    executable: executable,
    args: args,
    cwd: gameDir,
    displayName: path.basename(executable)
  };
}

module.exports = { APP_ID: APP_ID, STEAM_RUN_URL: STEAM_RUN_URL, MODES: MODES, splitArgs: splitArgs, buildLaunchPlan: buildLaunchPlan };
