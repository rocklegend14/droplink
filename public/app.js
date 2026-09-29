// Step 2: pairing UI. File transfer (step 3+) builds on the paired connection.
'use strict';
const $ = (id) => document.getElementById(id);
const statusEl = $('status'), sendBtn = $('send-btn'), recvBtn = $('recv-btn'),
  cancelBtn = $('cancel-btn'), codeInput = $('code'), codeBox = $('code-box'), codeOut = $('code-out');

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

let ws = null, state = 'idle'; // idle | waiting | joining | paired

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
}

function setState(next) {
  state = next;
  const busy = next !== 'idle';
  sendBtn.disabled = busy; recvBtn.disabled = busy; codeInput.disabled = busy;
  codeBox.hidden = next !== 'waiting';
  cancelBtn.hidden = next !== 'waiting';
}

function closeSocket() {
  if (ws) { ws.onclose = null; ws.onerror = null; ws.close(); ws = null; }
}

function reset(msg, isError) {
  closeSocket();
  setState('idle');
  setStatus(msg, isError);
}

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
    return reset(SERVER_DOWN, true);
  }
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = () => { if (state !== 'idle') reset('Lost the connection to the pairing server. Start again.', true); };
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
      setState('paired');
      cancelBtn.hidden = true; codeBox.hidden = true;
      setStatus(msg.role === 'sender'
        ? 'Paired. The other laptop is connected. Sending files comes in the next step.'
        : 'Paired with the sending laptop. Waiting for files (next step).');
      break;
    case 'expired':
      reset('Your code expired after no one used it. Click "Get pairing code" for a new one.', true);
      sendBtn.focus();
      break;
    case 'peer-left':
      reset('The other laptop disconnected. Start again with a new code.', true);
      break;
    case 'error':
      reset(MESSAGES[msg.code] || 'Something went wrong. Try again.', true);
      if (msg.code !== 'bad-code') codeInput.focus();
      break;
  }
}

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
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cancel(); });