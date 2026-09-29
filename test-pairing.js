// Run: PORT=3100 CODE_TTL_MS=800 node server.js   (in one terminal)
//      npm test                                    (in another)
const WebSocket = require('ws');
const url = 'ws://localhost:3100/ws';
const open = () => new Promise(r => { const w = new WebSocket(url); w.q = []; w.on('message', m => { const d = JSON.parse(m); w.q.push(d); w.emit('msg', d); }); w.on('open', () => r(w)); });
const next = (w) => new Promise(r => { if (w.q.length) return r(w.q.shift()); w.once('msg', () => r(w.q.shift())); });
const ok = (name, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) process.exitCode = 1; };
(async () => {
  const a = await open(), b = await open();
  a.send(JSON.stringify({ type: 'create' }));
  const c = await next(a); ok('create returns 6-digit code', /^\d{6}$/.test(c.code));
  b.send(JSON.stringify({ type: 'join', code: c.code }));
  ok('sender paired', (await next(a)).type === 'paired');
  ok('receiver paired', (await next(b)).role === 'receiver');
  b.send(JSON.stringify({ type: 'signal', data: { x: 1 } }));
  ok('signal relayed', (await next(a)).data.x === 1);
  const c2 = await open(); c2.send(JSON.stringify({ type: 'join', code: c.code }));
  ok('code-in-use', (await next(c2)).code === 'code-in-use');
  b.close(); ok('peer-left on disconnect', (await next(a)).type === 'peer-left');
  const d = await open(); d.send(JSON.stringify({ type: 'join', code: '12' }));
  ok('bad-code', (await next(d)).code === 'bad-code');
  d.send(JSON.stringify({ type: 'join', code: '000000' }));
  ok('code-not-found', (await next(d)).code === 'code-not-found');
  const e = await open(); e.send(JSON.stringify({ type: 'create' })); const ce = await next(e);
  ok('expiry notice', (await next(e)).type === 'expired');
  d.send(JSON.stringify({ type: 'join', code: ce.code }));
  ok('code-expired explained', (await next(d)).code === 'code-expired');
  let last; for (let i = 0; i < 6; i++) { d.send(JSON.stringify({ type: 'join', code: '999999' })); last = await next(d); }
  ok('too-many-attempts', last.code === 'too-many-attempts');
  process.exit();
})();