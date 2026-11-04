// Unfollow Watch — background service worker.
//
// Keeps a snapshot of your followers and following, diffs every new scan
// against it, and records the changes as events (unfollowed you, new follower,
// you followed, you unfollowed). A cheap profile-count check runs on a timer
// and only triggers a full scan when the counts moved (or once a day).

const IG = 'https://www.instagram.com';
const APP_ID = '936619743392459'; // public web app id sent by instagram.com itself
const PAGE_SIZE = 50;
const MAX_EVENTS = 5000;
const FULL_SCAN_EVERY = 24 * 60 * 60 * 1000;
const LIVE_TTL = 3 * 60 * 1000;
const CHECK_ALARM = 'check';
const DEFAULT_SETTINGS = { checkMinutes: 60, notifyLost: true, notifyGained: false };
const RATE_KEY = 'rateLimit';
const SCAN_GAP = 15 * 60 * 1000; // minimum time between full scans (~120 requests each)
const COOLDOWN_BASE = 30 * 60 * 1000; // first pause after a rate limit
const COOLDOWN_MAX = 6 * 60 * 60 * 1000;
const PAGE_DELAY = [2000, 4000]; // random pause between list pages, ms
const BREAK_EVERY = 30; // pages; then a longer pause
const BREAK_DELAY = [15_000, 30_000];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (min, max) => Math.round(min + Math.random() * (max - min));
const fmt = (n) => Number(n).toLocaleString('en-US');
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const acctKey = (id) => `acct:${id}`;
const liveKey = (id) => `live:${id}`;
const importKey = (id) => `import:${id}`;

class IgError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

const isFatal = (e) => e.code === 'NOT_LOGGED_IN' || e.code === 'RATE_LIMIT';

// ---------------------------------------------------------------- storage

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

async function saveSettings(next) {
  const settings = { ...(await getSettings()), ...next };
  await chrome.storage.local.set({ settings });
  await scheduleCheck();
  return settings;
}

async function getAcct(userId) {
  const key = acctKey(userId);
  const acct = (await chrome.storage.local.get(key))[key] || null;
  return acct && acct.v === 2 ? acct : migrate(acct);
}

// v1 only tracked mutuals; keep its detected unfollowers as history and
// start a fresh baseline on the next scan.
function migrate(old) {
  if (!old) return null;
  const events = Object.entries(old.unfollowers || {}).map(([id, u]) => ({
    t: 'lost', id, u: u.u, n: u.n, p: u.p, v: u.v, at: u.at || old.lastScan,
  }));
  return { v: 2, userId: old.userId, username: old.username, pic: old.pic, events, seenAt: Date.now() };
}

async function mutateAcct(userId, fn) {
  const acct = await getAcct(userId);
  if (!acct) return null;
  fn(acct);
  await chrome.storage.local.set({ [acctKey(userId)]: acct });
  return acct;
}

function pushEvents(acct, events) {
  acct.events = [...(acct.events || []), ...events].slice(-MAX_EVENTS);
}

async function scheduleCheck() {
  await chrome.alarms.clear(CHECK_ALARM);
  const { checkMinutes } = await getSettings();
  if (checkMinutes > 0) {
    chrome.alarms.create(CHECK_ALARM, { delayInMinutes: 1, periodInMinutes: checkMinutes });
  }
}

// ---------------------------------------------------------------- Instagram API

// Requests from the service worker carry a chrome-extension:// origin, which
// Instagram rejects for POSTs. Rewrite Origin/Referer on our own tab-less requests.
async function ensureHeaderRule() {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Origin', operation: 'set', value: IG },
          { header: 'Referer', operation: 'set', value: `${IG}/` },
        ],
      },
      condition: {
        requestDomains: ['instagram.com'],
        tabIds: [chrome.tabs.TAB_ID_NONE],
        resourceTypes: ['xmlhttprequest', 'other'],
      },
    }],
  });
}

async function getCookie(name) {
  const c = await chrome.cookies.get({ url: IG, name });
  return c ? c.value : null;
}

async function getSession() {
  const userId = await getCookie('ds_user_id');
  if (!userId) throw new IgError('NOT_LOGGED_IN', 'Log in to instagram.com in this browser first.');
  return { userId, csrf: await getCookie('csrftoken') };
}

async function directFetch(url, init) {
  const res = await fetch(url, { ...init, credentials: 'include' });
  return { status: res.status, text: await res.text(), via: 'background' };
}

// For scans and follow/unfollow you start, the extension may open instagram.com
// in a background tab when none is open, so requests can run from the site.
// Timed checks never open tabs. The helper tab closes a minute after last use.
let mayOpenTab = false;
let helperTab = null;
let helperCloseTimer = null;

function waitForLoad(tabId) {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };
    const onUpdated = (id, info) => id === tabId && info.status === 'complete' && done();
    const timer = setTimeout(done, 20_000);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((t) => t.status === 'complete' && done(), done);
  });
}

async function instagramTabs() {
  const tabs = (await chrome.tabs.query({ url: 'https://www.instagram.com/*' })).filter((t) => !t.discarded);
  if (tabs.length || !mayOpenTab) return tabs;
  const tab = await chrome.tabs.create({ url: `${IG}/`, active: false });
  helperTab = tab.id;
  await waitForLoad(tab.id);
  return [tab];
}

