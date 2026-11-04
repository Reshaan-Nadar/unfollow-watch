// Firefox exposes the extension API as `browser`, Chrome as `chrome`.
const ext = globalThis.browser ?? globalThis.chrome;
const $ = (sel) => document.querySelector(sel);
const send = (type, extra = {}) => ext.runtime.sendMessage({ type, ...extra });

const CHUNK = 60;
const DAY = 24 * 60 * 60 * 1000;

const FILTERS = {
  activity: [
    ['lost', 'Unfollowed you'],
    ['gained', 'New followers'],
    ['mine', 'Your changes'],
    ['download', 'Since download'],
  ],
  following: [
    ['all', 'All'],
    ['unfollowedYou', 'Unfollowed you'],
    ['notBack', "Don't follow back"],
    ['new', 'New'],
  ],
  followers: [
    ['all', 'All'],
    ['loyal', 'Loyal'],
    ['notFollowed', "You don't follow"],
    ['new', 'New'],
  ],
};

const ui = {
  view: 'activity',
  filters: { activity: 'lost', following: 'all', followers: 'all' },
  query: '',
  items: [],
  rendered: 0,
  settingsOpen: false,
};

let state = null;   // snapshot from the background worker
let derived = null; // lists computed from state.acct
let seenBefore = 0; // unfollows newer than this get a dot

// ---------------------------------------------------------------- helpers

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c != null && c !== false) node.append(c);
  return node;
}

const fmt = (n) => (n == null ? '–' : Number(n).toLocaleString('en-US'));

function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

function dayLabel(ts) {
  const start = new Date().setHours(0, 0, 0, 0);
  if (ts >= start) return 'Today';
  if (ts >= start - DAY) return 'Yesterday';
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
}

