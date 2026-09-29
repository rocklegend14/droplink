// Steps 2-3: pairing over WebSocket, then a direct WebRTC data channel that carries one file.
// The server only relays the handshake. File bytes never pass through it.
'use strict';
const $ = (id) => document.getElementById(id);
const statusEl = $('status'), sendBtn = $('send-btn'), recvBtn = $('recv-btn'),
  cancelBtn = $('cancel-btn'), codeInput = $('code'), codeBox = $('code-box'), codeOut = $('code-out'),
  transfer = $('transfer'), sendPanel = $('send-panel'), recvPanel = $('recv-panel'),
  fileInput = $('file-input'), sendFileBtn = $('send-file-btn'), progress = $('progress'),
  downloads = $('downloads'), leaveBtn = $('leave-btn'), selection = $('selection'), selectionList = $('selection-list'), clearBtn = $('clear-btn'), folderInput = $('folder-input'),
  offerBox = $('offer'), offerText = $('offer-text'), acceptBtn = $('accept-btn'),
  rejectBtn = $('reject-btn'), cancelTransferBtn = $('cancel-transfer-btn');

const CHUNK = 16 * 1024;              // bytes per message (safe for every browser)
const MAX_BYTES = 500 * 1024 * 1024;  // limit for all files in one batch (they are held in memory)
const MAX_FILES = 50;
const HIGH_WATER = 4 * 1024 * 1024;   // pause sending when this much is queued
const CONNECT_TIMEOUT_MS = 15000;

const MESSAGES = {
  'bad-code': 'Enter all 6 digits.',
  'code-not-found': "That code doesn't match an open session. Check the digits on the sending laptop, or ask for a new code.",
  'code-expired': 'That code has expired. Ask the sender to click "Get pairing code" again.',
  'code-in-use': 'Another device already used that code. Ask the sender for a new one.',
  'too-many-attempts': 'Too many wrong codes. Wait a minute, then try again.',
  'not-paired': 'The other device is not connected yet.',
  'bad-message': 'Something went wrong talking to the server. Reload the page and try again.',
};
const SERVER_DOWN = "Can't reach the pairing server. Check your internet connection, then try again.";
const OFFLINE = "You appear to be offline. Connect to Wi-Fi, then try again.";
const LINK_FAILED = "Couldn't connect directly to the other laptop. Both must be on the same Wi-Fi network. Guest and public networks often block device-to-device traffic.";

let ws = null, state = 'idle';            // idle | waiting | joining | paired
let role = null, pc = null, dc = null, connectTimer = null;
let signalQueue = Promise.resolve();
let sending = false, incoming = null, downloadUrls = [];
let selectedFiles = []; // files chosen on the sender, editable before sending
let lastAction = 'send'; // which control the user last used, so focus can return to it
let offer = null, cancelledBy = null, replyResolver = null, replyTimer = null;
const REPLY_TIMEOUT_MS = 60000;

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
  statusEl.setAttribute('aria-live', isError ? 'assertive' : 'polite');
}
const fmtSize = (n) => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`;
const showProgress = (pct) => { progress.hidden = false; progress.value = Math.min(100, pct); };

function setState(next) {
  state = next;
  const busy = next !== 'idle';
  sendBtn.disabled = busy; recvBtn.disabled = busy; codeInput.disabled = busy;
  codeBox.hidden = next !== 'waiting';
  cancelBtn.hidden = next !== 'waiting';
  transfer.hidden = next !== 'paired';
}

function closeSocket() {
  if (ws) { ws.onclose = null; ws.onerror = null; ws.close(); ws = null; }
}

function closeRtc() {
  clearTimeout(connectTimer);
  if (dc) { dc.onclose = null; dc.close(); }
  if (pc) pc.close();
  dc = pc = null; incoming = null; sending = false; role = null;
  offer = null; cancelledBy = null; clearReply();
  offerBox.hidden = true; cancelTransferBtn.hidden = true; sendFileBtn.textContent = 'Send';
  clearDownloads(); progress.hidden = true; progress.value = 0;
  selectedFiles = []; renderSelection(); lockSelection(false); sendFileBtn.disabled = false;
}

function reset(msg, isError) {
  closeSocket();
  closeRtc();
  setState('idle');
  setStatus(msg, isError);
  // Keep keyboard users oriented: if focus was on something that just got hidden or disabled, move it.
  const a = document.activeElement;
  if (!a || a === document.body || a.disabled || a.offsetParent === null) {
    (lastAction === 'join' ? codeInput : sendBtn).focus();
  }
}

// ---------- pairing (WebSocket) ----------
function connect() {
  return new Promise((resolve, reject) => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const sock = new WebSocket(`${proto}://${location.host}/ws`);
    const timer = setTimeout(() => { sock.close(); reject(new Error('timeout')); }, 5000);
    sock.onopen = () => { clearTimeout(timer); resolve(sock); };
    sock.onerror = () => { clearTimeout(timer); reject(new Error('unreachable')); };
  });
}