function releaseHelperTab(delay = 60_000) {
  clearTimeout(helperCloseTimer);
  if (helperTab == null) return;
  helperCloseTimer = setTimeout(() => {
    chrome.tabs.remove(helperTab).catch(() => {});
    helperTab = null;
  }, delay);
}

chrome.tabs.onRemoved.addListener((id) => {
  if (id === helperTab) helperTab = null;
});

// Fallback: run the request inside an instagram.com tab, exactly as the site would.
async function tabFetch(url, init) {
  const tabs = await instagramTabs();
  for (const tab of tabs) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: async (u, i) => {
          try {
            const r = await fetch(u, { ...i, credentials: 'include' });
            return { status: r.status, text: await r.text() };
          } catch (e) {
            return { status: 0, text: String(e) };
          }
        },
        args: [url, init],
      });
      if (result?.status) return { ...result, via: 'tab' };
    } catch {
      // tab discarded or not scriptable; try the next one
    }
  }
  return null;
}

// ---------------------------------------------------------------- rate-limit cooldown
//
// Once Instagram rate-limits us, every request (scans, timed checks, the
// popup's live counts, follow/unfollow) is held back until the cooldown ends.
// Each limit in a row doubles the pause: 30 min, 1 h, 2 h, 4 h, then 6 h.
// The first successful request afterwards resets it.

async function getRateLimit() {
  return (await chrome.storage.local.get(RATE_KEY))[RATE_KEY] || null;
}

async function activeCooldown() {
  const limit = await getRateLimit();
  return limit && Date.now() < limit.until ? limit : null;
}

async function startCooldown() {
  const prev = await getRateLimit();
  const strikes = (prev?.strikes || 0) + 1;
  const until = Date.now() + Math.min(COOLDOWN_BASE * 2 ** (strikes - 1), COOLDOWN_MAX);
  await chrome.storage.local.set({ [RATE_KEY]: { strikes, until } });
  return until;
}

const cooldownError = (until) => new IgError(
  'RATE_LIMIT',
  `Instagram is limiting requests. The extension is paused until ${clock(until)} so the limit can clear.`,
);

// Instagram requires Meta's anti-forgery tokens (fb_dtsg, plus jazoest derived
// from it) in the body of every POST such as follow/unfollow; without them it
// answers with its home page instead of data. The token is in the HTML of any
// logged-in instagram.com page and stays valid for a while, so it's cached.
let dtsgCache = null;
const DTSG_TTL = 30 * 60 * 1000;
const pickDtsg = (html) => html?.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/)?.[1] || html?.match(/"dtsg":\{"token":"([^"]+)"/)?.[1] || null;
const jazoest = (v) => '2' + [...v].reduce((sum, c) => sum + c.charCodeAt(0), 0);

async function getDtsg(force = false) {
  if (!force && dtsgCache && Date.now() - dtsgCache.at < DTSG_TTL) return dtsgCache.value;
  const init = { method: 'GET', headers: {} };
  let value = pickDtsg((await directFetch(`${IG}/`, init).catch(() => null))?.text);
  if (!value) value = pickDtsg((await tabFetch(`${IG}/`, init))?.text);
  if (!value) throw new IgError('REFUSED', 'Couldn’t get Instagram’s security token for this action. Open instagram.com, make sure you’re logged in, and try again.');
  dtsgCache = { value, at: Date.now() };
  return value;
}