// "3 yr 2 mo", "5 mo", "12 days"
function duration(ms) {
  const days = Math.floor(ms / DAY);
  if (days < 1) return 'less than a day';
  if (days < 31) return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months} mo`;
  const years = Math.floor(months / 12);
  return months % 12 ? `${years} yr ${months % 12} mo` : `${years} yr`;
}

function sinceText(since) {
  if (!since) return '';
  if (since.kind === 'before') return `Since before ${longDate(since.at)}`;
  const verb = since.kind === 'exact' ? 'Since' : 'Followed you';
  return `${verb} ${longDate(since.at)} · ${duration(Date.now() - since.at)}`;
}

const longDate = (ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const shortDate = (ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// In-page confirmation; Firefox doesn't show window.confirm() in toolbar popups.
// Resolves true only when the confirm button is pressed (Esc and Cancel → false).
function ask({ title, body = [], ok, danger = false }) {
  const dialog = $('#dialog');
  dialog.replaceChildren(
    el('h2', {}, title),
    ...body.map((p) => el('p', {}, p)),
    el('div', { class: 'dialog-actions' },
      el('button', { class: 'btn', onclick: () => dialog.close('cancel') }, 'Cancel'),
      el('button', { class: `btn ${danger ? 'confirm' : 'primary'}`, onclick: () => dialog.close('ok') }, ok)),
  );
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true }));
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3000);
}

// Instagram's CDN blocks cross-origin <img> embeds, so avatars are fetched
// through the extension (which has host access), only once they're near view.
const avatarCache = new Map();
const avatarObserver = new IntersectionObserver((entries) => {
  for (const { isIntersecting, target } of entries) {
    if (!isIntersecting) continue;
    avatarObserver.unobserve(target);
    loadAvatar(target);
  }
}, { root: $('#listWrap'), rootMargin: '200px' });

async function loadAvatar(node) {
  const url = node.dataset.src;
  try {
    if (!avatarCache.has(url)) {
      avatarCache.set(url, fetch(url).then((r) => (r.ok ? r.blob() : Promise.reject())).then(URL.createObjectURL));
    }
    node.replaceChildren(el('img', { src: await avatarCache.get(url), alt: '' }));
  } catch {
    avatarCache.delete(url); // keep the initial
  }
}

function avatar(u, cls = 'avatar') {
  const node = el('div', { class: cls }, (u.u || '?')[0]);
  if (u.p) {
    node.dataset.src = u.p;
    if (cls.includes('me')) loadAvatar(node);
    else avatarObserver.observe(node);
  }
  return node;
}

const verifiedIcon = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'verified');
  svg.innerHTML = '<path fill="currentColor" d="M12 1l2.9 2.1 3.6-.1 1.1 3.4 2.9 2.1-1.1 3.5 1.1 3.5-2.9 2.1-1.1 3.4-3.6-.1L12 23l-2.9-2.1-3.6.1-1.1-3.4-2.9-2.1 1.1-3.5L1.5 8.5l2.9-2.1 1.1-3.4 3.6.1z"/><path fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M7.5 12.2l3 3 6-6.2"/>';
  return svg;
};

// ---------------------------------------------------------------- data

// Who followed you in an imported data download but doesn't now.
// Matched by username (downloads carry no account ids), so a renamed or
// deactivated account shows up here too.
function sinceDownload(imported, followers, following) {
  if (!imported || !Object.keys(followers).length) return [];
  const followerNames = new Set(Object.values(followers).map((u) => u.u.toLowerCase()));
  const followingByName = new Map(Object.entries(following).map(([id, u]) => [u.u.toLowerCase(), { id, ...u }]));
  return imported.usernames
    .filter((n) => !followerNames.has(n))
    .map((n) => ({ id: null, u: n, n: '', p: '', v: false, ...followingByName.get(n), t: 'imported', at: imported.asOf }))
    .sort((a, b) => (!!b.id - !!a.id) || a.u.localeCompare(b.u)); // ones you still follow first
}

function derive(acct, imported) {
  const followers = acct?.followers || {};
  const following = acct?.following || {};
  const events = acct?.events || [];
  const newestFirst = (types) => events.filter((e) => types.includes(e.t)).reverse();
  const weekAgo = Date.now() - 7 * DAY;
  const recent = (t) => new Set(events.filter((e) => e.t === t && e.at > weekAgo).map((e) => e.id));

  const lostAt = new Map();
  for (const e of events) if (e.t === 'lost') lostAt.set(e.id, e.at);

  // When each follower followed you. Exact dates come from an imported data
  // download (by username); otherwise the scan that first saw them, or, for
  // anyone already there at the first scan, "before" that date.
  const gainedAt = new Map(); // id → [times seen gained]
  for (const e of events) if (e.t === 'gained') gainedAt.set(e.id, [...(gainedAt.get(e.id) || []), e.at]);
  const downloadDates = imported?.followedAt || {};
  const sinceOf = (id, username, asOf = Date.now()) => {
    const tracked = (gainedAt.get(id) || []).filter((t) => t <= asOf).pop();
    const exact = downloadDates[String(username || '').toLowerCase()];
    // A follow seen after the download means they (re)followed later.
    if (tracked && (!exact || tracked > (imported.latestAsOf || imported.asOf))) return { at: tracked, kind: 'tracked' };
    if (exact && exact <= asOf) return { at: exact, kind: 'exact' };
    if (acct?.baselineAt && acct.baselineAt <= asOf) return { at: acct.baselineAt, kind: 'before' };
    return null;
  };

  const asList = (map) => Object.entries(map).map(([id, u]) => ({ id, ...u }));
  const followingList = asList(following);
  const followersList = asList(followers).map((u) => ({ ...u, since: sinceOf(u.id, u.u) }));
  const recentFollowed = recent('followed');
  const recentGained = recent('gained');

  return {
    followers,
    following,
    lostAt,
    sinceOf,
    hasExactDates: Object.keys(downloadDates).length > 0,
    lists: {
      activity: {
        lost: newestFirst(['lost', 'gone']),
        gained: newestFirst(['gained']),
        mine: newestFirst(['followed', 'unfollowed']),
        download: sinceDownload(imported, followers, following),
      },
      following: {
        all: followingList,
        unfollowedYou: followingList
          .filter((u) => lostAt.has(u.id) && !followers[u.id])
          .sort((a, b) => lostAt.get(b.id) - lostAt.get(a.id)),
        notBack: followingList.filter((u) => !followers[u.id]),
        new: followingList.filter((u) => recentFollowed.has(u.id)),
      },
      followers: {
        all: followersList,
        // Longest-standing first; unknown dates go last.
        loyal: [...followersList].sort((a, b) => (a.since?.at ?? Infinity) - (b.since?.at ?? Infinity)),
        notFollowed: followersList.filter((u) => !following[u.id]),
        new: followersList.filter((u) => recentGained.has(u.id)),
      },
    },
  };
}

const hasBaseline = () => !!state?.acct?.followers;
const scanning = () => !!state?.progress?.running;
const pausedUntil = () => (state?.cooldownUntil > Date.now() ? state.cooldownUntil : null);
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
// When Scan unlocks again: after a rate-limit pause, or 15 min after the last scan.
const lockedUntil = () => (state?.scanLock?.until > Date.now() ? state.scanLock.until : null);

function timeLeft(until) {
  const s = Math.max(0, Math.ceil((until - Date.now()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}h ${pad(m)}m` : `${m}:${pad(s % 60)}`;
}

// A live countdown; the ticker below updates every [data-until] node each second.
const countdown = (until) => el('span', { class: 'countdown', 'data-until': until }, timeLeft(until));

// Runs while Scan is locked or "Unfollow all" is going.
let lockTicker = null;
function syncTicker() {
  const needed = !!(lockedUntil() || state?.queue);
  if (needed && !lockTicker) {
    lockTicker = setInterval(() => {
      document.querySelectorAll('[data-until]').forEach((n) => (n.textContent = timeLeft(Number(n.dataset.until))));
      if (state?.scanLock && !lockedUntil()) {
        state.scanLock = null;
        refresh(); // unlocked: bring the Scan button back
      }
    }, 1000);
  } else if (!needed && lockTicker) {
    clearInterval(lockTicker);
    lockTicker = null;
  }
}

