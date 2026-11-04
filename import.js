// Reads an Instagram "Download your information" export and returns the
// usernames that followed you when the download was made, plus when each one
// followed you (Instagram records that per follower).
//
// Accepts the .zip as Instagram sends it (any part of a multi-part export,
// zip64 included) or the extracted files: followers_1.json / followers_1.html
// (2021+ exports, one file per few thousand followers) or connections.json
// (pre-2021 exports). Big zips are read in slices, never loaded whole.

const FOLLOWERS_FILE = /(^|\/)(followers(_\d+)?\.(json|html)|connections\.json)$/i;
const USERNAME = /^[a-z0-9._]{1,30}$/;
const NOT_PROFILES = new Set(['accounts', 'explore', 'p', 'reel', 'reels', 'stories', 'direct', 'about', 'legal', 'developer']);

async function readInstagramExport(files) {
  const found = []; // { text, date }
  for (const file of files) {
    if (await isZip(file)) {
      for (const entry of await zipEntries(file)) {
        if (FOLLOWERS_FILE.test(entry.name)) found.push({ text: await entry.text(), date: entry.date });
      }
    } else if (FOLLOWERS_FILE.test(file.name)) {
      found.push({ text: await file.text(), date: file.lastModified });
    }
  }
  if (!found.length) {
    throw new Error('No followers list found. Pick the .zip from Instagram, or followers_1.json (or .html) from its connections/followers_and_following folder.');
  }

  const names = new Set();
  const followedAt = {}; // username → ms
  let latestFollow = 0;
  const add = (raw, ts) => {
    const n = String(raw || '').trim().replace(/^@/, '').toLowerCase();
    if (!USERNAME.test(n) || NOT_PROFILES.has(n)) return;
    names.add(n);
    const ms = typeof ts === 'number' && ts > 0 ? (ts < 1e11 ? ts * 1000 : ts) : 0;
    if (ms) {
      followedAt[n] = followedAt[n] ? Math.min(followedAt[n], ms) : ms;
      latestFollow = Math.max(latestFollow, ms);
    }
  };
  for (const { text } of found) {
    if (text.trimStart().startsWith('<')) usernamesFromHtml(text, add);
    else usernamesFromJson(JSON.parse(text), add);
  }
  if (!names.size) throw new Error('The followers file was found but had no accounts in it.');

  // The newest file date is when the download was made; a follow can't be newer.
  const asOf = Math.max(...found.map((f) => f.date || 0), latestFollow) || Date.now();
  return { usernames: [...names], asOf, followedAt };
}

function usernamesFromJson(data, add) {
  // Pre-2021: { followers: { username: "2019-05-01T..." }, following: {...} }
  if (data && !Array.isArray(data) && data.followers && typeof data.followers === 'object' && !Array.isArray(data.followers)) {
    for (const [n, when] of Object.entries(data.followers)) add(n, Date.parse(when) || 0);
    return;
  }
  // 2021+: [{ title, string_list_data: [{ href, value, timestamp }] }], sometimes wrapped in an object.
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v.string_list_data)) {
      if (!v.string_list_data.length) add(v.title);
      for (const s of v.string_list_data) add(s.value || v.title || fromHref(s.href), s.timestamp);
      return;
    }
    Object.values(v).forEach(walk);
  };
  walk(data);
}

function usernamesFromHtml(html, add) {
  // Each follower is a profile link, followed by the date as text ("Mar 03, 2021, 10:15 am").
  const re = /href="https?:\/\/(?:www\.)?instagram\.com\/(?:_u\/)?([A-Za-z0-9._]+)\/?"[^>]*>[\s\S]*?<\/a>(?:\s*<\/div>)?\s*(?:<div[^>]*>\s*([A-Z][a-z]{2} \d{1,2}, \d{4},? [\d:]+ ?[ap]m)\s*<\/div>)?/gi;
  for (const m of html.matchAll(re)) add(m[1], m[2] ? Date.parse(m[2].replace(/, (\d{1,2}:)/, ' $1')) : 0);
}

function fromHref(href) {
  const m = /instagram\.com\/(?:_u\/)?([A-Za-z0-9._]+)/.exec(href || '');
  return m ? m[1] : '';
}

// ---------------------------------------------------------------- minimal zip reader

async function bytes(file, start, end) {
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

async function isZip(file) {
  const b = await bytes(file, 0, 4);
  return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

const dosDate = (d, t) => new Date(1980 + (d >> 9), ((d >> 5) & 15) - 1, d & 31, t >> 11, (t >> 5) & 63, (t & 31) * 2).getTime();

async function zipEntries(file) {
  const tailLen = Math.min(file.size, 22 + 0xffff + 20);
  const tail = await bytes(file, file.size - tailLen, file.size);
  const dv = new DataView(tail.buffer);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(`${file.name} isn't a readable zip file.`);

  let cdSize = dv.getUint32(eocd + 12, true);
  let cdOffset = dv.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    const loc = eocd - 20; // zip64 locator sits right before the end record
    if (loc < 0 || dv.getUint32(loc, true) !== 0x07064b50) throw new Error(`${file.name} isn't a readable zip file.`);
    const recOff = Number(dv.getBigUint64(loc + 8, true));
    const rec = new DataView((await bytes(file, recOff, recOff + 56)).buffer);
    cdSize = Number(rec.getBigUint64(40, true));
    cdOffset = Number(rec.getBigUint64(48, true));
  }

  const cd = await bytes(file, cdOffset, cdOffset + cdSize);
  const v = new DataView(cd.buffer);
  const utf8 = new TextDecoder();
  const entries = [];
  let p = 0;
  while (p + 46 <= cd.length && v.getUint32(p, true) === 0x02014b50) {
    const method = v.getUint16(p + 10, true);
    const date = dosDate(v.getUint16(p + 14, true), v.getUint16(p + 12, true));
    let csize = v.getUint32(p + 20, true);
    let usize = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    let offset = v.getUint32(p + 42, true);
    const name = utf8.decode(cd.subarray(p + 46, p + 46 + nameLen));

    // zip64 extra field: 64-bit values for whichever fields are maxed out, in this order.
    let x = p + 46 + nameLen;
    const extraEnd = x + extraLen;
    while (x + 4 <= extraEnd) {
      const id = v.getUint16(x, true);
      const size = v.getUint16(x + 2, true);
      if (id === 0x0001) {
        let q = x + 4;
        if (usize === 0xffffffff) { usize = Number(v.getBigUint64(q, true)); q += 8; }
        if (csize === 0xffffffff) { csize = Number(v.getBigUint64(q, true)); q += 8; }
        if (offset === 0xffffffff) offset = Number(v.getBigUint64(q, true));
      }
      x += 4 + size;
    }
    entries.push({ name, date, text: () => readEntry(file, offset, csize, method) });
    p = extraEnd + commentLen;
  }
  return entries;
}

async function readEntry(file, offset, csize, method) {
  const h = new DataView((await bytes(file, offset, offset + 30)).buffer);
  if (h.getUint32(0, true) !== 0x04034b50) throw new Error('The zip file looks damaged.');
  const start = offset + 30 + h.getUint16(26, true) + h.getUint16(28, true);
  const blob = file.slice(start, start + csize);
  if (method === 0) return blob.text();
  if (method === 8) return new Response(blob.stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  throw new Error('The zip uses a compression method this extension can’t read. Unzip it and pick followers_1.json instead.');
}