// soft: a refusal of this one request (profile counts, username) is reported
// as SOFT_LIMIT and never pauses the extension; the follower lists still work
// when Instagram limits these.
async function igRequest(path, { method = 'GET', form, ignoreCooldown = false, soft = false, freshToken = false } = {}) {
  const limit = await getRateLimit();
  if (limit && !ignoreCooldown && Date.now() < limit.until) throw cooldownError(limit.until);
  await ensureHeaderRule();
  const { csrf } = await getSession();
  const headers = { 'X-IG-App-ID': APP_ID, 'X-Requested-With': 'XMLHttpRequest' };
  if (csrf) headers['X-CSRFToken'] = csrf;
  const init = { method, headers };
  if (form) {
    const dtsg = await getDtsg(freshToken);
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams({ ...form, jazoest: jazoest(dtsg), fb_dtsg: dtsg }).toString();
  }
  const url = IG + path;

  // Instagram is stricter with background requests than with the site itself,
  // so anything that looks refused (including "slow down") is retried from an
  // open instagram.com tab before we believe it.
  let res = await directFetch(url, init).catch(() => null);
  const refused = (r) => !r || [400, 401, 403, 429].includes(r.status) ||
    !r.text.trimStart().startsWith('{') || /wait a few minutes|rate limit/i.test(r.text.slice(0, 500));
  if (refused(res)) {
    const viaTab = await tabFetch(url, init);
    if (viaTab) res = viaTab;
  }
  if (!res) throw new IgError('NETWORK', 'Could not reach Instagram. Check your connection.');
  if (form && !freshToken && res.text.trimStart().startsWith('<')) {
    // Instagram answers a POST with a stale or missing token with its home page.
    return igRequest(path, { method, form, ignoreCooldown, soft, freshToken: true });
  }

  let data = null;
  try {
    data = JSON.parse(res.text);
  } catch {
    // non-JSON, usually an HTML login page
  }
  const message = data?.message || '';
  const slowDown = /wait a few minutes|rate limit/i.test(message);
  if (res.status >= 400 || slowDown) {
    await chrome.storage.local.set({ lastRefusal: { status: res.status, message: message.slice(0, 160), via: res.via, path: path.split('?')[0], at: Date.now() } });
  }
  // Only a real limit starts the pause: HTTP 429, or "please wait" from the site
  // itself. Instagram also says "please wait" to background requests it doesn't
  // trust; that isn't a rate limit and must not lock scanning.
  if (soft && (res.status === 429 || slowDown)) {
    throw new IgError('SOFT_LIMIT', `Instagram limited ${path.split('?')[0]} (HTTP ${res.status}).`);
  }
  if (res.status === 429 || (slowDown && res.via === 'tab')) {
    // A retry inside a scan that fails again doesn't stretch the pause further.
    const until = ignoreCooldown && limit ? limit.until : await startCooldown();
    throw cooldownError(until);
  }
  if (slowDown) {
    throw new IgError('REFUSED', 'Instagram refused the request from the extension. Open instagram.com in a tab, make sure you’re logged in, and scan again.');
  }
  // "Action blocked / Try again later": Instagram restricts follows/unfollows
  // for hours or days. Retrying makes it worse, so callers stop on this.
  if (data && (data.spam || message === 'feedback_required' || /try again later/i.test(data.feedback_title || ''))) {
    const detail = data.feedback_message ? ` Instagram says: “${String(data.feedback_message).slice(0, 200)}”` : '';
    throw new IgError('ACTION_BLOCKED', `Instagram blocked this action for now (“${data.feedback_title || 'Try Again Later'}”).${detail}`);
  }
  if (data?.require_login || res.status === 401 || message === 'login_required') {
    throw new IgError('NOT_LOGGED_IN', 'Your Instagram session expired. Log in again at instagram.com.');
  }
  if (!data) throw new IgError('API', 'Unexpected response from Instagram. Are you logged in?');
  if (res.status >= 400 || data.status === 'fail') {
    throw new IgError('API', message || `Instagram returned HTTP ${res.status}.`);
  }
  if (limit) await chrome.storage.local.remove(RATE_KEY);
  return data;
}

const slim = (u) => ({ u: u.username, n: u.full_name || '', p: u.profile_pic_url || '', v: !!u.is_verified });

// Your profile page's summary line ("3,950 Followers, 3,554 Following, 0 Posts")
// is the counts source: Instagram rate-limits /users/{id}/info/ on the web
// and has retired web_profile_info. Fetched as HTML, from a tab if needed.
async function fetchProfilePage(username) {
  const gate = await activeCooldown();
  if (gate) throw cooldownError(gate.until);
  await ensureHeaderRule();
  const url = `${IG}/${encodeURIComponent(username)}/`;
  const init = { method: 'GET', headers: {} };
  const ok = (r) => r && r.status === 200 && /og:description/.test(r.text);
  let res = await directFetch(url, init).catch(() => null);
  if (!ok(res)) {
    const viaTab = await tabFetch(url, init);
    if (viaTab) res = viaTab;
  }
  if (!ok(res)) throw new IgError('SOFT_LIMIT', `Couldn't read your profile page (HTTP ${res?.status ?? 'no response'}).`);
  return res.text;
}

const unescapeHtml = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// "3,950" → 3950 (exact); "12.3K" → 12300 (approximate)
function parseCount(text) {
  const m = /^([\d.,]+)([KkMm])?$/.exec(text.trim());
  if (!m) return null;
  if (!m[2]) return { n: Number(m[1].replace(/[.,]/g, '')), exact: true };
  return { n: Math.round(parseFloat(m[1].replace(/,/g, '')) * (/k/i.test(m[2]) ? 1e3 : 1e6)), exact: false };
}

function parseProfilePage(html) {
  const meta = (name) => {
    const m = new RegExp(`<meta[^>]+property="${name}"[^>]+content="([^"]*)"`, 'i').exec(html) ||
      new RegExp(`<meta[^>]+content="([^"]*)"[^>]+property="${name}"`, 'i').exec(html);
    return m ? unescapeHtml(m[1]) : '';
  };
  const m = /([\d.,]+[KkMm]?)\s+Followers?,\s+([\d.,]+[KkMm]?)\s+Following/i.exec(meta('og:description'));
  const followers = m && parseCount(m[1]);
  const following = m && parseCount(m[2]);
  if (!followers || !following) return null;
  return { pic: meta('og:image'), followers: followers.n, following: following.n, approx: !followers.exact || !following.exact };
}

async function fetchUsername() {
  const data = await igRequest('/api/v1/accounts/edit/web_form_data/', { soft: true });
  return data.form_data?.username || data.user?.username || null;
}