// "Scan" link inside a note, or the countdown while scanning is locked.
const scanLink = (label) => (lockedUntil()
  ? el('span', { class: 'muted' }, 'Scan unlocks in ', countdown(lockedUntil()))
  : el('button', { class: 'link', onclick: startScan }, label));

async function refresh() {
  const res = await send('state');
  if (!res?.ok) return;
  state = res.data;
  derived = derive(state.acct, state.imported);
  render({ keepScroll: true });
}

let refreshTimer;
function refreshSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 120);
}

// ---------------------------------------------------------------- render

let pauseTimer;

function render({ keepScroll = false } = {}) {
  // Re-render when the rate-limit pause runs out so Scan comes back by itself.
  clearTimeout(pauseTimer);
  if (pausedUntil()) pauseTimer = setTimeout(refresh, pausedUntil() - Date.now() + 1000);
  syncTicker();
  renderHeader();
  renderStats();
  renderProgress();
  renderNote();
  renderTabs();
  renderBulk();
  renderList(keepScroll);
}

function renderHeader() {
  const { acct, live, loggedInId } = state;
  const username = acct?.username || live?.username;
  $('#handle').textContent = username ? `@${username}` : 'Unfollow Watch';
  $('#meAvatar').replaceWith(Object.assign(avatar({ u: username || '·', p: acct?.pic || live?.pic }, 'avatar me'), { id: 'meAvatar' }));
  $('#lastScan').textContent = !loggedInId
    ? 'Not logged in'
    : acct?.lastScan ? `Scanned ${timeAgo(acct.lastScan)}` : 'Not scanned yet';
}

function deltaNodes(plus, minus) {
  if (plus == null) return [];
  if (!plus && !minus) return ['No change'];
  const out = [];
  if (plus) out.push(el('span', { class: 'up' }, `+${fmt(plus)}`));
  if (plus && minus) out.push(' ');
  if (minus) out.push(el('span', { class: 'down' }, `−${fmt(minus)}`));
  return out;
}

function renderStats() {
  const { acct, live } = state;
  const lists = derived.lists;
  const followers = live?.followers ?? acct?.igCounts?.followers ?? (hasBaseline() ? lists.followers.all.length : null);
  const following = live?.following ?? acct?.igCounts?.following ?? (hasBaseline() ? lists.following.all.length : null);
  $('#followersNum').textContent = fmt(followers);
  $('#followingNum').textContent = fmt(following);
  $('#stillNum').textContent = hasBaseline() ? fmt(lists.following.notBack.length) : '–';
  const tracked = lists.following.unfollowedYou.length;
  $('#stillDelta').textContent = tracked ? `${fmt(tracked)} unfollowed you` : 'of people you follow';

  const d = acct?.delta;
  $('#followersDelta').replaceChildren(...deltaNodes(d?.gained, d?.lost));
  $('#followingDelta').replaceChildren(...deltaNodes(d?.followed, d?.unfollowed));
  document.querySelectorAll('.stat .delta:not(.muted)').forEach((n) => {
    n.title = d ? 'Change at the last scan' : '';
  });
}

function renderProgress() {
  const p = state.progress;
  const running = scanning();
  $('#progress').hidden = !running;
  const locked = !running && lockedUntil();
  const btn = $('#scanBtn');
  btn.disabled = running || !!locked || !state.loggedInId;
  if (locked) btn.replaceChildren('Scan in ', countdown(locked));
  else btn.textContent = running ? 'Scanning…' : 'Scan';
  btn.title = !locked ? ''
    : state.scanLock.reason === 'limit'
      ? `Instagram is limiting requests. Scan unlocks at ${clock(locked)}.`
      : `Scans are spaced 15 minutes apart so Instagram doesn't limit them. Scan unlocks at ${clock(locked)}.`;
  syncTicker();
  document.querySelectorAll('.list .btn').forEach((b) => (b.disabled = running));
  if (!running) return;

  const totalFollowing = p.phase === 'following' ? p.total : state.live?.following;
  const totalFollowers = p.phase === 'followers' ? p.total : state.live?.followers;
  const fill = $('#progressFill');
  let text = 'Starting scan…';
  let pct = null;
  if (p.phase === 'following') {
    text = `Reading who you follow · ${fmt(p.count)}${p.total ? ` of ${fmt(p.total)}` : ''}`;
    if (totalFollowing && totalFollowers) pct = p.count / (totalFollowing + totalFollowers);
  } else if (p.phase === 'followers') {
    text = `Reading your followers · ${fmt(p.count)}${p.total ? ` of ${fmt(p.total)}` : ''}`;
    if (totalFollowing && totalFollowers) pct = (totalFollowing + p.count) / (totalFollowing + totalFollowers);
  }
  $('#progressText').textContent = p.note || text;
  fill.classList.toggle('indeterminate', pct == null);
  fill.style.width = pct == null ? '' : `${Math.min(100, pct * 100).toFixed(1)}%`;
}

