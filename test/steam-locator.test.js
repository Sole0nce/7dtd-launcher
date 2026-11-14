'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const locator = require('../src/main/steam-locator');

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function vdfEscape(target) {
  return target.replace(/\\/g, '\\\\');
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '7dtd-launcher-test-'));
  const steamRoot = path.join(root, 'Steam');
  const library = path.join(root, 'SteamLibrary');
  const steamapps = path.join(library, 'steamapps');
  const gameDir = path.join(steamapps, 'common', '7 Days To Die');

  fs.mkdirSync(path.join(steamRoot, 'steamapps'), { recursive: true });
  fs.mkdirSync(gameDir, { recursive: true });
  write(path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'),
    '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"' + vdfEscape(steamRoot) + '"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"' + vdfEscape(library) + '"\n\t}\n}\n');
  write(path.join(steamapps, 'appmanifest_251570.acf'),
    '"AppState"\n{\n\t"appid"\t\t"251570"\n\t"name"\t\t"7 Days to Die"\n\t"StateFlags"\t\t"4"\n\t"installdir"\t\t"7 Days to Die"\n\t"buildid"\t\t"26309840"\n\t"LastUpdated"\t\t"1793993209"\n\t"LastPlayed"\t\t"1783530286"\n\t"SizeOnDisk"\t\t"21070974746"\n\t"UserConfig"\n\t{\n\t\t"language"\t\t"schinese"\n\t}\n}\n');
  write(path.join(gameDir, '7DaysToDie.exe'), 'stub');
  write(path.join(gameDir, '7DaysToDie_EAC.exe'), 'stub');

  return { root, steamRoot, library, steamapps, gameDir };
}

test('parseLibraryFolders 解析新格式并还原转义', function () {
  const text = '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\SteamLibrary"\n\t}\n}\n';
  assert.deepEqual(locator.parseLibraryFolders(text), ['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary']);
});

test('parseLibraryFolders 兼容旧格式并去重', function () {
  const text = '"libraryfolders"\n{\n\t"TimeNextStatsReport"\t\t"1"\n\t"ContentStatsID"\t\t"-1"\n\t"1"\t\t"D:\\\\SteamLibrary"\n\t"2"\t\t"E:\\\\SteamLibrary"\n}\n';
  const parsed = locator.parseLibraryFolders(text);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0], 'D:\\SteamLibrary');
  assert.equal(parsed[1], 'E:\\SteamLibrary');
});

test('parseAppManifest 读取关键字段', function () {
  const text = '"AppState"\n{\n\t"appid"\t\t"251570"\n\t"installdir"\t\t"7 Days to Die"\n\t"buildid"\t\t"26309840"\n\t"SizeOnDisk"\t\t"21070974746"\n\t"LastUpdated"\t\t"1793993209"\n\t"LastPlayed"\t\t"1783530286"\n}\n';
  const manifest = locator.parseAppManifest(text);
  assert.equal(manifest.appid, '251570');
  assert.equal(manifest.installDir, '7 Days to Die');
  assert.equal(manifest.buildId, '26309840');
  assert.equal(manifest.sizeOnDisk, 21070974746);
  assert.equal(manifest.lastPlayed, 1783530286);
});

test('inspectGameTarget 忽略目录名大小写差异', function (t) {
  const fixture = makeFixture();
  t.after(function () { fs.rmSync(fixture.root, { recursive: true, force: true }); });

  const hit = locator.inspectGameTarget(fixture.steamapps);
  assert.ok(hit);
  assert.equal(hit.gamePath.toLowerCase(), fixture.gameDir.toLowerCase());
  assert.ok(hit.executable.toLowerCase().endsWith('7daystodie.exe'));
  assert.equal(hit.manifest.buildId, '26309840');

  const fromExe = locator.inspectGameTarget(path.join(fixture.gameDir, '7DaysToDie.exe'));
  assert.ok(fromExe);
  assert.equal(fromExe.gamePath.toLowerCase(), fixture.gameDir.toLowerCase());
});

test('detectGame 从额外路径命中并标注来源', async function (t) {
  const fixture = makeFixture();
  t.after(function () { fs.rmSync(fixture.root, { recursive: true, force: true }); });

  const result = await locator.detectGame({
    extraPaths: [fixture.steamRoot],
    includeRegistry: false,
    includeDriveScan: false
  });
  assert.equal(result.found, true);
  assert.equal(result.source, 'manual');
  assert.equal(result.gamePath.toLowerCase(), fixture.gameDir.toLowerCase());
  assert.equal(result.manifest.buildId, '26309840');
});

test('detectGame 找不到时返回 found:false 而不是抛错', async function (t) {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), '7dtd-empty-'));
  t.after(function () { fs.rmSync(empty, { recursive: true, force: true }); });

  const result = await locator.detectGame({ extraPaths: [empty], includeRegistry: false, includeDriveScan: false });
  assert.equal(result.found, false);
  assert.equal(result.gamePath, null);
  assert.ok(Array.isArray(result.attempts));
});