// Counts are a nice-to-have: a scan reads the full lists without them, so
// any failure here returns null instead of stopping the scan.
async function fetchProfile(userId, username) {
  try {
    if (!username) username = await fetchUsername();
    if (!username) return null;
    const page = parseProfilePage(await fetchProfilePage(username));
    return page ? { username, ...page } : { username, pic: '', followers: null, following: null };
  } catch (e) {
    if (e.code === 'NOT_LOGGED_IN' || e.code === 'RATE_LIMIT') throw e;
    return username ? { username, pic: '', followers: null, following: null } : null;
  }
}

async function getLiveCounts(userId, { force = false } = {}) {
  const key = liveKey(userId);
  const cached = (await chrome.storage.local.get(key))[key];
  if (!force && cached && Date.now() - cached.at < LIVE_TTL) return cached;
  const acct = await getAcct(userId);
  const profile = await fetchProfile(userId, acct?.username);
  if (profile?.followers == null) return cached || null; // counts unavailable right now
  const live = { ...profile, at: Date.now() };
  await chrome.storage.local.set({ [key]: live });
  return live;
}

async function fetchList(userId, kind, onPage) {
  const users = {};
  let maxId = '';
  let retries = 0;
  let pages = 0;
  do {
    const qs = new URLSearchParams({ count: String(PAGE_SIZE) });
    if (maxId) qs.set('max_id', maxId);
    if (kind === 'followers') qs.set('search_surface', 'follow_list_page');
    // The default "following" order is a ranking that shifts between pages, so
    // offset paging repeats some accounts and skips others (~15% lost on a
    // 3,500 account). Sorted by date followed, Instagram returns the whole list
    // in one stable response (or stable pages).
    if (kind === 'following') qs.set('order', 'date_followed_latest');

    let data;
    try {
      // Mid-scan retries go through the cooldown so the pages read so far aren't lost.
      data = await igRequest(`/api/v1/friendships/${userId}/${kind}/?${qs}`, { ignoreCooldown: retries > 0 });
    } catch (e) {
      if (e.code === 'RATE_LIMIT' && retries < 2) {
        const mins = ++retries === 1 ? 2 : 5;
        await onPage(Object.keys(users).length, `Instagram asked us to slow down. Waiting ${mins} minutes, then trying once more.`);
        await sleep(mins * 60_000);
        continue;
      }
      throw e;
    }
    retries = 0;
    for (const u of data.users || []) users[String(u.pk ?? u.pk_id ?? u.id)] = slim(u);
    maxId = data.next_max_id || '';
    await onPage(Object.keys(users).length);
    if (!maxId) break;
    if (++pages % BREAK_EVERY === 0) {
      await onPage(Object.keys(users).length, 'Taking a short break so Instagram doesn’t limit the scan…');
      await sleep(jitter(...BREAK_DELAY));
    } else {
      await sleep(jitter(...PAGE_DELAY));
    }
  } while (maxId);
  return users;
}

// ---------------------------------------------------------------- scanning

let scanning = null;

// When the next scan is allowed: after a rate-limit pause, and no sooner than
// SCAN_GAP after the last finished scan. null = a scan may run now.
async function scanLock(userId) {
  const limit = await activeCooldown();
  const acct = userId ? await getAcct(userId) : null;
  const recent = acct?.lastScan ? acct.lastScan + SCAN_GAP : 0;
  const until = Math.max(limit?.until || 0, recent);
  if (until <= Date.now()) return null;
  return { until, reason: limit && limit.until >= recent ? 'limit' : 'recent' };
}

function scan() {
  if (!scanning) {
    scanning = (async () => {
      // Checked before runScan so a refused scan doesn't overwrite the last result.
      const lock = await scanLock((await getSession()).userId);
      if (lock?.reason === 'limit') throw cooldownError(lock.until);
      if (lock) throw new IgError('TOO_SOON', `You just scanned. The next scan is available at ${clock(lock.until)}.`);
      return runScan();
    })().finally(() => (scanning = null));
  }
  return scanning;
}

async function setProgress(progress) {
  await chrome.storage.local.set({ progress });
}

// A truncated list would look like a wave of unfollows, so refuse to commit it.
function assertComplete(label, got, expected) {
  if (expected > 20 && got < expected * 0.8) {
    throw new IgError(
      'INCOMPLETE',
      `Instagram returned only ${fmt(got)} of ${fmt(expected)} ${label}. The scan was discarded so it doesn't report false unfollows. Try again later.`,
    );
  }
}