// Instagram's last refusal, so a failure can be told apart from a real limit.
function refusalDetail() {
  const r = state.lastRefusal;
  if (!r || Date.now() - r.at > 60 * 60 * 1000) return '';
  const via = r.via === 'tab' ? 'from instagram.com' : 'from the extension';
  return el('div', { class: 'detail' }, `Instagram's reply ${via}: HTTP ${r.status}${r.message ? ` “${r.message}”` : ''} · ${timeAgo(r.at)}`);
}

function pauseNodes() {
  return [
    'Instagram is limiting requests, so scanning is paused for ',
    countdown(pausedUntil()),
    ` (until ${clock(pausedUntil())}). Waiting lets the limit clear.`,
    refusalDetail(),
  ];
}

function renderNote() {
  const note = $('#note');
  const { progress, acct, live, loggedInId } = state;
  note.className = 'note';
  note.hidden = true;
  if (!loggedInId || scanning()) return;

  if (pausedUntil()) {
    note.classList.add('error');
    note.replaceChildren(...pauseNodes());
    note.hidden = false;
    return;
  }
  if (progress?.code === 'RATE_LIMIT') {
    // The pause is over; the stored error ("paused until …") is out of date.
    note.replaceChildren(
      'Instagram’s limit should have cleared by now. ',
      scanLink('Scan again'),
    );
    note.hidden = false;
    return;
  }
  if (progress?.error) {
    note.classList.add('error');
    note.replaceChildren(progress.error, refusalDetail());
    note.hidden = false;
    return;
  }
  if (live && acct?.igCounts && hasBaseline()) {
    const df = live.followers - acct.igCounts.followers;
    const dg = live.following - acct.igCounts.following;
    if (df || dg) {
      const sign = (n) => (n > 0 ? `+${fmt(n)}` : `−${fmt(-n)}`);
      const parts = [];
      if (df) parts.push(`${sign(df)} followers`);
      if (dg) parts.push(`${sign(dg)} following`);
      note.replaceChildren(
        `Instagram shows ${parts.join(', ')} since your last scan. `,
        scanLink('Scan to see who'),
      );
      note.hidden = false;
    }
  }
}

function renderTabs() {
  const lists = derived.lists;
  $('#followingTab').textContent = hasBaseline() ? fmt(lists.following.all.length) : '';
  $('#followersTab').textContent = hasBaseline() ? fmt(lists.followers.all.length) : '';
  document.querySelectorAll('.tab').forEach((t) => {
    const active = t.dataset.view === ui.view;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
  });

  const current = ui.filters[ui.view];
  $('#chips').replaceChildren(
    ...FILTERS[ui.view].map(([key, label]) => {
      const n = lists[ui.view][key].length;
      return el('button', {
        class: `chip${key === current ? ' active' : ''}`,
        role: 'tab',
        'aria-selected': String(key === current),
        onclick: () => setView(ui.view, key),
        // "All" repeats the tab's own count, so it goes without one.
      }, label, key !== 'all' && (hasBaseline() || n) ? el('span', { class: 'count' }, fmt(n)) : null);
    }),
  );
  $('.toolbar').hidden = !hasBaseline() && !state.acct?.events?.length;
}

function buildItems() {
  const source = derived.lists[ui.view][ui.filters[ui.view]];
  const q = ui.query.trim().toLowerCase().replace(/^@/, '');
  const matches = q
    ? source.filter((u) => u.u?.toLowerCase().includes(q) || u.n?.toLowerCase().includes(q))
    : source;
  if (ui.view === 'followers' && ui.filters.followers === 'loyal' && matches.length) {
    const head = derived.hasExactDates
      ? 'Longest-following first'
      : 'Exact dates need your Instagram data download (Settings → Import)';
    return [{ group: head }, ...matches];
  }
  if (ui.view !== 'activity') return matches;
  if (ui.filters.activity === 'download') {
    return matches.length ? [{ group: `Unfollowed you since your data download (${longDate(state.imported.asOf)})` }, ...matches] : [];
  }

  // Activity is grouped by day.
  const out = [];
  let last = '';
  for (const e of matches) {
    const label = dayLabel(e.at);
    if (label !== last) out.push({ group: label });
    last = label;
    out.push(e);
  }
  return out;
}

function renderList(keepScroll) {
  const keep = keepScroll ? Math.max(ui.rendered, CHUNK) : CHUNK;
  if (!keepScroll) $('#listWrap').scrollTop = 0;
  ui.items = buildItems();
  ui.rendered = 0;
  $('#list').replaceChildren();
  appendRows(keep);
  renderEmpty();
}

