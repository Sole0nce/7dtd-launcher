'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const info = require('../src/main/game-info');

test('parseModInfo 兼容属性写法与文本写法', function () {
  const attr = '<xml><ModInfo><DisplayName value="Example Mod" /><Version value="1.2.3" /><Author value="Tester" /></ModInfo></xml>';
  const parsedAttr = info.parseModInfo(attr);
  assert.equal(parsedAttr.displayName, 'Example Mod');
  assert.equal(parsedAttr.version, '1.2.3');
  assert.equal(parsedAttr.author, 'Tester');

  const text = '<xml><Name>Old Mod</Name><Version>0.9</Version></xml>';
  const parsedText = info.parseModInfo(text);
  assert.equal(parsedText.name, 'Old Mod');
  assert.equal(parsedText.displayName, 'Old Mod');
  assert.equal(parsedText.version, '0.9');
});

test('readMods 统计文件夹 Mod 与压缩包', function (t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '7dtd-mods-'));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });

  fs.mkdirSync(path.join(root, 'Mods', 'MyMod'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Mods', 'MyMod', 'ModInfo.xml'), '<xml><ModInfo><Name value="MyMod" /><DisplayName value="我的模组" /><Version value="2.0.1" /></ModInfo></xml>');
  fs.mkdirSync(path.join(root, 'Mods', 'NoInfo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Mods', 'packed.zip'), 'zip');

  const mods = info.readMods(root);
  assert.equal(mods.modCount, 2);
  assert.equal(mods.archives.length, 1);
  const myMod = mods.installed.find(function (item) { return item.folder === 'MyMod'; });
  assert.equal(myMod.info.displayName, '我的模组');
  assert.equal(myMod.info.version, '2.0.1');
  const noInfo = mods.installed.find(function (item) { return item.folder === 'NoInfo'; });
  assert.equal(noInfo.info, null);
});

test('getGameInfo 返回可执行文件与 Mod 信息', function (t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '7dtd-info-'));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });

  fs.mkdirSync(path.join(root, 'Mods'), { recursive: true });
  fs.writeFileSync(path.join(root, '7DaysToDie.exe'), 'stub');

  const result = info.getGameInfo(root, { buildId: '1' });
  assert.ok(result.executable);
  assert.equal(result.eacExecutable, null);
  assert.equal(result.mods.modCount, 0);
  assert.equal(result.manifest.buildId, '1');
});