async function open(firstMessage) {
  try {
    ws = await connect();
  } catch {
    return reset(navigator.onLine === false ? OFFLINE : SERVER_DOWN, true);
  }
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } handle(m); };
  ws.onclose = () => {
    if (state === 'idle') return;
    if (dc && dc.readyState === 'open') return; // transfer does not need the server anymore
    reset('Lost the connection to the pairing server. Start again.', true);
  };
  ws.send(JSON.stringify(firstMessage));
}

function handle(msg) {
  switch (msg.type) {
    case 'created':
      codeOut.textContent = msg.code;
      codeOut.setAttribute('aria-label', `Pairing code ${msg.code.split('').join(' ')}`);
      $('ttl').textContent = Math.round(msg.ttlMs / 60000);
      setState('waiting');
      setStatus(`Your code is ${msg.code.split('').join(' ')}. Waiting for the other laptop.`);
      codeOut.focus();
      break;
    case 'paired':
      role = msg.role;
      setState('paired');
      sendPanel.hidden = role !== 'sender';
      recvPanel.hidden = role !== 'receiver';
      setStatus('Paired. Setting up a direct connection...');
      $('transfer-h').focus();
      startRtc();
      break;
    case 'signal':
      signalQueue = signalQueue.then(() => onSignal(msg.data)).catch(() => {});
      break;
    case 'expired':
      reset('Your code expired after no one used it. Click "Get pairing code" for a new one.', true);
      sendBtn.focus();
      break;
    case 'peer-left':
      if (dc && dc.readyState === 'open') setStatus('The other laptop closed its page.');
      else reset('The other laptop disconnected. Start again with a new code.', true);
      break;
    case 'error':
      reset(MESSAGES[msg.code] || 'Something went wrong. Try again.', true);
      if (msg.code !== 'bad-code') codeInput.focus();
      break;
  }
}

// ---------- direct connection (WebRTC) ----------
const sendSignal = (data) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'signal', data })); };

function linkFailed() {
  if (state === 'paired' && !(dc && dc.readyState === 'open')) reset(LINK_FAILED, true);
}

function startRtc() {
  // No STUN/TURN servers: traffic stays on the local network.
  pc = new RTCPeerConnection({ iceServers: [] });
  pc.onicecandidate = (e) => { if (e.candidate) sendSignal({ candidate: e.candidate }); };
  pc.onconnectionstatechange = () => {
    if (!pc || pc.connectionState !== 'failed') return;
    if (incoming || offer) failTransfer('The Wi-Fi connection between the laptops was lost. Pair again to retry.');
    else if (!sending) linkFailed();
  };
  connectTimer = setTimeout(linkFailed, CONNECT_TIMEOUT_MS);

  if (role === 'sender') {
    setupChannel(pc.createDataChannel('file'));
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => sendSignal({ sdp: pc.localDescription }))
      .catch(linkFailed);
  } else {
    pc.ondatachannel = (e) => setupChannel(e.channel);
  }
}

async function onSignal(data) {
  if (!pc || !data) return;
  if (data.sdp) {
    await pc.setRemoteDescription(data.sdp);
    if (data.sdp.type === 'offer') {
      await pc.setLocalDescription(await pc.createAnswer());
      sendSignal({ sdp: pc.localDescription });
    }
  } else if (data.candidate) {
    try { await pc.addIceCandidate(data.candidate); } catch { /* late or duplicate candidate */ }
  }
}

