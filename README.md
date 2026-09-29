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
- [ ] Progress, cancel, retry, accept/reject
- [ ] Clear failure messages
- [ ] Full keyboard use
- [ ] Multiple files
- [ ] Folder transfer (zipped, skipping `node_modules`, `.git`)

## How it works
1. The sender gets a 6-digit code from the pairing server and the receiver enters it.
2. The server relays only the WebRTC handshake. The browsers then open a direct data channel with no STUN or TURN servers, so it only connects on the same local network.
3. The file is cut into 16 KB chunks, sent with backpressure, and reassembled on the receiver, which checks the size before offering the download.

## Keyboard shortcuts
_(Fill in during the keyboard pass.)_

## Failure cases handled
_(Wrong or expired code, receiver rejects, connection drops, file too large, different networks, server unreachable, empty folder, zip out of memory, unreadable files.)_

## Compared with the original
**Windows Nearby Sharing**
- Not implemented: _(list and reason)_
- One way mine is better: specific "why it failed" messages with a suggested fix.

**Why not WhatsApp?** _(Short paragraph: no manual zipping, junk folders skipped, direct local transfer, no phone number needed. Also say where WhatsApp is better.)_

**Known limitation:** the pairing server is online, so both devices need internet to pair. File data itself never leaves the local network.

## Out of scope
Apps and settings, full-drive migration, Bluetooth discovery, USB cable transfer, transfers over the internet, transfer history, encryption beyond WebRTC's default.