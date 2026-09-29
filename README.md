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
- [ ] Full keyboard use
- [ ] Multiple files
- [ ] Folder transfer (zipped, skipping `node_modules`, `.git`)

## How it works
1. The sender gets a 6-digit code from the pairing server and the receiver enters it.
2. The server relays only the WebRTC handshake. The browsers then open a direct data channel with no STUN or TURN servers, so it only connects on the same local network.
3. The file is cut into 16 KB chunks, sent with backpressure, and reassembled on the receiver, which checks the size before offering the download.

## Keyboard shortcuts
- Enter in the code box: connect
- Escape: cancel a waiting code, reject an incoming file, or cancel a running transfer
- Tab / Shift+Tab: move between controls; Enter or Space presses a button
_(Full keyboard pass comes in step 6.)_

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
| File empty, or over 500 MB | Refused before sending, with the reason |
| File incomplete on arrival | Receiver told to ask for a resend |
| File can't be read (moved, locked) | Says so, and to choose it again |
| Browser runs out of memory | Says to close tabs or use a smaller file |
| Browser without WebRTC | Says which browsers work |
| Folder cases (empty, too large, unreadable) | Added in step 8 |

## Compared with the original
**Windows Nearby Sharing**
- Not implemented: _(list and reason)_
- One way mine is better: specific "why it failed" messages with a suggested fix.

**Why not WhatsApp?** _(Short paragraph: no manual zipping, junk folders skipped, direct local transfer, no phone number needed. Also say where WhatsApp is better.)_

**Known limitation:** the pairing server is online, so both devices need internet to pair. File data itself never leaves the local network.

## Out of scope
Apps and settings, full-drive migration, Bluetooth discovery, USB cable transfer, transfers over the internet, transfer history, encryption beyond WebRTC's default.