function setupChannel(ch) {
  dc = ch;
  ch.binaryType = 'arraybuffer';
  ch.onopen = () => {
    clearTimeout(connectTimer);
    if (role === 'sender') {
      setStatus('Connected directly. Choose a file to send.');
      fileInput.focus();
    } else {
      setStatus('Connected directly. Waiting for the sender to choose a file.');
    }
  };
  ch.onmessage = onData;
  ch.onclose = () => {
    if (state !== 'paired') return;
    resolveReply('closed');
    if (incoming) failTransfer(`Connection dropped at ${Math.round(incoming.totalReceived / incoming.total * 100)}%. Pair again to retry.`);
    else if (offer) failTransfer('Connection dropped before you answered. Pair again.');
    else if (!sending) setStatus('The direct connection closed.', true);
  };
}

// ---------- file transfer ----------
function failTransfer(msg) {
  incoming = null; offer = null; sending = false; sendFileBtn.disabled = false; lockSelection(false);
  offerBox.hidden = true; cancelTransferBtn.hidden = true; progress.hidden = true;
  if (role === 'sender') sendFileBtn.textContent = 'Try again';
  setStatus(msg, true);
  (role === 'sender' ? sendFileBtn : $('transfer-h')).focus();
}

function clearDownloads() {
  downloadUrls.forEach((u) => URL.revokeObjectURL(u));
  downloadUrls = [];
  downloads.replaceChildren();
  downloads.hidden = true;
}

function addDownloadLink(f, url) {
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.href = url; a.download = f.name;
  a.textContent = `Save ${f.name} (${fmtSize(f.size)})`;
  li.appendChild(a); downloads.appendChild(li); downloads.hidden = false;
}

function safeSend(obj) {
  try { if (dc && dc.readyState === 'open') dc.send(JSON.stringify(obj)); } catch { /* channel closing */ }
}

// The sender waits here for the receiver's accept, reject or cancel.
function waitForReply(ms) {
  return new Promise((resolve) => {
    replyResolver = resolve;
    replyTimer = setTimeout(() => resolveReply('timeout'), ms);
  });
}
function resolveReply(value) {
  clearTimeout(replyTimer);
  const r = replyResolver; replyResolver = null;
  if (r) r(value);
}
function clearReply() { clearTimeout(replyTimer); replyResolver = null; }

function cancelTransfer() {
  if (sending) { cancelledBy = 'me'; safeSend({ type: 'cancel' }); resolveReply('cancelled'); }
  else if (incoming || offer) { safeSend({ type: 'cancel' }); failTransfer('You cancelled the transfer.'); }
}

function drain(limit) {
  return new Promise((resolve, reject) => {
    const check = () => {
      if (!dc || dc.readyState !== 'open') return reject(new Error('closed'));
      if (dc.bufferedAmount <= limit) return resolve();
      setTimeout(check, 20);
    };
    check();
  });
}