function appendRows(count = CHUNK) {
  const next = ui.items.slice(ui.rendered, ui.rendered + count);
  $('#list').append(...next.map((it) => (it.group ? el('li', { class: 'group' }, it.group) : row(it))));
  ui.rendered += next.length;
}

$('#listWrap').addEventListener('scroll', (e) => {
  const w = e.currentTarget;
  if (ui.rendered < ui.items.length && w.scrollTop + w.clientHeight > w.scrollHeight - 400) appendRows();
}, { passive: true });

function subline(item) {
  const iFollow = !!derived.following[item.id];
  const followsMe = !!derived.followers[item.id];
  const warn = (t) => el('span', { class: 'warn' }, t);

  if (ui.view === 'activity') {
    switch (item.t) {
      case 'gone': return 'Deactivated, deleted, or blocked you';
      case 'lost': {
        const status = followsMe ? 'Followed you again' : iFollow ? warn('You still follow them') : "You don't follow them";
        const s = derived.sinceOf(item.id, item.u, item.at - 1);
        if (!s || s.at >= item.at) return status;
        return [status, ` · followed you for ${s.kind === 'before' ? 'over ' : ''}${duration(item.at - s.at)}`];
      }
      case 'gained': return !followsMe ? 'Unfollowed you since' : iFollow ? 'You follow each other' : 'Follows you';
      case 'followed': return !iFollow ? 'You followed, then unfollowed' : followsMe ? 'You followed · follows you back' : ['You followed · ', warn("doesn't follow back")];
      case 'unfollowed': return 'You unfollowed';
      case 'imported': {
        const status = iFollow ? warn('You still follow them') : "You don't follow them";
        const s = derived.sinceOf(null, item.u, item.at);
        return s?.kind === 'exact' ? [status, ` · followed you from ${longDate(s.at)}`] : status;
      }
      default: return item.n;
    }
  }
  if (ui.view === 'following') {
    const lostAt = derived.lostAt.get(item.id);
    if (!followsMe && lostAt) return warn(`Unfollowed you ${timeAgo(lostAt)}`);
    if (!followsMe) return [item.n, item.n ? ' · ' : '', "Doesn't follow you back"];
  }
  if (ui.view === 'followers') {
    const since = sinceText(item.since);
    const lead = since || item.n;
    return [lead, iFollow ? (lead ? ' · mutual' : 'You follow each other') : ''];
  }
  return item.n;
}

function row(item) {
  const iFollow = !!derived.following[item.id];
  const followsMe = !!derived.followers[item.id];
  const busy = scanning();

  let action = null;
  if (iFollow && item.t !== 'gone' && ui.view !== 'followers') {
    action = el('button', { class: 'btn small', disabled: busy }, 'Unfollow');
    action.addEventListener('click', () => onUnfollow(item, action));
  } else if (followsMe && !iFollow) {
    action = el('button', { class: 'btn small primary', disabled: busy }, 'Follow back');
    action.addEventListener('click', () => onFollow(item, action));
  }

  const unseen = ui.view === 'activity' && item.t === 'lost' && item.at > seenBefore;
  const sub = [subline(item)].flat().filter((x) => x != null && x !== '');

  return el('li', { class: `item${unseen ? ' unseen' : ''}` },
    avatar(item),
    el('div', { class: 'info' },
      el('div', { class: 'name' },
        el('a', { href: `https://www.instagram.com/${encodeURIComponent(item.u)}/`, target: '_blank', rel: 'noreferrer' }, item.u),
        item.v ? verifiedIcon() : null,
      ),
      el('div', { class: 'sub' }, ...(sub.length ? sub : [' '])),
    ),
    action,
  );
}

