// Pairing: creates 6-digit codes and relays handshake messages between two browsers.
// It never sees file data. Files travel directly between browsers (step 3+).
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const CODE_TTL_MS = Number(process.env.CODE_TTL_MS) || 5 * 60 * 1000; // code lifetime
const EXPIRED_MEMORY_MS = 10 * 60 * 1000; // remember expired codes to explain the error
const MAX_BAD_ATTEMPTS = 5; // wrong codes allowed per IP per window
const ATTEMPT_WINDOW_MS = 60 * 1000;

function attachPairing(server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
  const rooms = new Map();   // code -> { sender, receiver, timer }
  const expired = new Map(); // code -> cleanup timer
  const attempts = new Map(); // ip -> { n, resetAt }

  const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const fail = (ws, code) => send(ws, { type: 'error', code });

  function newCode() {
    let code;
    do { code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'); }
    while (rooms.has(code) || expired.has(code));
    return code;
  }

  function leave(ws) {
    const info = ws.room;
    if (!info) return;
    ws.room = null;
    const room = rooms.get(info.code);
    if (!room) return;
    clearTimeout(room.timer);
    rooms.delete(info.code);
    const other = info.role === 'sender' ? room.receiver : room.sender;
    if (other) { other.room = null; send(other, { type: 'peer-left' }); }
  }

  function badAttempt(ip) {
    const now = Date.now();
    let a = attempts.get(ip);
    if (!a || a.resetAt < now) a = { n: 0, resetAt: now + ATTEMPT_WINDOW_MS };
    a.n += 1;
    attempts.set(ip, a);
    return a.n > MAX_BAD_ATTEMPTS;
  }
  const blocked = (ip) => { const a = attempts.get(ip); return a && a.resetAt > Date.now() && a.n >= MAX_BAD_ATTEMPTS; };

  wss.on('connection', (ws, req) => {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    ws.isAlive = true;
    ws.room = null;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return fail(ws, 'bad-message'); }

      if (msg.type === 'create') {
        leave(ws);
        const code = newCode();
        const room = { sender: ws, receiver: null, timer: null };
        room.timer = setTimeout(() => {
          if (rooms.get(code) !== room) return;
          rooms.delete(code);
          ws.room = null;
          send(ws, { type: 'expired' });
          expired.set(code, setTimeout(() => expired.delete(code), EXPIRED_MEMORY_MS));
        }, CODE_TTL_MS);
        rooms.set(code, room);
        ws.room = { code, role: 'sender' };
        return send(ws, { type: 'created', code, ttlMs: CODE_TTL_MS });
      }

      if (msg.type === 'join') {
        const code = String(msg.code || '');
        if (!/^\d{6}$/.test(code)) return fail(ws, 'bad-code');
        if (blocked(ip)) return fail(ws, 'too-many-attempts');
        const room = rooms.get(code);
        if (!room) {
          badAttempt(ip);
          return fail(ws, expired.has(code) ? 'code-expired' : 'code-not-found');
        }
        if (room.receiver) return fail(ws, 'code-in-use');
        leave(ws);
        clearTimeout(room.timer);
        room.receiver = ws;
        ws.room = { code, role: 'receiver' };
        send(room.sender, { type: 'paired', role: 'sender' });
        return send(ws, { type: 'paired', role: 'receiver' });
      }

      if (msg.type === 'signal') { // relay WebRTC handshake data to the other device
        const room = ws.room && rooms.get(ws.room.code);
        if (!room || !room.receiver) return fail(ws, 'not-paired');
        const other = ws.room.role === 'sender' ? room.receiver : room.sender;
        return send(other, { type: 'signal', data: msg.data });
      }

      if (msg.type === 'leave') return leave(ws);
      fail(ws, 'bad-message');
    });

    ws.on('close', () => leave(ws));
    ws.on('error', () => leave(ws));
  });

  // Drop dead connections so stale codes don't linger.
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
    const now = Date.now();
    for (const [ip, a] of attempts) if (a.resetAt < now) attempts.delete(ip);
  }, 30000);
  beat.unref();
  wss.on('close', () => clearInterval(beat));
  return wss;
}

module.exports = { attachPairing };