async function sendFile() {
  if (sending) return; // ignore double clicks
  const chosen = [...selectedFiles];
  if (!chosen.length) { setStatus('Choose at least one file first.', true); fileInput.focus(); return; }
  const empty = chosen.find((f) => !f.isFolder && f.size === 0);
  if (empty) { setStatus(`${empty.name} is empty. Remove it from your selection and try again.`, true); return; }
  if (chosen.length > MAX_FILES) { setStatus(`You selected ${chosen.length} items. The limit is ${MAX_FILES} per batch.`, true); return; }
  const chosenTotal = chosen.reduce((n, f) => n + f.size, 0);
  if (chosenTotal > MAX_BYTES) { setStatus(`These files add up to ${fmtSize(chosenTotal)}. The limit is 500 MB in total. Send them in smaller batches.`, true); return; }
  if (!dc || dc.readyState !== 'open') { setStatus('Not connected directly yet. Wait a moment or pair again.', true); return; }

  sending = true; cancelledBy = null;
  sendFileBtn.disabled = true; sendFileBtn.textContent = 'Send';
  cancelTransferBtn.hidden = false; progress.hidden = true;
  lockSelection(true);
  $('transfer-h').focus();
  let sent = 0, files = chosen, total = chosenTotal;
  const label = () => (files.length === 1 ? files[0].name : `${files.length} files`);
  const cancelMsg = () => (cancelledBy === 'me'
    ? 'You cancelled the transfer. Choose "Try again" to send it again.'
    : 'The other laptop cancelled the transfer. Choose "Try again" to send it again.');
  try {
    if (chosen.some((f) => f.isFolder)) {
      try {
        files = [];
        for (const item of chosen) {
          if (!item.isFolder) { files.push(item); continue; }
          const blob = await DropFolder.zipFolder(
            item,
            (done, n) => setStatus(`Zipping ${item.displayName}: ${done} of ${n} files`),
            () => !!cancelledBy,
          );
          if (!blob) return failTransfer(cancelMsg());
          files.push(new File([blob], item.name, { type: 'application/zip' }));
        }
      } catch (err) {
        return failTransfer(err && err.path
          ? `Couldn't read ${err.path} inside the folder. It may be locked by another program, or you may not have permission. Fix it, then remove the folder and add it again.`
          : "Couldn't zip the folder. Your browser may have run out of memory. Close other tabs or send a smaller folder.");
      }
      total = files.reduce((n, f) => n + f.size, 0);
      if (total > MAX_BYTES) return failTransfer(`After zipping, the files add up to ${fmtSize(total)}. The limit is 500 MB in total.`);
    }
    dc.send(JSON.stringify({ type: 'meta', files: files.map((f) => ({ name: f.name, size: f.size, mime: f.type })) }));
    setStatus(`Waiting for the other laptop to accept ${label()}...`);
    const reply = await waitForReply(REPLY_TIMEOUT_MS);
    if (cancelledBy) return failTransfer(cancelMsg());
    if (reply === 'reject') return failTransfer('The other laptop rejected the files. Choose "Try again" to send them again.');
    if (reply === 'timeout') {
      safeSend({ type: 'cancel' });
      return failTransfer('No answer after 60 seconds. Ask the other laptop to look for the Accept button, then try again.');
    }
    if (reply !== 'accept') throw new Error('closed');

    showProgress(0);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      dc.send(JSON.stringify({ type: 'file-start', index: i }));
      setStatus(files.length === 1
        ? `Sending ${file.name} (${fmtSize(file.size)})...`
        : `Sending file ${i + 1} of ${files.length}: ${file.name}`);
      let offset = 0;
      while (offset < file.size) {
        if (cancelledBy) return failTransfer(cancelMsg());
        if (dc.bufferedAmount > HIGH_WATER) await drain(HIGH_WATER / 2);
        let buf;
        try { buf = await file.slice(offset, offset + CHUNK).arrayBuffer(); }
        catch {
          safeSend({ type: 'cancel' });
          return failTransfer(`Couldn't read ${file.name}. It may have been moved, deleted or locked by another program. Choose the files again, then try again.`);
        }
        dc.send(buf);
        offset += buf.byteLength; sent += buf.byteLength;
        showProgress(sent / total * 100);
      }
      dc.send(JSON.stringify({ type: 'file-end' }));
    }
    dc.send(JSON.stringify({ type: 'done' }));
    await drain(0);
    if (cancelledBy) return failTransfer(cancelMsg());
    sending = false; sendFileBtn.disabled = false; cancelTransferBtn.hidden = true;
    selectedFiles = []; renderSelection(); lockSelection(false);
    setStatus(files.length === 1
      ? `Sent ${files[0].name} (${fmtSize(total)}). Choose more files to send another batch.`
      : `Sent ${files.length} files (${fmtSize(total)}). Choose more files to send another batch.`);
    fileInput.focus();
  } catch {
    failTransfer(`Connection dropped at ${Math.round(sent / total * 100)}%. Pair again to retry.`);
  }
}

function onOffer(m) {
  if (role !== 'receiver') return;
  if (incoming || offer) return safeSend({ type: 'reject' }); // already busy
  const files = (Array.isArray(m.files) ? m.files : []).map((f) => ({
    name: String((f && f.name) || 'file').slice(0, 255),
    size: Number(f && f.size),
    mime: String((f && f.mime) || 'application/octet-stream'),
  }));
  const total = files.reduce((n, f) => n + f.size, 0);
  const valid = files.length >= 1 && files.length <= MAX_FILES && total <= MAX_BYTES
    && files.every((f) => Number.isFinite(f.size) && f.size > 0);
  if (!valid) {
    safeSend({ type: 'reject' });
    return failTransfer('The sender offered more than the limit (500 MB in total, 50 files). It was rejected automatically.');
  }
  offer = { files, total };
  progress.hidden = true;
  const names = files.slice(0, 3).map((f) => f.name).join(', ') + (files.length > 3 ? `, and ${files.length - 3} more` : '');
  offerText.textContent = (files.length === 1
    ? `Incoming file: ${files[0].name} (${fmtSize(total)})`
    : `Incoming: ${files.length} files (${fmtSize(total)}): ${names}`)
    + (downloadUrls.length ? '. Accepting replaces the files you received earlier.' : '');
  offerBox.hidden = false;
  setStatus(`The other laptop wants to send you ${files.length === 1 ? files[0].name : `${files.length} files`}. Accept or reject.`);
  acceptBtn.focus();
}