async function runScan() {
  // Extension API calls keep the service worker alive during long scans.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20_000);
  const startedAt = Date.now();
  const report = (p) => setProgress({ running: true, startedAt, ...p });

  try {
    const { userId } = await getSession();
    await chrome.storage.local.set({ activeUser: userId });
    const prev = await getAcct(userId);

    await report({ phase: 'profile' });
    const profile = await fetchProfile(userId, prev?.username);
    const hasCounts = profile?.followers != null;
    if (hasCounts) await chrome.storage.local.set({ [liveKey(userId)]: { ...profile, at: Date.now() } });

    const following = await fetchList(userId, 'following', (count, note) =>
      report({ phase: 'following', count, total: profile?.following, note }));
    const followers = await fetchList(userId, 'followers', (count, note) =>
      report({ phase: 'followers', count, total: profile?.followers, note }));

    const prevFollowers = prev?.followers ? Object.keys(prev.followers).length : 0;
    const prevFollowing = prev?.following ? Object.keys(prev.following).length : 0;
    assertComplete('followers', Object.keys(followers).length, profile?.followers ?? prevFollowers);
    assertComplete('accounts you follow', Object.keys(following).length, profile?.following ?? prevFollowing);

    const { lost, gained } = await commitScan(userId, prev, profile, following, followers);
    await setProgress({ running: false, error: null, finishedAt: Date.now() });
    await notify(lost, gained);
    await updateBadge();
    return { lost: lost.length, gained: gained.length, baseline: !prev?.followers };
  } catch (e) {
    await setProgress({ running: false, error: e.message, code: e.code || 'ERROR', finishedAt: Date.now() });
    throw e;
  } finally {
    clearInterval(keepAlive);
  }
}

async function commitScan(userId, prev, profile, following, followers) {
  const now = Date.now();
  const events = [];
  const delta = { gained: 0, lost: 0, followed: 0, unfollowed: 0 };
  const lost = [];
  const gained = [];

  if (prev?.followers && prev?.following) {
    const add = (t, id, u) => events.push({ t, id, u: u.u, n: u.n, p: u.p, v: u.v, at: now });
    // Following lists saved before the date-sorted fix were missing accounts, so
    // the first scan after it updates the list quietly instead of reporting
    // hundreds of "you followed" changes.
    const trustFollowing = !!prev.followingComplete;
    const goneFromFollowing = new Set(trustFollowing ? Object.keys(prev.following).filter((id) => !following[id]) : []);

    for (const [id, u] of Object.entries(prev.followers)) {
      if (followers[id]) continue;
      // Vanished from both lists without you unfollowing through the extension:
      // most likely deactivated, deleted or blocked you — not a plain unfollow.
      if (goneFromFollowing.has(id)) {
        goneFromFollowing.delete(id);
        add('gone', id, u);
        continue;
      }
      const info = following[id] || u;
      add('lost', id, info);
      lost.push({ id, ...info, stillFollowing: !!following[id] });
    }
    for (const [id, u] of Object.entries(followers)) {
      if (prev.followers[id]) continue;
      add('gained', id, u);
      gained.push({ id, ...u });
    }
    for (const [id, u] of Object.entries(trustFollowing ? following : {})) {
      if (!prev.following[id]) {
        add('followed', id, u);
        delta.followed++;
      }
    }
    for (const id of goneFromFollowing) {
      add('unfollowed', id, prev.following[id]);
      delta.unfollowed++;
    }
    delta.lost = lost.length;
    delta.gained = gained.length;
  }

  const acct = {
    v: 2,
    followingComplete: true,
    userId,
    username: profile?.username || prev?.username || '',
    pic: profile?.pic || prev?.pic || '',
    igCounts: profile?.followers != null ? { followers: profile.followers, following: profile.following } : prev?.igCounts || null,
    followers,
    following,
    events: prev?.events || [],
    delta: prev?.followers ? delta : null,
    baselineAt: prev?.baselineAt || now,
    lastScan: now,
    seenAt: prev?.seenAt ?? now,
  };
  pushEvents(acct, events);
  await chrome.storage.local.set({ [acctKey(userId)]: acct });
  return { lost, gained };
}

// Cheap periodic check: one profile request. Full scan only if counts moved,
// or if the last full scan is more than a day old (catches one-in-one-out swaps).
async function backgroundCheck() {
  if (scanning || (await activeCooldown())) return;
  let userId;
  try {
    ({ userId } = await getSession());
  } catch {
    return;
  }
  const acct = await getAcct(userId);
  if (!acct?.followers) return; // the first scan is started by the user

  const live = await getLiveCounts(userId, { force: true }).catch(() => null);
  const moved = live?.followers != null && acct.igCounts?.followers != null &&
    (live.followers !== acct.igCounts.followers || live.following !== acct.igCounts.following);
  const stale = Date.now() - acct.lastScan > FULL_SCAN_EVERY;
  if (moved || stale) await scan().catch(() => {}); // errors surface through progress
}

// ---------------------------------------------------------------- actions

async function unfollow(id) {
  const { userId } = await getSession();
  const data = await igRequest(`/api/v1/friendships/destroy/${id}/`, {
    method: 'POST',
    form: { user_id: id, container_module: 'profile' },
  });
  if (data.friendship_status?.following === true) {
    throw new IgError('API', 'Instagram did not accept the unfollow. Try again later.');
  }
  await mutateAcct(userId, (a) => {
    const u = a.following?.[id];
    if (!u) return;
    delete a.following[id];
    if (a.igCounts) a.igCounts.following--;
    pushEvents(a, [{ t: 'unfollowed', id, ...u, at: Date.now() }]);
  });
  return { ok: true };
}

// ---------------------------------------------------------------- unfollow all
//
// "Unfollow all" queues accounts and unfollows them one at a time, spaced out
// like a person would, because bursts of unfollows get the account action-
// blocked. Runs from alarms, so it continues while Chrome is open, across
// popup closes and browser restarts.

