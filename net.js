/* net.js — online play over a WebRTC data channel (PeerJS).
 *
 * The host registers a random room code with the PeerJS signaling server and
 * shares a link (?room=CODE). The guest connects peer-to-peer; after that, game
 * messages never touch a server. PeerJS is vendored (vendor/peerjs.min.js) and
 * loaded lazily, only when online play is used.
 *
 * Hardening (the peer on the other end is untrusted input):
 *   - JSON serialization only (no binary object unpacking).
 *   - Admission: a host connection is inert until its first message, a `hello`, is
 *     approved by the app (seat tokens; see app.js). Unapproved connections are
 *     closed, so a leaked link cannot silently take over a seat.
 *   - Per-connection rate limiting (token bucket); floods close the connection.
 *   - Shape checks before anything reaches the app: plain objects with a short
 *     string type. Field-level validation happens in app.js.
 *   - Room codes carry ~49 bits of entropy (10 chars from a 31-symbol alphabet).
 *   - Signaling-server overrides (?peerHost=…) are honoured only on localhost, so
 *     a crafted link cannot route players through someone else's server.
 */
const Net = (() => {
  const PREFIX = "yc-fiar-";
  const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o, 1/l/i
  const CODE_LEN = 10;
  const CODE_RE = /^[a-z2-9]{6,16}$/;
  const HELLO_TIMEOUT_MS = 8000;
  const MAX_PENDING = 3;
  const RATE = { burst: 40, perSec: 15 };

  let peer = null;
  let conn = null; // the admitted connection
  const pending = new Set();
  let listener = () => {};
  let authorize = async () => ({ ok: false, reason: "closed" });
  let libPromise = null;

  function emit(type, data) {
    try { listener(type, data); } catch (e) { console.error(e); }
  }

  function loadLib() {
    if (window.Peer) return Promise.resolve();
    if (!libPromise) {
      libPromise = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "./vendor/peerjs.min.js";
        s.onload = () => resolve();
        s.onerror = () => { libPromise = null; reject(new Error("Could not load the networking library.")); };
        document.head.appendChild(s);
      });
    }
    return libPromise;
  }

  const isLocalPage = () => ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

  function peerOptions() {
    const opts = { debug: 0 };
    const q = new URLSearchParams(location.search);
    if (isLocalPage() && q.get("peerHost")) {
      // Development only: point at a local signaling server (npx peer --port 9000).
      opts.host = q.get("peerHost");
      opts.port = Number(q.get("peerPort") || 443);
      opts.path = q.get("peerPath") || "/";
      opts.secure = q.get("peerSecure") !== "0";
    }
    return opts;
  }

  function randomCode(len = CODE_LEN) {
    const out = [];
    const buf = new Uint8Array(len * 2);
    while (out.length < len) {
      crypto.getRandomValues(buf);
      for (const v of buf) {
        // Rejection sampling keeps every symbol equally likely.
        if (v < 256 - (256 % ALPHABET.length) && out.length < len) out.push(ALPHABET[v % ALPHABET.length]);
      }
    }
    return out.join("");
  }

  function randomToken() {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  const isMessage = (d) =>
    d !== null && typeof d === "object" && !Array.isArray(d) &&
    typeof d.t === "string" && d.t.length > 0 && d.t.length <= 16;

  function makeBucket() {
    return { tokens: RATE.burst, last: performance.now() };
  }

  function take(bucket) {
    const t = performance.now();
    bucket.tokens = Math.min(RATE.burst, bucket.tokens + ((t - bucket.last) / 1000) * RATE.perSec);
    bucket.last = t;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  function kill(c) {
    pending.delete(c);
    try { c.close(); } catch (_) { /* ignore */ }
  }

  function promote(c) {
    pending.delete(c);
    if (conn && conn !== c) kill(conn);
    conn = c;
  }

  /** Wire handlers on a connection. `admitted` is false for incoming host-side
   *  connections until their hello is approved. */
  function wire(c, admitted) {
    const bucket = makeBucket();
    let deciding = false;
    let flooded = false;
    let timer = 0;
    if (!admitted) {
      pending.add(c);
      timer = setTimeout(() => { if (!admitted) kill(c); }, HELLO_TIMEOUT_MS);
    }
    c.on("data", (d) => {
      if (!take(bucket)) {
        flooded = true;
        kill(c);
        return;
      }
      if (!isMessage(d)) return;
      if (!admitted) {
        if (d.t !== "hello" || deciding) return;
        deciding = true;
        clearTimeout(timer);
        Promise.resolve()
          .then(() => authorize(d))
          .catch(() => ({ ok: false, reason: "error" }))
          .then((res) => {
            const finish = () => {
              if (!res || !res.ok) {
                c.send({ t: "reject", reason: (res && res.reason) || "declined" });
                setTimeout(() => kill(c), 400);
                return;
              }
              admitted = true;
              promote(c);
              if (res.welcome) c.send(res.welcome);
              emit("connected");
            };
            // The hello can arrive before this side's "open" event has fired.
            if (c.open) finish();
            else if (pending.has(c)) c.once("open", finish);
          });
        return;
      }
      if (conn === c) emit("message", d);
    });
    c.on("close", () => {
      clearTimeout(timer);
      pending.delete(c);
      if (conn === c) { conn = null; emit("disconnected", { reason: flooded ? "flood" : "closed" }); }
    });
    c.on("error", (err) => { if (conn === c) emit("error", { message: describe(err) }); });
  }

  function describe(err) {
    const type = err && err.type;
    if (type === "peer-unavailable") return "That game link has expired or the host left.";
    if (type === "network" || type === "server-error" || type === "socket-error") {
      return "Couldn't reach the matchmaking server. Check your connection and try again.";
    }
    if (type === "browser-incompatible") return "This browser doesn't support peer-to-peer play.";
    return "Connection error.";
  }

  /** Create a room. `authorizeFn(hello)` decides admission: resolves to
   *  { ok, reason?, welcome? }. Resolves with the room code once registered. */
  async function host(onEvent, authorizeFn) {
    listener = onEvent;
    authorize = authorizeFn;
    await loadLib();
    leave(false);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const code = randomCode();
      try {
        await new Promise((resolve, reject) => {
          const p = new Peer(PREFIX + code, peerOptions());
          peer = p;
          p.on("open", () => resolve());
          p.on("connection", (c) => {
            if (c.serialization !== "json" || pending.size >= MAX_PENDING) { kill(c); return; }
            wire(c, false);
          });
          p.on("disconnected", () => { if (peer === p && !p.destroyed) p.reconnect(); });
          p.on("error", (err) => {
            if (!p.open) reject(err);
            else if (err.type !== "peer-unavailable") emit("error", { message: describe(err) });
          });
        });
        return code;
      } catch (err) {
        if (peer) peer.destroy();
        peer = null;
        if (err.type !== "unavailable-id") throw new Error(describe(err));
      }
    }
    throw new Error("Couldn't create a room. Try again.");
  }

  /** Join a room. Sends `hello` (with the stored seat token, if any) once the
   *  channel opens; resolves then. Admission results arrive as messages
   *  (`welcome`/`sync` or `reject`). */
  async function join(code, onEvent, hello) {
    if (!isValidCode(code)) throw new Error("That game link looks incomplete. Ask your friend to send it again.");
    listener = onEvent;
    await loadLib();
    leave(false);
    return new Promise((resolve, reject) => {
      const p = new Peer(peerOptions());
      peer = p;
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error("Timed out connecting to your friend. Ask them for a fresh link.")); }
      }, 20000);
      p.on("open", () => {
        const c = p.connect(PREFIX + code, { reliable: true, serialization: "json" });
        wire(c, true);
        conn = c;
        c.on("open", () => {
          c.send(hello);
          if (!settled) { settled = true; clearTimeout(timer); resolve(); }
        });
      });
      p.on("error", (err) => {
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error(describe(err))); }
        else emit("error", { message: describe(err) });
      });
    });
  }

  function isValidCode(code) {
    return typeof code === "string" && CODE_RE.test(code);
  }

  function send(msg) {
    if (conn && conn.open) {
      conn.send(msg);
      return true;
    }
    return false;
  }

  function leave(notify = true) {
    if (notify) send({ t: "bye" });
    for (const c of pending) kill(c);
    if (conn) { try { conn.close(); } catch (_) { /* ignore */ } }
    conn = null;
    if (peer) { try { peer.destroy(); } catch (_) { /* ignore */ } }
    peer = null;
  }

  return {
    host, join, send, leave, isValidCode, randomToken,
    get connected() { return !!(conn && conn.open); },
  };
})();