function onData(e) {
  if (typeof e.data === 'string') {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'meta') return onOffer(m);
    if (m.type === 'accept') return resolveReply('accept');
    if (m.type === 'reject') return resolveReply('reject');
    if (m.type === 'cancel') {
      if (sending) { cancelledBy = 'peer'; resolveReply('cancel'); }
      else if (incoming || offer) failTransfer('The sender cancelled the transfer.');
      return;
    }
    if (!incoming) return;

    if (m.type === 'file-start') {
      if (m.index !== incoming.results.length || incoming.current) {
        safeSend({ type: 'cancel' });
        return failTransfer('Files arrived out of order. Ask the sender to try again.');
      }
      incoming.current = { received: 0, chunks: [] };
      const f = incoming.files[m.index], n = incoming.files.length;
      if (n > 1) setStatus(`Receiving file ${m.index + 1} of ${n}: ${f.name}`);
      return;
    }
    if (m.type === 'file-end') {
      const f = incoming.files[incoming.results.length], c = incoming.current;
      if (!f || !c || c.received !== f.size) {
        return failTransfer(`${f ? f.name : 'A file'} arrived incomplete. Ask the sender to try again.`);
      }
      let url;
      try { url = URL.createObjectURL(new Blob(c.chunks, { type: f.mime })); }
      catch { return failTransfer('Your browser ran out of memory while saving the file. Close other tabs or ask for fewer files.'); }
      downloadUrls.push(url);
      addDownloadLink(f, url);
      incoming.results.push(url); incoming.current = null;
      return;
    }
    if (m.type === 'done') {
      const n = incoming.files.length;
      if (incoming.results.length !== n) return failTransfer('Some files did not arrive. Ask the sender to try again.');
      cancelTransferBtn.hidden = true;
      setStatus(n === 1 ? 'File received. Use the link below to save it.' : `${n} files received. Use the links below to save each one.`);
      downloads.querySelector('a').focus();
      incoming = null;
    }
  } else if (incoming && incoming.current) {
    const c = incoming.current, f = incoming.files[incoming.results.length];
    try { c.chunks.push(e.data); }
    catch {
      safeSend({ type: 'cancel' });
      return failTransfer('Your browser ran out of memory while receiving. Close other tabs or ask for fewer files.');
    }
    c.received += e.data.byteLength; incoming.totalReceived += e.data.byteLength;
    if (!f || c.received > f.size) {
      safeSend({ type: 'cancel' });
      return failTransfer('Received more data than expected. Ask the sender to try again.');
    }
    showProgress(incoming.totalReceived / incoming.total * 100);
  }
}

// ---------- file selection (sender) ----------
function renderSelection() {
  selectionList.replaceChildren();
  selectedFiles.forEach((f, i) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = f.isFolder
      ? `${f.displayName} folder: ${f.count} file${f.count === 1 ? '' : 's'}, ${fmtSize(f.size)}, sent as ${f.name}`
      : `${f.name} (${fmtSize(f.size)})`;
    if (f.isFolder && f.skippedNote) {
      const note = document.createElement('small');
      note.className = 'note'; note.textContent = f.skippedNote;
      label.append(note);
    }
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'secondary small'; btn.dataset.index = i;
    btn.textContent = 'Remove'; btn.setAttribute('aria-label', `Remove ${f.name}`);
    li.append(label, btn);
    selectionList.appendChild(li);
  });
  const total = selectedFiles.reduce((n, f) => n + f.size, 0);
  selection.textContent = selectedFiles.length
    ? `${selectedFiles.length} item${selectedFiles.length === 1 ? '' : 's'} selected, ${fmtSize(total)} in total`
    : '';
  clearBtn.hidden = selectedFiles.length < 2;
}

function lockSelection(locked) { // no edits while a transfer is running
  fileInput.disabled = locked; folderInput.disabled = locked; clearBtn.disabled = locked;
  selectionList.querySelectorAll('button').forEach((b) => { b.disabled = locked; });
}

// ---------- controls ----------
sendBtn.addEventListener('click', () => {
  if (state !== 'idle') return; // ignore double clicks
  lastAction = 'send';
  setState('waiting'); codeBox.hidden = true;
  setStatus('Getting a code...');
  open({ type: 'create' });
});

