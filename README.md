# DropLink

> Moving files and code folders between two laptops you control, quickly, without accounts, cloud upload, or manual zipping.

Modeled on **Windows Nearby Sharing**. Runs in any modern browser.

**Demo:** _(add deployed URL or recording link)_

## The problem
_(Who is affected, what goes wrong with Nearby Sharing and with sending via WhatsApp or OneDrive.)_

## Run it locally
Requirements: Node.js 18 or newer.

```bash
git clone <repo-url>
cd droplink
npm install
npm start
```
Open http://localhost:3000 in two browser tabs (or two laptops on the same Wi-Fi).

## Tests
Pairing checks (codes, expiry, wrong codes, relay):
```bash
PORT=3100 CODE_TTL_MS=800 node server.js   # terminal 1
npm test                                    # terminal 2
```

## What works
_(Update as features land.)_
- [x] Project setup, page loads, health check at `/health`
- [x] Pairing with a 6-digit code (5-minute expiry, wrong-code limit, cancel with Escape)
- [x] Send one file directly between browsers (WebRTC, 500 MB limit, kept in memory while receiving)
- [x] Progress bar, cancel from either side, retry ("Try again"), receiver accepts or rejects
- [x] Clear failure messages (each says what happened and what to do)
- [x] Full keyboard use
- [x] Multiple files in one batch (up to 50 files, 500 MB in total), one accept for the batch, a save link per file. Files can be added in several picks, removed one by one, or cleared all at once before sending
- [x] Folder transfer: zipped in the browser, skipping `node_modules`, `.git` and build folders, with a count and size shown before sending

## How it works
1. The sender gets a 6-digit code from the pairing server and the receiver enters it.
2. The server relays only the WebRTC handshake. The browsers then open a direct data channel with no STUN or TURN servers, so it only connects on the same local network.
3. The receiver accepts or rejects the whole batch once. Files are then sent one after another in 16 KB chunks with backpressure, and the receiver checks every file's size before offering a save link for it.

## Sending a folder
Choose a folder and it is added to the list as one item, for example `my-app folder: 87 files, 2.1 MB, sent as my-app.zip`, with a note of what was skipped. Nothing is zipped until you press Send, so you can remove it first. The receiver gets one `.zip` and unzips it to get the folder back.

Skipped by default: `node_modules`, `.git`, `dist`, `build`, `.next`, `.nuxt`, `.cache`, `__pycache__`, `.venv`, `venv`, `.DS_Store` and `Thumbs.db`. The skip list is `SKIP_DIRS` in `public/folder.js`.

Zipping uses [fflate](https://github.com/101arrowz/fflate) (MIT), included in `public/vendor/` so the app needs no CDN. The folder logic is tested without a browser: `npm run test:folder`.

## Keyboard use
The whole flow works without a mouse.

| Key | Action |
|---|---|
| Tab / Shift+Tab | Move between controls in reading order |
| Enter in the code box | Connect |
| Enter or Space on a button | Press it (Accept is focused when a file is offered) |
| Enter or Space on the file picker | Open the file dialog |
| Escape | Cancel a waiting code, reject an incoming file, or cancel a running transfer |

Focus is moved for you at each step: to the code when one is created, to the Transfer heading when paired, to the file picker on the sender, to Accept when a file is offered, and to the download link when a file arrives. If an error hides the control you were on, focus returns to the Send button or the code box. Status and error messages are announced by screen readers, and errors are announced immediately. A skip link jumps past the header. Checked with `npm run test:html` (labels, tab order, skip link).

## Failure cases handled
Every message says what went wrong and what to try next.

| Situation | What the user sees |
|---|---|
| Wrong or short code | Says the code doesn't match, or asks for all 6 digits |
| Expired code (5 min) | Tells the sender to get a new code; tells the receiver the code expired |
| Code already used | Asks the sender for a new code |
| Too many wrong codes | Says to wait a minute |
| Pairing server down | Says the server can't be reached, or that the device is offline |
| Devices on different or isolating networks | Says both must be on the same Wi-Fi and that guest networks often block this |
| Other laptop closes its page | Says it disconnected and to start again |
| Connection lost mid-transfer | Says how far it got and to pair again |
| Receiver rejects, cancels, or doesn't answer in 60 s | Sender is told which, with a "Try again" button |
| Empty file, over 500 MB in total, or more than 50 files | Refused before sending, with the reason |
| File incomplete on arrival | Receiver told to ask for a resend |
| File can't be read (moved, locked) | Says so, and to choose it again |
| Browser runs out of memory | Says to close tabs or use a smaller file |
| Browser without WebRTC | Says which browsers work |
| Empty folder, or everything in it is skipped | Says nothing was added and why |
| Folder over 500 MB after skipping junk | Refused before zipping, with the size |
| A file inside a folder can't be read | Names the file and says how to fix it |
| Browser runs out of memory while zipping | Says to close tabs or send a smaller folder |

## Compared with the original
**Windows Nearby Sharing**
- Not implemented: _(list and reason)_
- One way mine is better: specific "why it failed" messages with a suggested fix.

**Why not WhatsApp?** _(Short paragraph: no manual zipping, junk folders skipped, direct local transfer, no phone number needed. Also say where WhatsApp is better.)_

**Known limitation:** the pairing server is online, so both devices need internet to pair. File data itself never leaves the local network.

## Out of scope
Apps and settings, full-drive migration, Bluetooth discovery, USB cable transfer, transfers over the internet, transfer history, encryption beyond WebRTC's default.