const QUEUE_KEY = 'unfollowQueue';
const QUEUE_ALARM = 'unfollowQueue';
const UNFOLLOW_GAP = [45_000, 90_000]; // between unfollows
const UNFOLLOW_PER_DAY = 150;
const QUEUE_SCAN_MAX_AGE = 24 * 60 * 60 * 1000;

const dayKey = (t = Date.now()) => new Date(t).toDateString();

async function getQueue() {
  return (await chrome.storage.local.get(QUEUE_KEY))[QUEUE_KEY] || null;
}

async function setQueue(q) {
  if (q) await chrome.storage.local.set({ [QUEUE_KEY]: q });
  else await chrome.storage.local.remove(QUEUE_KEY);
}

function scheduleQueue(at) {
  chrome.alarms.create(QUEUE_ALARM, { when: Math.max(at, Date.now() + 1000) });
}

async function startUnfollowAll(ids) {
  const { userId } = await getSession();
  if (await getQueue()) throw new IgError('BUSY', 'Unfollow all is already running.');
  const acct = await getAcct(userId);
  if (!acct?.followingComplete) throw new IgError('STALE', 'Run a scan first, so the list is complete.');
  if (Date.now() - acct.lastScan > QUEUE_SCAN_MAX_AGE) throw new IgError('STALE', 'Your last scan is more than a day old. Run a scan first, so nobody who followed you back gets unfollowed.');
  // Only accounts that, per the latest scan, you follow and that don't follow you.
  const items = [...new Set(ids.map(String))]
    .filter((id) => acct.following[id] && !acct.followers[id])
    .map((id) => ({ id, u: acct.following[id].u }));
  if (!items.length) throw new IgError('EMPTY', 'Nobody to unfollow.');
  const q = { userId, items, total: items.length, done: 0, skipped: 0, failed: 0, startedAt: Date.now(), nextAt: Date.now(), today: { day: dayKey(), count: 0 }, paused: null, wait: null };
  await setQueue(q);
  queueTick();
  return q;
}

async function stopUnfollowAll() {
  await chrome.alarms.clear(QUEUE_ALARM);
  await setQueue(null);
  return true;
}

async function pauseUnfollowAll(paused) {
  const q = await getQueue();
  if (!q) return null;
  q.paused = paused ? { reason: 'user', message: 'Paused.' } : null;
  q.nextAt = Date.now();
  await setQueue(q);
  if (paused) await chrome.alarms.clear(QUEUE_ALARM);
  else queueTick();
  return q;
}

let queueBusy = false;

async function queueTick() {
  if (queueBusy) return;
  queueBusy = true;
  try {
    const q = await getQueue();
    if (!q || q.paused) return;
    if (!q.items.length) return void (await finishQueue(q));

    let session;
    try {
      session = await getSession();
    } catch {
      return void (await pauseQueue(q, 'login', 'Log in to instagram.com to continue.'));
    }
    if (session.userId !== q.userId) return void (await pauseQueue(q, 'account', 'You switched Instagram accounts. Switch back to continue.'));

    const now = Date.now();
    const cooldown = await activeCooldown();
    if (cooldown) return void (await waitQueue(q, cooldown.until + jitter(30_000, 120_000), 'limit'));
    if (q.today.day !== dayKey()) q.today = { day: dayKey(), count: 0 };
    if (q.today.count >= UNFOLLOW_PER_DAY) {
      const midnight = new Date(); midnight.setHours(24, 0, 0, 0);
      return void (await waitQueue(q, midnight.getTime() + jitter(5 * 60_000, 30 * 60_000), 'daily'));
    }
    if (now < q.nextAt - 1000) return void scheduleQueue(q.nextAt);

    // Skip anyone who followed you back or whom you already unfollowed since.
    // Skipping costs no request, so it doesn't wait.
    const acct = await getAcct(q.userId);
    const stillCandidate = (it) => acct?.following?.[it.id] && !acct.followers?.[it.id];
    while (q.items.length && !stillCandidate(q.items[0])) {
      q.items.shift();
      q.skipped++;
    }
    if (!q.items.length) return void (await finishQueue(q));
    const item = q.items[0];

    try {
      await unfollow(item.id);
      q.items.shift();
      q.done++;
      q.today.count++;
      q.lastError = null;
      q.failStreak = 0;
    } catch (e) {
      if (e.code === 'RATE_LIMIT') return void (await waitQueue(q, ((await activeCooldown())?.until || now + COOLDOWN_BASE) + jitter(30_000, 120_000), 'limit'));
      if (e.code === 'ACTION_BLOCKED') return void (await pauseQueue(q, 'blocked', `${e.message} Unfollow all is paused. Wait a day or two before resuming.`));
      if (e.code === 'NOT_LOGGED_IN' || e.code === 'REFUSED' || e.code === 'NETWORK') return void (await pauseQueue(q, 'error', e.message));
      // A single odd failure (deleted account, etc.) is skipped; two in a row
      // means something is wrong for every account, so stop instead of
      // marking the whole list as failed.
      q.failStreak = (q.failStreak || 0) + 1;
      q.lastError = `@${item.u}: ${e.message}`;
      if (q.failStreak >= 2) return void (await pauseQueue(q, 'error', `Two unfollows in a row failed. Last error: ${e.message}`));
      q.items.shift();
      q.failed++;
    }
    q.wait = null;
    q.nextAt = Date.now() + jitter(...UNFOLLOW_GAP);
    if (!q.items.length) return void (await finishQueue(q));
    await setQueue(q);
    scheduleQueue(q.nextAt);
  } finally {
    queueBusy = false;
  }
}

