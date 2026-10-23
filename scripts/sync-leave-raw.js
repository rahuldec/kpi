#!/usr/bin/env node
// Reads api/leave-raw.js and patches the LEAVE_RAW constant in index.html.
// Run manually or automatically via the pre-commit hook.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const leaveRaw = require('../lib/leave-raw');
const htmlPath = path.join(root, 'index.html');

const serialized = JSON.stringify(leaveRaw);
const html = fs.readFileSync(htmlPath, 'utf8');
const updated = html.replace(
  /^(const LEAVE_RAW = )\{[^;]+\};/m,
  `$1${serialized};`
);

if (updated === html) {
  console.log('sync-leave-raw: index.html already up to date.');
} else {
  fs.writeFileSync(htmlPath, updated, 'utf8');
  console.log('sync-leave-raw: patched index.html LEAVE_RAW.');
}
