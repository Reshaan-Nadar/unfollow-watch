// Builds the Chrome and Firefox packages from the same source files.
//
//   node scripts/build.mjs
//
// Output in dist/ (Node 20.15+ and no other dependencies):
//   chrome/                                  unpacked, for "Load unpacked"
//   firefox/                                 unpacked, for about:debugging
//   unfollow-watch-<version>-chrome.zip      files inside an unfollow-watch-<version>-chrome/ folder
//   unfollow-watch-<version>-firefox.xpi     files at the root, as Firefox and addons.mozilla.org expect
//
// manifest.json in the repo is the Chrome manifest (Manifest V3), so the
// repo folder itself can be loaded in Chrome. Firefox gets a Manifest V2
// manifest: its V3 background scripts are stopped after ~30 s idle, which
// would cut long scans and "Unfollow all" short, while a V2 background page
// stays running.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const FILES = [
  'background.js', 'popup.html', 'popup.css', 'popup.js', 'import.js', 'README.md', 'LICENSE', 'data/names.txt',
  'icons/icon16.png', 'icons/icon32.png', 'icons/icon48.png', 'icons/icon128.png',
];
const GECKO_ID = 'unfollow-watch@reshaan-nadar';
const FIREFOX_MIN = '140.0';

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const { version } = manifest;

function firefoxManifest(m) {
  return {
    manifest_version: 2,
    name: m.name,
    version: m.version,
    description: m.description,
    // contextualIdentities: find an Instagram login inside a container (e.g. Facebook Container).
    permissions: [...m.permissions, 'contextualIdentities', ...m.host_permissions],
    background: { scripts: [m.background.service_worker], persistent: true },
    browser_action: m.action,
    icons: m.icons,
    browser_specific_settings: {
      gecko: {
        id: GECKO_ID,
        strict_min_version: FIREFOX_MIN,
        // Nothing is sent to the developer; requests go only to Instagram.
        data_collection_permissions: { required: ['none'] },
      },
    },
  };
}

// Minimal zip writer (deflate, UTF-8 names, no zip64; packages are tiny).
function zip(entries) {
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const packed = deflateRawSync(data, { level: 9 });
    const method = packed.length < data.length ? 8 : 0;
    const body = method ? packed : data;
    const fileName = Buffer.from(name, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    locals.push(local, fileName, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, fileName);

    offset += local.length + fileName.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function build(target, targetManifest, { archive, folder }) {
  const out = join(DIST, target);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const manifestText = `${JSON.stringify(targetManifest, null, 2)}\n`;
  writeFileSync(join(out, 'manifest.json'), manifestText);
  for (const f of FILES) cpSync(join(ROOT, f), join(out, f), { recursive: true });

  const prefix = folder ? `${folder}/` : '';
  const entries = [
    { name: `${prefix}manifest.json`, data: Buffer.from(manifestText) },
    ...FILES.map((f) => ({ name: prefix + f, data: readFileSync(join(ROOT, f)) })),
  ];
  writeFileSync(join(DIST, archive), zip(entries));
  console.log(`${target.padEnd(8)} dist/${target}/  dist/${archive}`);
}

mkdirSync(DIST, { recursive: true });
build('chrome', manifest, {
  archive: `unfollow-watch-${version}-chrome.zip`,
  folder: `unfollow-watch-${version}-chrome`,
});
build('firefox', firefoxManifest(manifest), {
  archive: `unfollow-watch-${version}-firefox.xpi`,
});