function join() {
  if (state !== 'idle') return;
  const code = codeInput.value.trim();
  if (!/^\d{6}$/.test(code)) { setStatus(MESSAGES['bad-code'], true); codeInput.focus(); return; }
  lastAction = 'join';
  setState('joining');
  setStatus('Connecting...');
  open({ type: 'join', code });
}
recvBtn.addEventListener('click', join);
codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.replace(/\D/g, ''); });

function cancel() {
  if (state !== 'waiting') return;
  if (ws) ws.send(JSON.stringify({ type: 'leave' }));
  reset('Cancelled. No code is active.');
  sendBtn.focus();
}
cancelBtn.addEventListener('click', cancel);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (state === 'waiting') cancel();
  else if (offer) rejectBtn.click();
  else if (sending || incoming) cancelTransfer();
});

acceptBtn.addEventListener('click', () => {
  if (!offer) return;
  incoming = { files: offer.files, total: offer.total, results: [], current: null, totalReceived: 0 };
  offer = null; offerBox.hidden = true; cancelTransferBtn.hidden = false;
  clearDownloads(); showProgress(0);
  setStatus(`Receiving ${incoming.files.length === 1 ? incoming.files[0].name : `${incoming.files.length} files`} (${fmtSize(incoming.total)})...`);
  $('transfer-h').focus();
  safeSend({ type: 'accept' });
});
rejectBtn.addEventListener('click', () => {
  if (!offer) return;
  offer = null; offerBox.hidden = true;
  safeSend({ type: 'reject' });
  setStatus('You rejected the files. The sender has been told.');
  $('transfer-h').focus();
});
cancelTransferBtn.addEventListener('click', cancelTransfer);

sendFileBtn.addEventListener('click', sendFile);
fileInput.addEventListener('change', () => {
  const key = (f) => `${f.name}|${f.size}|${f.lastModified}`;
  const have = new Set(selectedFiles.map(key));
  let skipped = 0;
  for (const f of fileInput.files) {
    if (have.has(key(f))) skipped++;
    else { have.add(key(f)); selectedFiles.push(f); }
  }
  fileInput.value = ''; // lets the same file be picked again after removing it
  renderSelection();
  setStatus(skipped
    ? `Skipped ${skipped} file${skipped === 1 ? '' : 's'} already in the list.`
    : `${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} ready to send.`);
});

folderInput.addEventListener('change', () => {
  const list = [...folderInput.files];
  folderInput.value = ''; // lets the same folder be picked again later
  if (typeof DropFolder === 'undefined') { setStatus("Folder support didn't load. Reload the page and try again.", true); return; }
  const r = DropFolder.filterFolder(list);
  if (r.error) { setStatus(r.error, true); return; }
  const e = r.entry;
  if (selectedFiles.some((f) => f.isFolder && f.name === e.name && f.count === e.count && f.size === e.size)) {
    setStatus(`${e.displayName} is already in the list.`, true); return;
  }
  selectedFiles.push(e);
  renderSelection();
  setStatus(`Added folder ${e.displayName}: ${e.count} file${e.count === 1 ? '' : 's'}, ${fmtSize(e.size)}, sent as ${e.name}.${e.skippedNote ? ` ${e.skippedNote}.` : ''}`);
});

selectionList.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || sending) return;
  const i = Number(btn.dataset.index);
  const [removed] = selectedFiles.splice(i, 1);
  renderSelection();
  setStatus(`Removed ${removed.name}. ${selectedFiles.length ? `${selectedFiles.length} left.` : 'No files selected.'}`);
  const btns = selectionList.querySelectorAll('button');
  (btns[i] || btns[i - 1] || fileInput).focus(); // keep keyboard focus in the list
});

clearBtn.addEventListener('click', () => {
  if (sending) return;
  selectedFiles = []; renderSelection();
  setStatus('Selection cleared.');
  fileInput.focus();
});

leaveBtn.addEventListener('click', () => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'leave' }));
  reset('Disconnected.');
  sendBtn.focus();
});

if (typeof RTCPeerConnection === 'undefined' || typeof WebSocket === 'undefined') {
  sendBtn.disabled = true; recvBtn.disabled = true; codeInput.disabled = true;
  setStatus("This browser can't send files directly. Use a current version of Chrome, Edge, Firefox or Safari.", true);
}