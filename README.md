# DropLink

Send files and code folders from one laptop to another over the same Wi-Fi, straight from the browser. No account, no install, no cloud upload.

**Modeled on:** Windows Nearby Sharing (the "send a file to a nearby device" feature).
**Demo:** (https://droplink-rl1f.onrender.com/) · 

## The problem
Moving files between two laptops you own is harder than it should be, especially on Windows:

- **OneDrive and other cloud backups** need an account and storage, and the data goes up and back down through the internet.
- **Windows Nearby Sharing** depends on device discovery, and when it doesn't find the other laptop there is little to go on.
- **Chat apps such as WhatsApp** need a contact and a linked phone, apply their own size limits, and can't send a folder. A code project also drags `node_modules` and `.git` along if you zip it by hand.

DropLink is for one narrow job: **moving files and code folders between two laptops you control, quickly, without accounts, cloud upload, or manual zipping.**

## Run it locally
Requires **Node.js 18 or newer** (developed on Node 22). Nothing else to install.

```bash
git clone <repo-url>
cd droplink
npm install
npm start
```

Open http://localhost:3000 in two browser tabs. To try it on two devices, open `http://<this-computer's-IP>:3000` on the second one. Both must be on the same Wi-Fi, and the first computer's firewall must allow Node.js on private networks. Set `PORT` to use a different port.

### Using it
1. On laptop A, click **Get pairing code**.
2. On laptop B, type the 6-digit code and click **Connect**.
3. On A, choose files and/or a folder, then click **Send**.
4. On B, click **Accept**, then use the **Save** links.

## What works
- Pairing with a 6-digit code that expires after 5 minutes.
- Direct browser-to-browser transfer over a WebRTC data channel. The server never sees file contents.
- Several files in one batch (up to 50 files and 500 MB in total), with one Accept for the batch and a save link per file.
- An editable selection: add files in several picks, remove one, or clear all before sending.
- Folders, zipped in the browser and sent as one `.zip`. A count and size are shown before sending, plus a note of what was skipped.
- Progress bar, cancel from either side, receiver Accept/Reject, and **Try again** after a failure.

### Sending a folder
A folder is added to the list as one item, for example `my-app folder: 87 files, 2.1 MB, sent as my-app.zip`. Nothing is zipped until you press Send, so you can remove it first. The receiver unzips to get the folder back.

Skipped by default: `node_modules`, `.git`, `dist`, `build`, `.next`, `.nuxt`, `.cache`, `__pycache__`, `.venv`, `venv`, `.DS_Store`, `Thumbs.db`. The list is `SKIP_DIRS` in `public/folder.js`.

`.env` files (`.env`, `.env.local`, `.env.production`, ...) are skipped too, because they usually hold secrets. Tick **Include .env files** to send them; folders already in the list are re-checked when you change it. Templates such as `.env.example` are always sent. `.gitignore` is sent like any other file, but DropLink does not read it to decide what to skip.

Because `.git` is skipped, commit history does not travel. To move a repository with its history, push it and clone it on the other laptop.

## Keyboard use
The whole flow works without a mouse.

| Key | Action |
|---|---|
| Tab / Shift+Tab | Move between controls in reading order |
| Enter in the code box | Connect |
| Enter or Space on a button | Press it (Accept is focused when files are offered) |
| Enter or Space on a file or folder picker | Open the picker |
| Escape | Cancel a waiting code, reject an incoming offer, or cancel a running transfer or zip |

Focus is moved for you at each step: to the code when one is created, to the Transfer heading when paired, to the file picker on the sender, to Accept when files are offered, and to the first save link when files arrive. After removing a file, focus stays in the list. If an error hides the control you were on, focus returns to the Send button or the code box. A skip link jumps past the header.

Status and error messages appear in a bar fixed to the bottom of the window, so they are visible wherever you have scrolled, and are announced by screen readers (errors immediately). Buttons that cancel show their shortcut, for example "Cancel transfer (Esc)".

## Failure cases handled
Every message says what went wrong and what to try next.

| Situation | What the user sees |
|---|---|
| Wrong or short code | Says the code doesn't match, or asks for all 6 digits |
| Expired code (5 min) | Tells the sender to get a new code; tells the receiver the code expired |
| Code already used | Asks the sender for a new one |
| Too many wrong codes | Says to wait a minute |
| Pairing server down, or device offline | Says which, and to check the connection |
| Devices on different or isolating networks | Says both must be on the same Wi-Fi and that guest networks often block this |
| Other laptop closes its page | Says it disconnected and to start again |
| Connection lost mid-transfer | Says how far it got and to pair again |
| Receiver rejects, cancels, or doesn't answer in 60 s | Sender is told which, with a **Try again** button |
| Empty file, over 500 MB in total, or more than 50 items | Refused before sending, with the reason |
| Empty folder, or everything in it is skipped | Says nothing was added and why |
| Folder over 500 MB after skipping junk | Refused before zipping, with the size |
| A file (or a file inside a folder) can't be read | Names the file and says how to fix it |
| File arrives incomplete | Receiver is told to ask for a resend |
| Browser runs out of memory | Says to close tabs or send less |
| Browser without WebRTC | Says which browsers work |
| Double clicks, or a second offer while one is open | Ignored, or rejected automatically |

## Compared with the original
### Windows Nearby Sharing
| | Windows Nearby Sharing | DropLink |
|---|---|---|
| Platforms | Windows 10 and 11 | Any device with a modern browser |
| Setup | Sharing settings and Bluetooth or Wi-Fi discovery | Open a URL |
| Pairing | Automatic discovery | 6-digit code, so it works when discovery doesn't |
| Errors | Little detail when it fails | Specific reason plus a suggested fix |
| Folders | Sent as-is | Zipped, with `node_modules`, `.git` and secrets skipped |
| Transfer control | Basic | Accept/Reject, cancel from either side, Try again |

**Not implemented, and why**
- **Automatic discovery of nearby devices.** Browsers can't scan the network or use Bluetooth freely, so pairing is by code.
- **Sending to a phone or across the internet.** Kept to the same network so no relay server is needed.
- **Resuming an interrupted transfer.** A dropped connection means pairing again. Resuming needs chunk tracking on both sides, which I left out to finish the failure handling properly.
- **Real folder trees on the receiver.** Only Chromium browsers can write folders to disk, so a zip works everywhere.
- **Transfers larger than 500 MB.** Received files are held in memory. Larger files would need streaming to disk.
- **Transfer history and settings sync.**

**One way mine is better:** when a transfer can't happen, DropLink says *why* and *what to do* (code expired, different network, receiver said no, file locked, connection dropped at 63%) instead of a generic failure. Folder sending is a second difference: it filters junk and secrets and shows a summary before anything is sent.

### Why not WhatsApp?
For a small file to someone who isn't nearby, or anything that needs a chat history, WhatsApp is the better tool. DropLink is for two laptops in the same room: no phone number, contact or linked device, no upload-then-download through the internet, files sent as they are (not compressed), and folders handled without zipping by hand.

## How it works
1. The sender asks the server for a code. The receiver enters it. The server (`pairing.js`) connects the two and relays only the WebRTC handshake messages.
2. The browsers open a direct data channel. No STUN or TURN servers are configured, so traffic stays on the local network.
3. The sender offers the batch. The receiver accepts or rejects it once.
4. Files go one after another in 16 KB chunks, paused when the send buffer fills. The receiver checks each file's size before offering it for saving. Folders are zipped first with [fflate](https://github.com/101arrowz/fflate) (MIT), included in `public/vendor/` so no CDN is needed.

Codes are single-use and expire after 5 minutes, and only the first device to enter one is paired. Wrong codes are limited per IP address. WebRTC data channels are encrypted by default; nothing is added on top of that. Read the code only to the person you mean to send to.

```
server.js          static file server
pairing.js         WebSocket pairing and handshake relay
public/            the app: index.html, app.js, folder.js, style.css, vendor/
test-*.js          tests (see below)
render.yaml        Render deploy blueprint
```

## Tests
```bash
npm run test:html      # keyboard and accessibility checks on the page structure
npm run test:folder    # folder filtering and zipping (no browser needed)

PORT=3100 CODE_TTL_MS=800 node server.js    # terminal 1
npm test                                     # terminal 2: pairing, expiry, limits
```
The transfer flow itself (WebRTC, accept/reject, cancel) is checked by hand. Tested on: <!-- TODO: list browsers and devices you actually tried -->

## Deploy
The app needs a host that keeps a Node process and WebSockets running, so static hosts such as GitHub Pages won't work.

- **Render:** push to GitHub, choose New > Blueprint, and select the repo. `render.yaml` sets the build, start command and `/health` check. Free plans may sleep when idle, so the first load can be slow.
- **Railway or similar:** create a service from the repo. It detects `npm start` and provides the `PORT` variable the server reads.

Once deployed, both laptops open the same `https://` URL. The page uses secure WebSockets automatically.

## Known limitations
- **Both laptops must be on the same network.** Guest or public Wi-Fi may block device-to-device traffic.
- **Pairing needs internet when deployed.** Only the handshake goes through the server; files never do. Run it locally on one laptop to pair without internet.
- **Limits:** 500 MB and 50 items per batch, because files are held in memory until saved.
- **The wrong-code limit is per IP address.** People behind one shared address share the limit.
- **The skip list is fixed.** It doesn't read `.gitignore`, so an unusual project may include build output or skip a folder you wanted.

## Out of scope
Copying apps, settings, or a whole drive; backup and sync; Bluetooth discovery; USB cable transfer; transfers over the internet; transfer history; resuming interrupted transfers; encryption beyond WebRTC's default.

## License
MIT. Bundled fflate is MIT-licensed (see `public/vendor/fflate.LICENSE`).
