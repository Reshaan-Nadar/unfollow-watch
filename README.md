# Unfollow Watch for Instagram

A Chrome extension that tracks your Instagram followers and following and tells you **exactly who unfollowed you**: with dates, desktop notifications, and a one-click way to unfollow them back.

Instagram only shows your follower *count*. When it drops from 3,000 to 2,996 there's no way to see who left. Unfollow Watch saves your full followers and following lists, compares every new scan with the previous one, and keeps a dated history of every change.

<p align="center">
  <img src="docs/screenshots/activity.png" width="300" alt="Activity: who unfollowed you, grouped by day">
  &nbsp;
  <img src="docs/screenshots/notback.png" width="300" alt="Following: people who don't follow you back, with Unfollow all running">
</p>

> **Not affiliated with Instagram or Meta.** This extension uses Instagram's own website endpoints with your existing login. Read [Risks and limitations](#risks-and-limitations) before using it.

---

## Contents

- [Features](#features)
- [Installation](#installation)
  - [Supported browsers](#supported-browsers): Chrome, Edge, Brave, Opera, Vivaldi, Firefox
  - [Firefox](#firefox)
  - [Safari and phones](#safari-and-phones)
- [Getting started](#getting-started)
- [How it works](#how-it-works)
- [Why a scan takes several minutes and takes breaks](#why-a-scan-takes-several-minutes-and-takes-breaks)
- [Why "Unfollow all" unfollows only about one account a minute](#why-unfollow-all-unfollows-only-about-one-account-a-minute)
- [Importing your Instagram data download](#importing-your-instagram-data-download)
- [Privacy and permissions](#privacy-and-permissions)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Project structure](#project-structure)
- [Risks and limitations](#risks-and-limitations)

---

## Features

### See who unfollowed you
- **Activity → Unfollowed you** lists everyone who stopped following you, grouped by day (*Today*, *Yesterday*, *Mon, Nov 2*…).
- Each entry says whether **you still follow them**. If you do, there's an **Unfollow** button right there.
- It also shows **how long they had followed you** before leaving (*followed you for 2 yr 3 mo*).
- Accounts that vanished from *both* your lists are labelled **Deactivated, deleted, or blocked you**, so they aren't counted as normal unfollows.

### Current counts at a glance
- **Followers** and **Following** as Instagram reports them right now, plus the change at the last scan (`+12 −5`).
- **Don't follow back**: how many accounts you follow that don't follow you, and how many of them unfollowed you since you started tracking.
- If your counts on Instagram change between scans, a note tells you (*Instagram shows −4 followers since your last scan*) with a link to scan.

### Your full lists, searchable
| Tab | Filters |
| --- | --- |
| **Activity** | Unfollowed you · New followers · Your changes (who *you* followed/unfollowed) · Since download |
| **Following** | All · Unfollowed you · Don't follow back · New (last 7 days) |
| **Followers** | All · Loyal (longest-following first) · You don't follow · New (last 7 days) |

All lists are searchable by username or name. Long lists load as you scroll, so 5,000+ accounts stay fast.

### Act on it
- **Unfollow** and **Follow back** buttons on every relevant row.
- **Unfollow all**: unfollows everyone who doesn't follow you back, slowly and safely, in the background ([why it's slow](#why-unfollow-all-unfollows-only-about-one-account-a-minute)).

### Stay informed
- **Desktop notifications** when someone unfollows you. If it's one person, the notification has an **Unfollow** button (in Chrome-based browsers; [Firefox](#firefox) doesn't support notification buttons).
- Optional notifications for new followers.
- The toolbar **badge** counts unfollows you haven't looked at yet.
- **Automatic checks** in the background while your browser is open.

### Follow dates (optional)
Import Instagram's own data download to see **the exact date each follower followed you**, sort followers by loyalty, and find people who unfollowed you **before you installed the extension**. See [Importing your Instagram data download](#importing-your-instagram-data-download).

<p align="center">
  <img src="docs/screenshots/loyal.png" width="300" alt="Followers sorted longest-following first">
  &nbsp;
  <img src="docs/screenshots/dark.png" width="300" alt="Dark mode">
</p>

---

## Installation

The extension isn't on any extension store. You install it directly from this repository. It takes about a minute.

### Supported browsers

| Browser | Supported | Extensions page |
| --- | :---: | --- |
| Google Chrome | ✅ | `chrome://extensions` |
| Microsoft Edge | ✅ | `edge://extensions` |
| Brave | ✅ | `brave://extensions` |
| Opera / Opera GX | ✅ | `opera://extensions` |
| Vivaldi | ✅ | `vivaldi://extensions` |
| Firefox 140 or newer | ✅ | `about:addons` / `about:debugging` ([see notes](#firefox)) |
| Safari | ❌ | [Why not?](#safari-and-phones) |
| Android / iPhone | ❌ | [Why not?](#safari-and-phones) |

Unfollow Watch is tested in Chrome and Firefox. Edge, Brave, Opera and Vivaldi are built on Chromium, the same engine as Chrome, and run Chrome extensions the same way.

Installing has three steps: [download the files](#1-download-the-files), [load them into your browser](#2-load-it-into-your-browser), and [log in to Instagram](#3-log-in-to-instagram).

### 1. Download the files

Open the [latest release](https://github.com/Reshaan-Nadar/unfollow-watch/releases/latest). Under **Assets** there are two files:

| Your browser | Download |
| --- | --- |
| Chrome, Edge, Brave, Opera, Vivaldi | `unfollow-watch-<version>-chrome.zip` |
| Firefox | `unfollow-watch-<version>-firefox.xpi` |

**Chrome and other Chromium browsers:** extract the ZIP to a folder you'll keep, for example `Documents`. You'll get a folder named `unfollow-watch-<version>-chrome`. The browser runs the extension from this folder, so don't delete or move it afterwards.

**Firefox:** keep the `.xpi` file as it is. Don't extract it.

<details>
<summary>Prefer Git?</summary>

```bash
git clone https://github.com/Reshaan-Nadar/unfollow-watch.git
```

The cloned folder can be loaded in Chrome-based browsers directly. For Firefox, build it first; see [Building from source](#building-from-source).

</details>

### 2. Load it into your browser

Chrome-based browsers all work the same way: open the extensions page, turn on **Developer mode**, click **Load unpacked**, and pick the folder. Only the button locations differ. Firefox works differently and has [its own section](#firefox). Open the section for your browser:

<details>
<summary><b>Google Chrome</b></summary>

1. Type `chrome://extensions` in the address bar and press Enter.
   (Or: menu **⋮ → Extensions → Manage Extensions**.)
2. Turn on **Developer mode** with the toggle in the **top-right** corner.
3. Click **Load unpacked** (top-left).
4. Select the extracted `unfollow-watch-<version>-chrome` folder (the one containing `manifest.json`) and click **Select Folder**.
5. **Pin it:** click the puzzle-piece icon 🧩 in the toolbar, then the pin icon next to **Unfollow Watch**.

Chrome may sometimes show a banner about extensions in developer mode. That's normal for extensions installed this way; close it and keep the extension on.

</details>

<details>
<summary><b>Microsoft Edge</b></summary>

1. Type `edge://extensions` in the address bar and press Enter.
   (Or: menu **⋯ → Extensions → Manage extensions**.)
2. Turn on **Developer mode** with the toggle in the **left sidebar**. If the window is narrow, open the sidebar with the ☰ button first.
3. Click **Load unpacked**, which appears at the top once developer mode is on.
4. Select the extracted `unfollow-watch-<version>-chrome` folder (the one containing `manifest.json`) and click **Select Folder**.
5. **Pin it:** click the puzzle-piece **Extensions** icon in the toolbar, then the eye icon (**Show in toolbar**) next to **Unfollow Watch**.

When Edge starts, it may show **"Turn off extensions in developer mode"**. Close that message with **✕**. Don't click *Turn off extensions*, or Unfollow Watch will be disabled.

</details>

<details>
<summary><b>Brave</b></summary>

1. Type `brave://extensions` in the address bar and press Enter.
   (Or: menu **≡ → Extensions**.)
2. Turn on **Developer mode** with the toggle in the **top-right** corner.
3. Click **Load unpacked** (top-left).
4. Select the extracted `unfollow-watch-<version>-chrome` folder (the one containing `manifest.json`) and click **Select Folder**.
5. **Pin it:** click the puzzle-piece icon in the toolbar, then the pin icon next to **Unfollow Watch**.

Brave Shields don't affect the extension, so you don't need to change any Shields settings.

</details>

<details>
<summary><b>Opera / Opera GX</b></summary>

1. Type `opera://extensions` in the address bar and press Enter, or press **Ctrl+Shift+E** (**⌘+Shift+E** on Mac).
2. Turn on **Developer mode** with the toggle in the **top-right** corner.
3. Click **Load unpacked** (top-left).
4. Select the extracted `unfollow-watch-<version>-chrome` folder (the one containing `manifest.json`) and click **Select Folder**.
5. **Pin it:** click the cube-shaped **Extensions** icon in the toolbar, then the pin icon next to **Unfollow Watch**.

</details>

<details>
<summary><b>Vivaldi</b></summary>

1. Type `vivaldi://extensions` in the address bar and press Enter.
   (Or: menu **Tools → Extensions**.)
2. Turn on **Developer mode** with the toggle in the **top-right** corner.
3. Click **Load unpacked** (top-left).
4. Select the extracted `unfollow-watch-<version>-chrome` folder (the one containing `manifest.json`) and click **Select Folder**.
5. The Unfollow Watch icon appears at the right end of the address bar. If you don't see it, click the extensions (puzzle-piece) button there and make it visible.

</details>

### Firefox

Firefox only installs extensions permanently once Mozilla has signed them, and the `.xpi` in the release isn't signed yet. How you install it depends on which Firefox you have. You need Firefox 140 or newer.

**Firefox Developer Edition, Nightly or ESR: permanent install**

These versions let you turn off the signature requirement.

1. Type `about:config` in the address bar, press Enter, and click **Accept the Risk and Continue**.
2. Search for `xpinstall.signatures.required` and double-click it so it says **false**.
3. Type `about:addons` in the address bar, click the gear icon ⚙, and choose **Install Add-on From File…**.
4. Select `unfollow-watch-<version>-firefox.xpi`, then click **Add** when Firefox lists the permissions.
5. **Pin it:** click the puzzle-piece **Extensions** button in the toolbar, then the gear ⚙ next to **Unfollow Watch**, then **Pin to Toolbar**.

**Regular Firefox: temporary install**

Regular Firefox ignores `xpinstall.signatures.required`, so the extension can only be loaded until Firefox closes:

1. Type `about:debugging#/runtime/this-firefox` in the address bar and press Enter.
2. Click **Load Temporary Add-on…** and select `unfollow-watch-<version>-firefox.xpi`.
3. Pin it as in step 5 above.

You need to load it again every time you restart Firefox, and background checks only run while it's loaded. For everyday use on regular Firefox, a signed version is needed.

**How Firefox differs**

- **Notifications have no buttons.** Firefox doesn't support them, so an unfollow alert can't offer **Unfollow** directly. Click the notification instead; Unfollow Watch opens with the list, and you can unfollow from there.
- **Containers are supported.** If you're logged in to Instagram inside a container (for example with the *Facebook Container* or *Multi-Account Containers* add-ons), the extension finds that login. Its requests then go through an instagram.com tab in that container. For scans and unfollows you start, it opens one in the background if needed. Timed background checks never open tabs, so they only run while an Instagram tab is open in that container.
- **The background keeps running.** Firefox's newer extension format stops idle background scripts after about 30 seconds, which would cut long scans and *Unfollow all* short. The Firefox package therefore uses the older format (Manifest V2), whose background keeps running. Mozilla continues to support it.

### 3. Log in to Instagram

Open <https://www.instagram.com> in the **same browser** and log in. The extension uses this login and never asks for your password. If you use several browsers, each one needs its own login, and each keeps its own separate history.

**Allow notifications.** The first unfollow alert relies on your operating system allowing notifications from your browser:
- **Windows:** Settings → System → Notifications → turn on your browser. *Do not disturb* or *Focus* hides them.
- **macOS:** System Settings → Notifications → your browser → turn on *Allow notifications*.

### Updating

**Chrome, Edge, Brave, Opera, Vivaldi**
1. Download the newest `-chrome.zip` and replace the files in your folder with the new ones. Keep the same folder. With Git, run `git pull` instead.
2. Open your browser's extensions page (see the table above) and click the **reload** icon (↻) on the Unfollow Watch card.

**Firefox:** install the newest `-firefox.xpi` the same way you installed the first one. It replaces the old version.

Your saved lists and history are kept, because they're stored in the browser, not in the folder.

### Uninstalling

- **Chrome-based browsers:** open the extensions page and click **Remove** on the Unfollow Watch card, then delete the folder.
- **Firefox:** open `about:addons`, click **⋯** next to Unfollow Watch, and choose **Remove**.

Removing the extension also deletes all its saved data.

### Safari and phones

**Safari isn't supported.** Safari extensions have to be packaged as a macOS app with Apple's Xcode.

**Phones aren't supported.** Instagram's apps don't allow extensions, and mobile Chrome and Safari don't run desktop extensions.

---

## Getting started

1. Click the Unfollow Watch icon, then **Run first scan**.
2. Wait for the scan to finish. For about 3,000 followers and 2,800 following, it takes around **7–8 minutes** ([why](#why-a-scan-takes-several-minutes-and-takes-breaks)). You can close the popup; the scan keeps running.
3. The first scan saves a **baseline**: a snapshot of who follows you and who you follow. It immediately shows **who doesn't follow you back**.
4. From then on, every scan is compared with the previous one. Anyone who unfollows you shows up in **Activity**, and you get a notification.

You don't need to scan by hand after that. The extension checks for changes in the background ([how](#automatic-background-checks)).

<p align="center">
  <img src="docs/screenshots/scanning.png" width="300" alt="A scan in progress">
</p>

---

## How it works

### Detecting unfollows

Instagram doesn't tell anyone who unfollowed them. The only way to find out is to compare the full followers list at two points in time. That's what the extension does:

```mermaid
flowchart LR
    A[Previous scan<br/>followers + following] --> C{Compare}
    B[New scan<br/>followers + following] --> C
    C -->|in old followers, missing now| D[Unfollowed you]
    C -->|missing from both lists| E[Deactivated / blocked you]
    C -->|new in followers| F[New follower]
    C -->|new or missing in following| G[Your changes]
    D --> H[(History +<br/>notification)]
    E --> H
    F --> H
    G --> H
```

Every change is saved with the time of the scan that found it, so the history builds up over time. Unfollows are tracked from your **first scan** onward, because Instagram keeps no record of earlier ones. To look further back, use a [data download](#importing-your-instagram-data-download).

### Automatic background checks

A full scan reads every account in both lists, which is over a hundred requests for a mid-sized account. Running that every hour would get the account rate-limited. So the extension checks cheaply first:

```mermaid
flowchart TD
    T[Timer fires<br/>every hour by default] --> P[Read follower/following counts<br/>from your profile page<br/>1 request]
    P --> Q{Counts changed<br/>since last scan?}
    Q -->|yes| S[Run a full scan]
    Q -->|no| R{Last full scan<br/>over 24 h ago?}
    R -->|yes| S
    R -->|no| Z[Do nothing]
    S --> N[Record changes,<br/>notify you]
```

- The check costs **one request**, the same as opening your profile.
- A **full scan** runs only when the numbers moved, or once a day. The daily scan catches cases where one person unfollowed and another followed, leaving the count unchanged.
- The interval is set in **Settings → Check for changes**: every 30 min, 1 h, 3 h or 6 h, or Off.
- Checks run in the background as long as **your browser is open**. The popup doesn't need to be open. Nothing runs while the browser is closed or the computer is asleep; the next check after that catches up.

### Where the data comes from

The extension calls the same internal endpoints that instagram.com uses when you open your own followers list. It authenticates with your browser's existing Instagram login, so nothing is scraped from a separate session, and your password is never involved.

- **Followers and following** are read 50 accounts at a time.
- **Following** is requested sorted by date followed. Instagram's default order reshuffles while you page through it, which would skip and repeat accounts.
- **Counts** are read from your profile page (*"3,950 Followers, 3,554 Following"*).
- If Instagram refuses a request from the extension, it's retried from inside an instagram.com tab, exactly as the website would send it. When **you** start a scan or an unfollow and no instagram.com tab is open, the extension opens one in the background and closes it about a minute after it's done. Timed background checks never open tabs.
- **Follow and unfollow** requests include the anti-forgery token (`fb_dtsg`) that Instagram requires. It's read from a logged-in instagram.com page and cached for 30 minutes.

### Safeguards against false alerts

| Situation | What the extension does |
| --- | --- |
| Instagram returns an incomplete list (for example, 1,200 of 3,000 followers) | The scan is **discarded** if it got less than 80% of the expected accounts. It isn't saved, so you don't get hundreds of fake "unfollowed you" alerts. |
| An account deactivated, was deleted, or blocked you | If it disappears from **both** your followers and your following, it's labelled *Deactivated, deleted, or blocked you*, not *unfollowed*. |
| Someone unfollows and follows again | They show as *Followed you again* and drop off the "Unfollowed you" lists. |
| The browser closes mid-scan | The partial scan is thrown away; your last complete scan stays as it was. |

---

## Why a scan takes several minutes and takes breaks

**Short answer:** reading thousands of accounts as fast as possible looks like a bot to Instagram. Going slowly keeps your account safe and keeps the scan from being cut off halfway.

### What a scan actually does

Instagram hands out lists **50 accounts at a time**. To read 3,000 followers, the extension asks for page 1, then page 2, and so on: 60 requests just for followers, plus more for following.

A human scrolling through their followers list loads a new page every few seconds. A script with no pauses could fire all 60 requests in under 10 seconds. Instagram watches for exactly that pattern. When it sees it, it:

- answers **"Please wait a few minutes before you try again"** (HTTP 429) and stops returning data, so the scan can't finish;
- may temporarily **restrict the account** or ask you to verify it's you;
- may even return **partial lists**, which would look like a wave of unfollows.

### How the extension paces itself

| Rule | Value | Why |
| --- | --- | --- |
| Pause between pages | **2–4 seconds**, random | Looks like someone scrolling, not a fixed-interval script |
| Longer break | **15–30 seconds every 30 pages** | Breaks up long runs of requests on large accounts. The popup says *"Taking a short break so Instagram doesn't limit the scan…"* |
| If Instagram says "slow down" mid-scan | Waits **2 minutes**, then **5 minutes**, then gives up | The pages already read are kept while it waits, so the scan isn't lost |
| Minimum time between scans | **15 minutes** | The **Scan** button shows a countdown (*Scan in 14:59*) |
| After a real rate limit | Pauses **all** requests for **30 min**, doubling each time it happens again in a row (1 h, 2 h, 4 h, at most 6 h) | Retrying during a limit makes it last longer. The first successful request afterwards resets the pause. |

### How long to expect

Roughly **3.5 seconds per 50 accounts**, plus breaks. Your followers and following are counted together:

| Followers + following | Pages | Approximate time |
| ---: | ---: | ---: |
| 1,000 | 20 | ~1–2 min |
| 3,000 | 60 | ~4 min |
| 6,000 | 120 | ~7–8 min |
| 10,000 | 200 | ~13–14 min |

The following list often loads faster than this, because sorted by date Instagram can return it in fewer pages. The popup shows a live progress bar (*Reading your followers · 1,250 of 3,000*), and the empty state estimates the time for your account before the first scan.

**You don't have to watch it.** Close the popup and keep browsing; the scan runs in the background and the result is there next time you open it.

---

## Why "Unfollow all" unfollows only about one account a minute

**Short answer:** Instagram blocks accounts that unfollow in bursts. One account every 45–90 seconds, at most 150 a day, stays well clear of that. And because it runs in the background, the slow pace doesn't cost you anything.

### Instagram's action limits

Follows and unfollows are "actions", and Instagram limits how many you can do per hour and per day. It doesn't publish the exact numbers, and they vary with the account's age and history. Go over them and you get the **"Try Again Later"** / **"Action Blocked"** message:

- you can't follow or unfollow anyone, even by hand in the app, for **hours to days**;
- repeated blocks last longer and can lead to further restrictions on the account.

Unfollowing 400 accounts in a few minutes is exactly the kind of burst that triggers this.

### How "Unfollow all" paces itself

| Rule | Value |
| --- | --- |
| Gap between unfollows | **45–90 seconds**, random (about one a minute on average) |
| Daily maximum | **150 unfollows**, then it waits until after midnight and continues on its own |
| If Instagram shows "Try Again Later" | **Stops immediately** and tells you. Wait a day or two before pressing **Resume**. |
| If Instagram rate-limits | Waits out the pause, then continues |
| Two unfollows in a row fail | Pauses and shows the error, rather than failing the whole list |

Before **each** unfollow, it checks your latest scan and **skips anyone who has followed you back** (or whom you already unfollowed) since the list was made. Background checks keep that scan up to date while the queue runs.

### It runs in the background

You click **Unfollow all** once and can then close the popup and use your computer normally:

- It keeps going while **your browser is open**, even with the popup closed.
- It **survives browser restarts** and picks up where it left off.
- A bar shows progress (*88 of 400 done · Next unfollow in 0:48*) with **Pause** and **Stop**.
- You get a notification when it **finishes** or if it has to **pause**.

| Accounts to unfollow | Approximate time |
| ---: | --- |
| 50 | ~1 hour |
| 150 | ~3 hours (one day's maximum) |
| 400 | 3 days (150 + 150 + 100) |
| 1,000 | 7 days |

To prevent mistakes, **Unfollow all** only starts from a **complete scan less than a day old**, and it only touches accounts that, according to that scan, you follow and that don't follow you.

> The single **Unfollow** button on a row works immediately. The pacing only applies to *Unfollow all*. If you click through dozens of single unfollows quickly, Instagram can still block you, so the same advice applies.

---

## Importing your Instagram data download

Instagram lets you download your own data, including **every follower with the date they followed you**. Importing it adds:

- **Exact follow dates** on every follower (*Since Mar 3, 2021 · 5 yr 8 mo*) and the **Followers → Loyal** sort.
- **Activity → Since download**: with an older download, everyone who followed you then but doesn't now. This covers unfollows from **before** you installed the extension.

### How to get it

1. In Instagram, open **Accounts Center → Your information and permissions → Download your information**.
2. Choose **Download or transfer information → Some of your information → Followers and following**.
3. Pick **Download to device**, format **JSON**, and request it. Instagram emails you when it's ready, which can take minutes to a few days.

### How to import

Open **Settings → Import Instagram data download** and pick:
- the `.zip` file exactly as Instagram sent it (any part of a multi-part download, any size), **or**
- the extracted `followers_1.json` or `followers_1.html` (older downloads use `connections.json`).

Notes:
- Files are read **locally in your browser**. Only usernames and follow dates are kept.
- You can import several downloads. The **oldest** one is the comparison base for *Since download*, and follow dates from all of them are combined.
- Downloads list usernames, not account IDs. An account that **changed its username** or deactivated will therefore also appear under *Since download*.
- If the download looks like it belongs to a different account (fewer than 20% of its followers follow you now), you're asked before it's imported.

---

## Privacy and permissions

- **Everything stays in your browser.** Lists, history and settings are stored in `chrome.storage.local`, per Instagram account. There is no server, no analytics and no tracking.
- **Requests go only to Instagram** (`instagram.com`, plus its image servers for profile pictures).
- **Your password is never seen or stored.** The extension uses the login session your browser already has.
- **Settings → Clear saved data** deletes the saved lists, history and import for the current account.

| Permission | What it's used for |
| --- | --- |
| `storage`, `unlimitedStorage` | Saving your lists and history locally. Large accounts can exceed the default 10 MB. |
| `cookies` | Reading which Instagram account is logged in (`ds_user_id`) and the CSRF token Instagram requires on requests. |
| `alarms` | Scheduling background checks and the paced *Unfollow all* queue. |
| `notifications` | Unfollow alerts, and *Unfollow all* finished or paused. |
| `contextualIdentities` (Firefox only) | Finding an Instagram login inside a Firefox container, such as Facebook Container. |
| `scripting` | Running a request inside an instagram.com tab when Instagram refuses it from the background. |
| `declarativeNetRequestWithHostAccess` | Setting the `Origin`/`Referer` headers to instagram.com on the extension's own requests, which Instagram requires. |
| Host access: `instagram.com`, `cdninstagram.com`, `fbcdn.net` | Talking to Instagram and loading profile pictures. |

---

## Troubleshooting

| Message or problem | What it means and what to do |
| --- | --- |
| **Log in to Instagram** / **Not logged in** | Open instagram.com in the same browser and log in, then reopen the popup. |
| **Scan in 14:59** (button greyed out) | Scans are spaced 15 minutes apart. Wait for the countdown. |
| **Instagram is limiting requests… paused until 3:45 PM** | Instagram rate-limited the account. The extension waits on purpose; retrying now would extend the limit. It resumes on its own. |
| **Instagram returned only 1,204 of 3,000 followers. The scan was discarded…** | Instagram sent an incomplete list. Nothing was saved. Try again later. |
| **Instagram refused the request from the extension** | Open instagram.com in a tab, make sure you're logged in, and scan again. |
| **Couldn't get Instagram's security token for this action** | Follow/unfollow needs a logged-in instagram.com page. Open instagram.com, then retry. |
| **Instagram blocked this action for now ("Try Again Later")** | An Instagram action block. Stop unfollowing for a day or two. *Unfollow all* pauses itself when this happens. |
| **The last scan was interrupted** | Chrome closed or restarted mid-scan. Run it again. |
| A blank instagram.com tab appeared | The extension opened it to send your scan or unfollow through instagram.com. It closes itself about a minute later. |
| You switched Instagram accounts | Each account has its own data. *Unfollow all* pauses until you switch back. |
| Nothing happens after updating the files | Click **reload** (↻) on the extension's card on your browser's extensions page (`chrome://extensions`, `edge://extensions`, `brave://extensions`, `opera://extensions` or `vivaldi://extensions`). In Firefox, install the new `.xpi` again. |
| Firefox: *This add-on could not be installed because it has not been verified* | Regular Firefox only installs Mozilla-signed add-ons. Use **Load Temporary Add-on** in `about:debugging`, or Firefox Developer Edition, Nightly or ESR. See [Firefox](#firefox). |
| Firefox: Unfollow Watch disappeared after restarting | It was loaded as a temporary add-on, which Firefox removes when it closes. Load it again from `about:debugging`. |
| Firefox: *Not logged in* although you are | Make sure the login is in a normal window, not a private one. If you use containers, the login is found automatically, but timed checks only run while an Instagram tab is open in that container. |
| **Load unpacked** says *Manifest file is missing or unreadable* | You picked the wrong folder. Select the folder that directly contains `manifest.json`, not the ZIP and not a parent folder. |
| The extension disappeared after restarting Edge | You probably clicked *Turn off extensions* on Edge's developer-mode prompt. Turn Unfollow Watch back on at `edge://extensions`. |
| No notifications appear | Allow notifications for your browser in your operating system's settings, and check that *Do not disturb* or *Focus* is off. See [Log in to Instagram](#3-log-in-to-instagram). |

---

## FAQ

**Can it show who unfollowed me before I installed it?**
Not from scans; Instagram keeps no history of unfollows. But if you have an **older data download**, importing it shows everyone who followed you then and doesn't now. See [Importing your Instagram data download](#importing-your-instagram-data-download).

**Does my computer need to stay on?**
Your browser needs to be open for background checks and *Unfollow all* to run. If it's closed, nothing is lost; checks resume and the queue continues the next time it runs.

**Which browsers does it work in?**
Chrome, Edge, Brave, Opera, Opera GX, Vivaldi and Firefox. See [Supported browsers](#supported-browsers) for step-by-step instructions for each.

**Does it work on Firefox?**
Yes, Firefox 140 or newer, with a separate download (`-firefox.xpi`). Firefox only installs extensions permanently once Mozilla has signed them, so for now regular Firefox loads it temporarily, while Developer Edition, Nightly and ESR can install it permanently. See [Firefox](#firefox).

**Does it work on my phone?**
No. Instagram's mobile apps don't support extensions, and mobile browsers don't run desktop extensions.

**Will Instagram ban me for using this?**
The extension is built to behave like a person using instagram.com: paced requests, breaks, backing off on limits, and capped unfollows. But it does use Instagram's unofficial internal endpoints, and automated use can go against Instagram's Terms of Use. There is always some risk. See [Risks and limitations](#risks-and-limitations).

**Does it work with multiple accounts?**
Yes. Data is stored separately for each Instagram account. It follows whichever account is logged in on instagram.com in that browser.

**Why is a follower's date shown as "Since before Nov 4"?**
Without a data download, the extension only knows they were already following you at your first scan. Import a download to get exact dates.

---

## Project structure

```
├── manifest.json        Chrome manifest (Manifest V3); the Firefox one is generated from it
├── background.js        Background script: Instagram requests, scans, diffing, history,
│                        rate-limit handling, background checks, Unfollow all queue,
│                        notifications and badge
├── popup.html           The popup interface (also opens in a full tab from notifications)
├── popup.css            Styles, light and dark mode
├── popup.js             Popup logic: lists, filters, search, actions, settings
├── import.js            Reads Instagram data downloads (zip, zip64, JSON, HTML) in the browser
├── icons/               Toolbar and notification icons
├── scripts/build.mjs    Builds the Chrome and Firefox packages
└── docs/screenshots/    Images used in this README
```

The same source files run in both browsers. The code uses `browser` in Firefox and `chrome` elsewhere, and leaves out the few features Firefox lacks, such as notification buttons.

### Building from source

The repository folder itself is the Chrome extension, so Chrome-based browsers can load it directly with **Load unpacked**. To build the release packages, including the Firefox one, run this with [Node.js](https://nodejs.org) 20.15 or newer (there are no dependencies to install):

```bash
node scripts/build.mjs
```

It writes these to `dist/`:

| Output | Use |
| --- | --- |
| `dist/chrome/` | Unpacked Chrome extension, for **Load unpacked** |
| `dist/firefox/` | Unpacked Firefox extension. In `about:debugging`, pick its `manifest.json` |
| `unfollow-watch-<version>-chrome.zip` | Chrome release download |
| `unfollow-watch-<version>-firefox.xpi` | Firefox release download, and the file to submit to Mozilla for signing |

The Firefox package gets a Manifest V2 manifest with a persistent background page, the add-on ID `unfollow-watch@reshaan-nadar`, and a minimum version of Firefox 140. To check it with Mozilla's linter, run `npx web-ext lint --source-dir dist/firefox`.

To get the Firefox version signed so regular Firefox can install it permanently, submit the `.xpi` at [addons.mozilla.org/developers](https://addons.mozilla.org/developers/) and choose **On your own** (self-distribution). Mozilla signs it, usually within minutes, and you can then attach the signed `.xpi` to a release.

---

## Risks and limitations

- **Unofficial API.** This uses the same endpoints as instagram.com, not a public API. Instagram can change them at any time, which may break the extension until it's updated.
- **Terms of Use.** Automated access may go against Instagram's Terms of Use. Use at your own risk; the authors aren't responsible for restrictions placed on your account.
- **Action blocks.** Even with pacing, Instagram can still limit follows and unfollows, especially on new or recently flagged accounts. *Unfollow all* stops when that happens.
- **History starts at your first scan.** Earlier unfollows can only be found with a data download.
- **Ambiguous disappearances.** If an account that followed you (but you didn't follow) deactivates, it can't be told apart from an unfollow.
- **Browser must be open** for background checks and *Unfollow all*.

---

## License

[MIT](LICENSE)