function renderEmpty() {
  const empty = $('#empty');
  empty.hidden = ui.items.length > 0;
  if (empty.hidden) return;

  const { loggedInId, live } = state;
  if (!loggedInId) {
    empty.replaceChildren(
      el('h2', {}, 'Log in to Instagram'),
      el('p', {}, 'Log in at instagram.com in this browser, then open this again.'),
      el('a', { class: 'btn primary', href: 'https://www.instagram.com/accounts/login/', target: '_blank', style: 'display:inline-flex;align-items:center;text-decoration:none' }, 'Open Instagram'),
    );
    return;
  }
  if (!hasBaseline() && (ui.view !== 'activity' || !state.acct?.events?.length)) {
    const total = (live?.followers || 0) + (live?.following || 0);
    // ~3 s per page of 50, plus breaks
    const minutes = total ? Math.max(1, Math.round((total / 50) * 3.5 / 60)) : null;
    const err = !scanning() && !pausedUntil() && state.progress?.error;
    let action = el('button', { class: 'btn primary', onclick: startScan }, err ? 'Try the first scan again' : 'Run first scan');
    if (scanning()) action = null;
    // The note above explains a pause; here the button just counts down.
    else if (lockedUntil()) action = el('button', { class: 'btn primary', disabled: true }, 'Scan in ', countdown(lockedUntil()));
    empty.replaceChildren(
      el('h2', {}, scanning() ? 'Running your first scan' : 'Start with a first scan'),
      el('p', {},
        'The first scan saves who follows you and who you follow, and right away shows who doesn’t follow you back. Every scan after that shows exactly who unfollowed you, who is new, and what changed.',
        minutes ? ` It takes about ${minutes} min for your account.` : ''),
      ...[err ? el('p', { class: 'error' }, `The last attempt failed: ${err}`) : null, action].filter(Boolean),
    );
    return;
  }

  if (ui.query.trim()) {
    empty.replaceChildren(el('p', {}, `No results for “${ui.query.trim()}”.`));
    return;
  }
  if (ui.view === 'activity' && ui.filters.activity === 'download') {
    empty.replaceChildren(...downloadEmptyNodes());
    return;
  }
  const since = state.acct?.baselineAt ? shortDate(state.acct.baselineAt) : 'your first scan';
  const messages = {
    'activity:lost': `Nobody has unfollowed you since ${since}. To see who doesn’t follow you back right now, open Following → Don’t follow back.`,
    'activity:gained': `No new followers since ${since}.`,
    'activity:mine': `You haven't followed or unfollowed anyone since ${since}.`,
    'following:all': "You don't follow anyone.",
    'following:unfollowedYou': 'Nobody who unfollowed you is still in your following.',
    'following:notBack': 'Everyone you follow follows you back.',
    'following:new': 'You haven’t followed anyone in the last 7 days.',
    'followers:all': 'No followers yet.',
    'followers:notFollowed': 'You follow everyone who follows you.',
    'followers:loyal': 'No followers yet.',
    'followers:new': 'No new followers in the last 7 days.',
  };
  empty.replaceChildren(el('p', {}, messages[`${ui.view}:${ui.filters[ui.view]}`]));
}

function downloadEmptyNodes() {
  const imp = state.imported;
  if (imp) {
    return [
      el('h2', {}, 'Nobody left since your download'),
      el('p', {}, `Everyone who followed you in your data download from ${longDate(imp.asOf)} still follows you.`),
      el('button', { class: 'btn', onclick: startImport }, 'Import another download'),
    ];
  }
  return [
    el('h2', {}, 'Import your Instagram data download'),
    el('p', {},
      'A download has the date each follower followed you, so you can see who has stuck with you longest (Followers → Loyal). ',
      'An older download also shows who unfollowed you since it was made.'),
    el('p', {},
      'Get one in Instagram: Accounts Center → Your information and permissions → Download your information → Some of your information → Followers and following, format JSON. ',
      'Already have one? Look for instagram-yourname-….zip.'),
    el('button', { class: 'btn primary', onclick: startImport }, 'Import data download'),
  ];
}

// ---------------------------------------------------------------- unfollow all

const UNFOLLOW_PER_DAY = 150; // keep in step with background.js
const AVG_GAP_SEC = 67.5;

// Offered on Following → Don't follow back. While it runs, its status shows
// on every list.
function renderBulk() {
  const bar = $('#bulk');
  const q = state?.queue;
  const onNotBack = ui.view === 'following' && ui.filters.following === 'notBack' && hasBaseline();
  bar.hidden = !q && !onNotBack;
  if (bar.hidden) return;

  if (q) {
    let status;
    if (q.paused) status = el('span', { class: q.paused.reason === 'user' ? '' : 'error' }, q.paused.message);
    else if (q.wait === 'daily') status = [`Reached today’s limit of ${UNFOLLOW_PER_DAY}. Continues in `, countdown(q.nextAt)];
    else if (q.wait === 'limit') status = ['Instagram is limiting requests. Continues in ', countdown(q.nextAt)];
    else status = ['Next unfollow in ', countdown(q.nextAt), ` · ${fmt(q.items.length)} left`];
    bar.replaceChildren(
      el('div', { class: 'grow' },
        el('div', { class: 'bulk-title' }, `Unfollow all · ${fmt(q.done)} of ${fmt(q.total)} done`,
          q.skipped ? ` · ${fmt(q.skipped)} skipped` : '', q.failed ? ` · ${fmt(q.failed)} failed` : ''),
        el('div', { class: 'bulk-sub' }, ...[status].flat())),
      el('button', { class: 'btn small', onclick: () => send('pauseUnfollowAll', { paused: !q.paused }).then(refresh) }, q.paused ? 'Resume' : 'Pause'),
      el('button', { class: 'btn small danger-text', onclick: stopBulk }, 'Stop'),
    );
    return;
  }

  const n = derived.lists.following.notBack.length;
  if (!n) {
    bar.hidden = true;
    return;
  }
  const acct = state.acct;
  const why = Date.now() - acct.lastScan > DAY ? 'Your last scan is over a day old. Scan again first.' : null;
  bar.replaceChildren(
    el('div', { class: 'grow bulk-sub' }, why || `${fmt(n)} accounts you follow don't follow you back.`),
    el('button', { class: 'btn small danger-text', disabled: !!why || scanning(), onclick: startBulk }, `Unfollow all ${fmt(n)}`),
  );
}

