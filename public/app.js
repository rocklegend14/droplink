// Steps 2-3: pairing over WebSocket, then a direct WebRTC data channel that carries one file.
// The server only relays the handshake. File bytes never pass through it.
'use strict';
const $ = (id) => document.getElementById(id);
const statusEl = $('status'), sendBtn = $('send-btn'), recvBtn = $('recv-btn'),
  cancelBtn = $('cancel-btn'), codeInput = $('code'), codeBox = $('code-box'), codeOut = $('code-out'),
  transfer = $('transfer'), sendPanel = $('send-panel'), recvPanel = $('recv-panel'),
  fileInput = $('file-input'), sendFileBtn = $('send-file-btn'), progress = $('progress'),
  download = $('download'), leaveBtn = $('leave-btn'),
  offerBox = $('offer'), offerText = $('offer-text'), acceptBtn = $('accept-btn'),
  rejectBtn = $('reject-btn'), cancelTransferBtn = $('cancel-transfer-btn');

const CHUNK = 16 * 1024;              // bytes per message (safe for every browser)
const MAX_BYTES = 500 * 1024 * 1024;  // file size limit
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
let sending = false, incoming = null, downloadUrl = null;
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
  offerBox.hidden = true; cancelTransferBtn.hidden = true; sendFileBtn.textContent = 'Send file';
  if (downloadUrl) { URL.revokeObjectURL(downloadUrl); downloadUrl = null; }
  download.hidden = true; progress.hidden = true; progress.value = 0;
  fileInput.value = ''; sendFileBtn.disabled = false;
}

function reset(msg, isError) {
  closeSocket();
  closeRtc();
  setState('idle');
  setStatus(msg, isError);
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
    if (incoming) failTransfer(`Connection dropped at ${Math.round(incoming.received / incoming.size * 100)}%. Pair again to retry.`);
    else if (offer) failTransfer('Connection dropped before you answered. Pair again.');
    else if (!sending) setStatus('The direct connection closed.', true);
  };
}

// ---------- file transfer ----------
function failTransfer(msg) {
  incoming = null; offer = null; sending = false; sendFileBtn.disabled = false;
  offerBox.hidden = true; cancelTransferBtn.hidden = true; progress.hidden = true;
  if (role === 'sender') sendFileBtn.textContent = 'Try again';
  setStatus(msg, true);
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
  const file = fileInput.files[0];
  if (!file) { setStatus('Choose a file first.', true); fileInput.focus(); return; }
  if (file.size === 0) { setStatus('That file is empty. Choose another.', true); return; }
  if (file.size > MAX_BYTES) { setStatus(`That file is ${fmtSize(file.size)}. The limit is 500 MB.`, true); return; }
  if (!dc || dc.readyState !== 'open') { setStatus('Not connected directly yet. Wait a moment or pair again.', true); return; }

  sending = true; cancelledBy = null;
  sendFileBtn.disabled = true; sendFileBtn.textContent = 'Send file';
  cancelTransferBtn.hidden = false; progress.hidden = true;
  let offset = 0;
  const cancelMsg = () => (cancelledBy === 'me'
    ? 'You cancelled the transfer. Choose "Try again" to send it again.'
    : 'The other laptop cancelled the transfer. Choose "Try again" to send it again.');
  try {
    dc.send(JSON.stringify({ type: 'meta', name: file.name, size: file.size, mime: file.type }));
    setStatus(`Waiting for the other laptop to accept ${file.name}...`);
    const reply = await waitForReply(REPLY_TIMEOUT_MS);
    if (cancelledBy) return failTransfer(cancelMsg());
    if (reply === 'reject') return failTransfer('The other laptop rejected the file. Choose "Try again" to send it again.');
    if (reply === 'timeout') {
      safeSend({ type: 'cancel' });
      return failTransfer('No answer after 60 seconds. Ask the other laptop to look for the Accept button, then try again.');
    }
    if (reply !== 'accept') throw new Error('closed');

    showProgress(0);
    setStatus(`Sending ${file.name} (${fmtSize(file.size)})...`);
    while (offset < file.size) {
      if (cancelledBy) return failTransfer(cancelMsg());
      if (dc.bufferedAmount > HIGH_WATER) await drain(HIGH_WATER / 2);
      let buf;
      try { buf = await file.slice(offset, offset + CHUNK).arrayBuffer(); }
      catch {
        safeSend({ type: 'cancel' });
        return failTransfer(`Couldn't read ${file.name}. It may have been moved, deleted or locked by another program. Choose it again, then try again.`);
      }
      dc.send(buf);
      offset += buf.byteLength;
      showProgress(offset / file.size * 100);
    }
    dc.send(JSON.stringify({ type: 'done' }));
    await drain(0);
    if (cancelledBy) return failTransfer(cancelMsg());
    sending = false; sendFileBtn.disabled = false; cancelTransferBtn.hidden = true;
    setStatus(`Sent ${file.name} (${fmtSize(file.size)}). Choose another file to send more.`);
  } catch {
    failTransfer(`Connection dropped at ${Math.round(offset / file.size * 100)}%. Pair again to retry.`);
  }
}