async function waitQueue(q, until, why) {
  q.nextAt = until;
  q.wait = why;
  await setQueue(q);
  scheduleQueue(until);
}

async function pauseQueue(q, reason, message) {
  q.paused = { reason, message };
  await setQueue(q);
  await chrome.alarms.clear(QUEUE_ALARM);
  chrome.notifications.create(`queue:${Date.now()}`, { type: 'basic', iconUrl: ICON, title: 'Unfollow all paused', message, priority: 1 });
}

async function finishQueue(q) {
  await setQueue(null);
  await chrome.alarms.clear(QUEUE_ALARM);
  chrome.notifications.create(`queue:${Date.now()}`, {
    type: 'basic', iconUrl: ICON, title: 'Unfollow all finished',
    message: `Unfollowed ${fmt(q.done)} account${q.done === 1 ? '' : 's'}.${q.skipped ? ` Skipped ${fmt(q.skipped)} who followed you back or were already unfollowed.` : ''}${q.failed ? ` ${fmt(q.failed)} failed.` : ''}`,
  });
}

async function follow(id) {
  const { userId } = await getSession();
  const data = await igRequest(`/api/v1/friendships/create/${id}/`, {
    method: 'POST',
    form: { user_id: id, container_module: 'profile' },
  });
  const status = data.friendship_status || {};
  if (status.following) {
    await mutateAcct(userId, (a) => {
      const u = a.followers?.[id] || a.events?.findLast((e) => e.id === id);
      if (!u || a.following?.[id]) return;
      const user = { u: u.u, n: u.n, p: u.p, v: u.v };
      a.following[id] = user;
      if (a.igCounts) a.igCounts.following++;
      pushEvents(a, [{ t: 'followed', id, ...user, at: Date.now() }]);
    });
  }
  return { requested: !status.following && !!status.outgoing_request };
}

async function markSeen() {
  const { activeUser } = await chrome.storage.local.get('activeUser');
  if (activeUser) await mutateAcct(activeUser, (a) => (a.seenAt = Date.now()));
  await updateBadge();
  return true;
}

async function resetData() {
  const { activeUser } = await chrome.storage.local.get('activeUser');
  if (activeUser) await chrome.storage.local.remove([acctKey(activeUser), liveKey(activeUser), importKey(activeUser)]);
  await chrome.storage.local.remove('progress');
  await updateBadge();
  return true;
}

// Followers list from an Instagram data download, compared against the
// current followers in the popup. One per account; a new import replaces it.
// Several downloads can be imported. The oldest one stays the base for the
// "Since download" comparison; follow dates from all of them are merged,
// keeping each follower's earliest known date.
async function saveImport(data) {
  const { userId } = await getSession();
  const key = importKey(userId);
  const prev = (await chrome.storage.local.get(key))[key] || null;
  const incoming = { usernames: data.usernames.map(String).slice(0, 200_000), asOf: Number(data.asOf) || Date.now() };
  const base = prev && prev.asOf <= incoming.asOf ? prev : incoming;
  const followedAt = { ...(prev?.followedAt || {}) };
  for (const [n, t] of Object.entries(data.followedAt || {})) {
    const ms = Number(t);
    if (ms > 0 && (!followedAt[n] || ms < followedAt[n])) followedAt[n] = ms;
  }
  const imported = {
    usernames: base.usernames,
    asOf: base.asOf,
    latestAsOf: Math.max(prev?.latestAsOf || prev?.asOf || 0, incoming.asOf),
    followedAt,
    importedAt: Date.now(),
    keptOlder: base === prev,
  };
  await chrome.storage.local.set({ [key]: imported });
  return imported;
}

async function removeImport() {
  const { userId } = await getSession();
  await chrome.storage.local.remove(importKey(userId));
  return true;
}

async function getState() {
  let loggedInId = null;
  try {
    loggedInId = (await getSession()).userId;
  } catch {
    // not logged in
  }
  const stored = await chrome.storage.local.get(['activeUser', 'progress', 'settings']);
  if (loggedInId && loggedInId !== stored.activeUser) {
    await chrome.storage.local.set({ activeUser: loggedInId });
    await updateBadge();
  }
  const id = loggedInId || stored.activeUser;
  let progress = stored.progress || null;
  if (progress?.running && !scanning) {
    // The service worker was restarted mid-scan; that scan is gone.
    progress = { running: false, error: 'The last scan was interrupted. Run it again.' };
    await setProgress(progress);
  }
  const live = id ? (await chrome.storage.local.get(liveKey(id)))[liveKey(id)] || null : null;
  return {
    loggedInId,
    acct: id ? await getAcct(id) : null,
    live,
    imported: id ? (await chrome.storage.local.get(importKey(id)))[importKey(id)] || null : null,
    progress,
    cooldownUntil: (await activeCooldown())?.until || null,
    scanLock: await scanLock(id),
    queue: await getQueue(),
    lastRefusal: (await chrome.storage.local.get('lastRefusal')).lastRefusal || null,
    igTabOpen: (await chrome.tabs.query({ url: 'https://www.instagram.com/*' })).length > 0,
    settings: { ...DEFAULT_SETTINGS, ...stored.settings },
  };
}