async function startBulk() {
  const list = derived.lists.following.notBack;
  const n = list.length;
  const days = Math.ceil(n / UNFOLLOW_PER_DAY);
  const duration = days > 1
    ? `All ${fmt(n)} will take about ${days} days.`
    : `This takes about ${Math.max(1, Math.round((n * AVG_GAP_SEC) / 60))} minutes.`;
  const ok = await ask({
    title: `Unfollow all ${fmt(n)} accounts that don't follow you back?`,
    body: [
      `Instagram blocks accounts that unfollow too fast, so this runs slowly in the background: about one account a minute, at most ${UNFOLLOW_PER_DAY} a day. ${duration} Your browser needs to stay open.`,
      'Anyone who follows you back before their turn is skipped. You can pause or stop at any time.',
    ],
    ok: `Unfollow all ${fmt(n)}`,
    danger: true,
  });
  if (!ok) return;
  const res = await send('unfollowAll', { ids: list.map((u) => u.id) });
  if (!res?.ok) {
    toast(res?.error || 'Couldn’t start Unfollow all.');
    return;
  }
  toast('Started. You can close this; it keeps going in the background.');
  refresh();
}

async function stopBulk() {
  if (!(await ask({ title: 'Stop Unfollow all?', body: ['Accounts already unfollowed stay unfollowed.'], ok: 'Stop', danger: true }))) return;
  await send('stopUnfollowAll');
  refresh();
}

// ---------------------------------------------------------------- import

// The file picker closes the toolbar popup on some systems, so the import
// runs from the same page opened in a full tab.
async function startImport() {
  if (!(await ext.tabs.getCurrent())) {
    ext.tabs.create({ url: ext.runtime.getURL('popup.html#import') });
    window.close();
    return;
  }
  $('#importFile').value = '';
  $('#importFile').click();
}

$('#importFile').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  if (!files.length) return;
  toast('Reading your data download…');
  let result;
  try {
    result = await readInstagramExport(files);
  } catch (err) {
    toast(err.message);
    return;
  }

  // A download from someone else's account would look like everyone unfollowed you.
  if (hasBaseline() && result.usernames.length > 20) {
    const current = new Set(Object.values(derived.followers).map((u) => u.u.toLowerCase()));
    const share = result.usernames.filter((n) => current.has(n)).length / result.usernames.length;
    if (share < 0.2 && !(await ask({
      title: 'Import this download anyway?',
      body: [`Only ${Math.round(share * 100)}% of the accounts in this download follow you now. It may be from a different Instagram account.`],
      ok: 'Import',
    }))) return;
  }

  const res = await send('saveImport', { data: result });
  if (!res?.ok) {
    toast(res?.error || 'Import failed.');
    return;
  }
  state.imported = res.data;
  derived = derive(state.acct, state.imported);
  if (ui.settingsOpen) $('#settingsBtn').click();
  render();
  const dated = Object.keys(result.followedAt || {}).length;
  const recent = Date.now() - result.asOf < 3 * DAY;
  if (!hasBaseline()) {
    toast(`Imported ${fmt(result.usernames.length)} followers${dated ? ' with follow dates' : ''}. Run a scan to compare them with today’s.`);
  } else if (recent || res.data.keptOlder) {
    // A fresh download is mainly useful for its dates.
    setView('followers', 'loyal');
    toast(dated ? `Added follow dates for ${fmt(dated)} followers. Sorted longest-following first.` : 'Imported, but this download has no follow dates.');
  } else {
    setView('activity', 'download');
    toast(`${fmt(derived.lists.activity.download.length)} people unfollowed you since ${longDate(result.asOf)}${dated ? ', and follow dates were added' : ''}.`);
  }
});

function renderImportSetting() {
  const imp = state.imported;
  $('#importHelp').textContent = imp
    ? `Comparing with your download from ${longDate(imp.asOf)} (${fmt(imp.usernames.length)} followers). Follow dates known for ${fmt(Object.keys(imp.followedAt || {}).length)}.`
    : 'See when each follower followed you, and who left since an older download.';
  $('#removeImportBtn').hidden = !imp;
}

$('#importBtn').addEventListener('click', startImport);
$('#removeImportBtn').addEventListener('click', async () => {
  if (!(await ask({ title: 'Remove the imported data download?', ok: 'Remove', danger: true }))) return;
  await send('removeImport');
  state.imported = null;
  derived = derive(state.acct, null);
  renderImportSetting();
  render({ keepScroll: true });
});

// ---------------------------------------------------------------- actions

function setView(view, filter) {
  ui.view = view;
  if (filter) ui.filters[view] = filter;
  renderTabs();
  renderBulk();
  renderList(false);
}