function onOffer(m) {
  if (role !== 'receiver') return;
  if (incoming || offer) return safeSend({ type: 'reject' }); // already busy
  if (!Number.isFinite(m.size) || m.size <= 0 || m.size > MAX_BYTES) {
    safeSend({ type: 'reject' });
    return failTransfer('The sender offered a file over the 500 MB limit. It was rejected automatically.');
  }
  offer = { name: String(m.name || 'file'), size: m.size, mime: m.mime || 'application/octet-stream' };
  download.hidden = true; progress.hidden = true;
  offerText.textContent = `Incoming file: ${offer.name} (${fmtSize(offer.size)})`;
  offerBox.hidden = false;
  setStatus(`The other laptop wants to send you ${offer.name}. Accept or reject it.`);
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
    if (m.type === 'done' && incoming) {
      if (incoming.received !== incoming.size) {
        return failTransfer('The file arrived incomplete. Ask the sender to try again.');
      }
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      try { downloadUrl = URL.createObjectURL(new Blob(incoming.chunks, { type: incoming.mime })); }
      catch { return failTransfer('Your browser ran out of memory while saving the file. Close other tabs or ask for a smaller file.'); }
      download.href = downloadUrl;
      download.download = incoming.name;
      download.textContent = `Save ${incoming.name} (${fmtSize(incoming.size)})`;
      download.hidden = false;
      cancelTransferBtn.hidden = true;
      setStatus('File received. Use the link below to save it.');
      download.focus();
      incoming = null;
    }
  } else if (incoming) {
    try { incoming.chunks.push(e.data); }
    catch {
      safeSend({ type: 'cancel' });
      return failTransfer('Your browser ran out of memory while receiving. Close other tabs or ask for a smaller file.');
    }
    incoming.received += e.data.byteLength;
    if (incoming.received > incoming.size) {
      safeSend({ type: 'cancel' });
      return failTransfer('Received more data than expected. Ask the sender to try again.');
    }
    showProgress(incoming.received / incoming.size * 100);
  }
}

// ---------- controls ----------
sendBtn.addEventListener('click', () => {
  if (state !== 'idle') return; // ignore double clicks
  setState('waiting'); codeBox.hidden = true;
  setStatus('Getting a code...');
  open({ type: 'create' });
});

function join() {
  if (state !== 'idle') return;
  const code = codeInput.value.trim();
  if (!/^\d{6}$/.test(code)) { setStatus(MESSAGES['bad-code'], true); codeInput.focus(); return; }
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
  incoming = { ...offer, chunks: [], received: 0 };
  offer = null; offerBox.hidden = true; cancelTransferBtn.hidden = false;
  showProgress(0);
  setStatus(`Receiving ${incoming.name} (${fmtSize(incoming.size)})...`);
  safeSend({ type: 'accept' });
});
rejectBtn.addEventListener('click', () => {
  if (!offer) return;
  offer = null; offerBox.hidden = true;
  safeSend({ type: 'reject' });
  setStatus('You rejected the file. The sender has been told.');
});
cancelTransferBtn.addEventListener('click', cancelTransfer);

sendFileBtn.addEventListener('click', sendFile);
leaveBtn.addEventListener('click', () => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'leave' }));
  reset('Disconnected.');
  sendBtn.focus();
});

if (typeof RTCPeerConnection === 'undefined' || typeof WebSocket === 'undefined') {
  sendBtn.disabled = true; recvBtn.disabled = true; codeInput.disabled = true;
  setStatus("This browser can't send files directly. Use a current version of Chrome, Edge, Firefox or Safari.", true);
}