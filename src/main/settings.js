'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  gamePath: null,
  launchMode: 'steam',
  extraArgs: '',
  autoDetect: true,
  lastCheck: null,
  lastLaunch: null
};

class Settings {
  constructor(filePath) {
    this.file = filePath;
    this.data = Object.assign({}, DEFAULTS, this.read());
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  write() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  get(key) {
    return this.data[key];
  }

  all() {
    return Object.assign({}, this.data);
  }

  set(patch) {
    if (!patch || typeof patch !== 'object') return this.all();
    for (const key of Object.keys(patch)) {
      if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) this.data[key] = patch[key];
    }
    this.write();
    return this.all();
  }
}

module.exports = { Settings: Settings, DEFAULTS: DEFAULTS };