async function startScan() {
  if (lockedUntil()) {
    toast(`Scan unlocks in ${timeLeft(lockedUntil())} (at ${clock(lockedUntil())}).`);
    return;
  }
  state.progress = { running: true, phase: 'profile' };
  renderProgress();
  renderNote();
  renderEmpty();
  const res = await send('scan');
  if (!res?.ok) toast(res?.error || 'The scan could not start.');
  if (res?.ok) {
    const { lost, gained, baseline } = res.data;
    if (baseline) {
      // Nothing to diff yet, so open the list that is useful right now.
      await refresh();
      setView('following', 'notBack');
      toast(`Baseline saved. ${fmt(derived.lists.following.notBack.length)} people you follow don't follow you back.`);
      return;
    }
    else if (!lost && !gained) toast('No changes since the last scan.');
    else toast([lost && `${lost} unfollowed you`, gained && `${gained} new followers`].filter(Boolean).join(' · '));
  }
  refresh();
}

async function onUnfollow(item, btn) {
  btn.disabled = true;
  btn.textContent = 'Unfollowing…';
  const res = await send('unfollow', { id: item.id });
  if (res?.ok) {
    toast(`Unfollowed @${item.u}`);
  } else {
    btn.disabled = false;
    btn.textContent = 'Unfollow';
    toast(res?.error || 'Unfollow failed.');
  }
}

async function onFollow(item, btn) {
  btn.disabled = true;
  btn.textContent = 'Following…';
  const res = await send('follow', { id: item.id });
  if (res?.ok) {
    if (res.data.requested) {
      btn.textContent = 'Requested';
      btn.classList.remove('primary');
      toast(`Follow request sent to @${item.u}`);
    } else {
      toast(`You're following @${item.u}`);
    }
  } else {
    btn.disabled = false;
    btn.textContent = 'Follow back';
    toast(res?.error || 'Follow failed.');
  }
}

// ---------------------------------------------------------------- events

$('#scanBtn').addEventListener('click', startScan);

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));

document.querySelectorAll('.stat').forEach((s) =>
  s.addEventListener('click', () => {
    const [view, filter] = s.dataset.go.split(':');
    setView(view, filter);
  }),
);

$('#search').addEventListener('input', (e) => {
  ui.query = e.target.value;
  renderList(false);
});

$('#settingsBtn').addEventListener('click', () => {
  ui.settingsOpen = !ui.settingsOpen;
  $('#settings').hidden = !ui.settingsOpen;
  $('#main').hidden = ui.settingsOpen;
  $('#settingsBtn').setAttribute('aria-expanded', String(ui.settingsOpen));
  if (ui.settingsOpen) {
    const s = state.settings;
    $('#checkMinutes').value = String(s.checkMinutes);
    $('#notifyLost').checked = s.notifyLost;
    $('#notifyGained').checked = s.notifyGained;
    renderImportSetting();
  }
});

const saveSetting = (settings) => send('saveSettings', { settings }).then((r) => r?.ok && (state.settings = r.data));
$('#checkMinutes').addEventListener('change', (e) => saveSetting({ checkMinutes: Number(e.target.value) }));
$('#notifyLost').addEventListener('change', (e) => saveSetting({ notifyLost: e.target.checked }));
$('#notifyGained').addEventListener('change', (e) => saveSetting({ notifyGained: e.target.checked }));

$('#resetBtn').addEventListener('click', async () => {
  if (!(await ask({
    title: 'Clear saved data?',
    body: ['This deletes the saved lists and history for this account. The next scan starts a new baseline.'],
    ok: 'Clear',
    danger: true,
  }))) return;
  await send('reset');
  $('#settingsBtn').click();
  refresh();
});

ext.storage.onChanged.addListener((changes) => {
  if (!state) return;
  if (changes.progress) {
    const wasRunning = scanning();
    state.progress = changes.progress.newValue || null;
    renderProgress();
    if (wasRunning !== scanning()) {
      renderNote();
      renderEmpty();
    }
  }
  if (changes.rateLimit || changes.unfollowQueue || Object.keys(changes).some((k) => k.startsWith('acct:') || k.startsWith('live:'))) refreshSoon();
});

// ---------------------------------------------------------------- boot

(async () => {
  const res = await send('state');
  if (!res?.ok) return;
  state = res.data;
  derived = derive(state.acct, state.imported);
  seenBefore = state.acct?.seenAt ?? Date.now();
  if (location.hash === '#import') {
    ui.view = 'activity';
    ui.filters.activity = 'download';
  }
  render();
  if (state.loggedInId) {
    send('seen');
    // Current counts straight from Instagram (cached for a few minutes).
    send('live').then((r) => {
      if (!r?.ok || !r.data) return;
      state.live = r.data;
      renderHeader();
      renderStats();
      renderNote();
      if (!hasBaseline()) renderEmpty();
    });
  }
})();