// ---------------------------------------------------------------- notifications & badge

const ICON = 'icons/icon128.png';

function listNames(list) {
  const names = list.slice(0, 4).map((u) => '@' + u.u).join(', ');
  return list.length > 4 ? `${names} and ${list.length - 4} more` : names;
}

async function notify(lost, gained) {
  const settings = await getSettings();
  if (settings.notifyLost && lost.length === 1) {
    const [u] = lost;
    const buttons = [{ title: 'View profile' }];
    if (u.stillFollowing) buttons.unshift({ title: 'Unfollow' });
    chrome.notifications.create(`lost:${u.id}:${u.u}:${u.stillFollowing ? 1 : 0}`, {
      type: 'basic',
      iconUrl: ICON,
      title: `@${u.u} unfollowed you`,
      message: u.stillFollowing ? 'You still follow them.' : "You don't follow them.",
      buttons,
      priority: 1,
    });
  } else if (settings.notifyLost && lost.length > 1) {
    const still = lost.filter((u) => u.stillFollowing).length;
    chrome.notifications.create(`many:${Date.now()}`, {
      type: 'basic',
      iconUrl: ICON,
      title: `${lost.length} people unfollowed you`,
      message: `${listNames(lost)}.${still ? ` You still follow ${still} of them.` : ''}`,
      priority: 1,
    });
  }
  if (settings.notifyGained && gained.length) {
    chrome.notifications.create(`gained:${Date.now()}`, {
      type: 'basic',
      iconUrl: ICON,
      title: gained.length === 1 ? `@${gained[0].u} followed you` : `${gained.length} new followers`,
      message: gained.length === 1 ? gained[0].n || 'New follower' : listNames(gained),
    });
  }
}

chrome.notifications.onClicked.addListener((nid) => {
  chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
  chrome.notifications.clear(nid);
});

chrome.notifications.onButtonClicked.addListener(async (nid, index) => {
  if (!nid.startsWith('lost:')) return;
  const [, id, username, still] = nid.split(':');
  chrome.notifications.clear(nid);
  const profileIndex = still === '1' ? 1 : 0;
  if (index === profileIndex) {
    chrome.tabs.create({ url: `${IG}/${username}/` });
    return;
  }
  try {
    await unfollow(id);
    chrome.notifications.create({ type: 'basic', iconUrl: ICON, title: `Unfollowed @${username}`, message: 'Removed from your following.' });
  } catch (e) {
    chrome.notifications.create({ type: 'basic', iconUrl: ICON, title: `Couldn't unfollow @${username}`, message: e.message });
  }
});

// Badge = unfollows you haven't looked at yet.
async function updateBadge() {
  const { activeUser } = await chrome.storage.local.get('activeUser');
  const acct = activeUser ? await getAcct(activeUser) : null;
  const n = acct ? (acct.events || []).filter((e) => e.t === 'lost' && e.at > acct.seenAt).length : 0;
  await chrome.action.setBadgeBackgroundColor({ color: '#ed4956' });
  await chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
  await chrome.action.setBadgeText({ text: n ? (n > 99 ? '99+' : String(n)) : '' });
}

// ---------------------------------------------------------------- wiring

chrome.runtime.onInstalled.addListener(() => {
  // A fresh install or reload starts without a pause: earlier versions could
  // pause on refusals that weren't real rate limits.
  chrome.storage.local.remove([RATE_KEY, 'lastRefusal']);
  scheduleCheck();
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleCheck();
  updateBadge();
  queueTick(); // pick up an unfinished "Unfollow all"
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CHECK_ALARM) backgroundCheck();
  if (alarm.name === QUEUE_ALARM) queueTick();
});

async function userAction(fn) {
  mayOpenTab = true;
  try {
    return await fn();
  } finally {
    mayOpenTab = false;
    releaseHelperTab();
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handlers = {
    state: getState,
    scan: () => userAction(scan),
    live: async () => getLiveCounts((await getSession()).userId),
    seen: markSeen,
    unfollow: () => userAction(() => unfollow(msg.id)),
    follow: () => userAction(() => follow(msg.id)),
    saveSettings: () => saveSettings(msg.settings),
    reset: resetData,
    saveImport: () => saveImport(msg.data),
    removeImport,
    unfollowAll: () => startUnfollowAll(msg.ids || []),
    stopUnfollowAll,
    pauseUnfollowAll: () => pauseUnfollowAll(!!msg.paused),
  };
  const handler = handlers[msg?.type];
  if (!handler) return false;
  Promise.resolve()
    .then(handler)
    .then(
      (data) => sendResponse({ ok: true, data }),
      (e) => sendResponse({ ok: false, error: e.message, code: e.code }),
    );
  return true; // async response
});
