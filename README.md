# DropLink

> Moving files and code folders between two laptops you control, quickly, without accounts, cloud upload, or manual zipping.

Modeled on **Windows Nearby Sharing**. Runs in any modern browser.

**Demo:** _(add deployed URL or recording link)_

## The problem
_(Who is affected, what goes wrong with Nearby Sharing and with sending via WhatsApp or OneDrive.)_

## Run it locally
Requirements: Node.js 18 or newer. No dependencies to install yet.

```bash
git clone <repo-url>
cd droplink
npm start
```
Open http://localhost:3000 in two browser tabs (or two laptops on the same Wi-Fi).

## What works
_(Update as features land.)_
- [x] Project setup, page loads, health check at `/health`
- [ ] Pairing with a 6-digit code
- [ ] Send one file
- [ ] Progress, cancel, retry, accept/reject
- [ ] Clear failure messages
- [ ] Full keyboard use
- [ ] Multiple files
- [ ] Folder transfer (zipped, skipping `node_modules`, `.git`)

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
