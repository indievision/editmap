const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
// Loopback only unless the user explicitly opts in to Wi-Fi screening.
const LAN_ENABLED = process.env.EDITMAP_DUET_LAN === '1';
const HOST = LAN_ENABLED ? '0.0.0.0' : '127.0.0.1';
const MAX_UPLOAD_BYTES = 8 * 1024 ** 3;

// Access control.
// The host's own browser (a loopback connection addressed as localhost) needs no
// secret. Anything else, i.e. Wi-Fi devices, must present this per-launch token,
// delivered once through the join link (?t=...) and then kept in an HttpOnly
// cookie so pages, video, uploads and the WebSocket all authenticate without
// client changes. The Host check also stops DNS rebinding from posing as loopback.
const JOIN_TOKEN = crypto.randomBytes(18).toString('hex');
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function tokenMatches(candidate) {
  if (typeof candidate !== 'string' || candidate.length !== JOIN_TOKEN.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(JOIN_TOKEN));
}

function cookieToken(req) {
  const match = /(?:^|;\s*)duet_token=([0-9a-f]+)/.exec(req.headers.cookie || '');
  return match ? match[1] : '';
}

function isLocalHost(req) {
  const hostname = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
  return LOOPBACK_ADDRESSES.has(req.socket.remoteAddress) && LOOPBACK_HOSTS.has(hostname);
}

function isAuthorized(req) {
  return isLocalHost(req) || tokenMatches(cookieToken(req));
}

function joinUrls() {
  return getLocalIpAddresses().map((ip) => `http://${ip}:${PORT}/?t=${JOIN_TOKEN}`);
}

// A browser page from another site must not drive this server. An Origin is
// accepted when its host is the one the request was addressed to (pages served by
// this server), or when the request comes from this machine and the page is the
// EditMap app itself: the Screening hub embedded in the app is served by Vite and
// connects here from there. These are the same app origins the CV backend allows.
const APP_ORIGINS = new Set([
  ...['127.0.0.1', 'localhost'].flatMap((host) => Array.from({ length: 8 }, (_, i) => `http://${host}:${5173 + i}`)),
  ...String(process.env.EDITMAP_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean),
]);

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    if (new URL(origin).host === req.headers.host) return true;
  } catch { return false; }
  return isLocalHost(req) && APP_ORIGINS.has(origin);
}

// Last-resort guard: one bad request must never end a screening session.
process.on('uncaughtException', (err) => console.error('Uncaught exception:', err));

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// MIME types for static files & video formats
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.m4v': 'video/x-m4v'
};

// The host's analysis data, for the guests' read-only Studio and Explore. The app
// posts it in parts (project, thumbnails, colour profiles) so a small edit does not
// resend the thumbnails. Only the host machine can write it; anyone in the room can read it.
const MAX_ROOM_DATA_BYTES = 256 * 1024 ** 2;
const ROOM_DATA_PARTS = new Set(['project', 'thumbnails', 'colorProfiles']);
const roomData = new Map(); // part -> { version, body }
let roomDataVersion = 0;

// The app (served by Vite) talks to this server from its own origin, on this machine only.
function roomDataCors(req, allowHeaders = 'content-type') {
  const headers = {};
  if (req.headers.origin && APP_ORIGINS.has(req.headers.origin) && isLocalHost(req)) {
    headers['Access-Control-Allow-Origin'] = req.headers.origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = allowHeaders;
    headers['Vary'] = 'Origin';
  }
  return headers;
}

function readLimited(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// HTTP Server with static serving, uploads, and video range streaming
const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const reqPath = parsedUrl.pathname;

  // Join link: validate the token, remember it in a cookie, then drop it from the URL.
  if (req.method === 'GET' && parsedUrl.searchParams.has('t')) {
    if (tokenMatches(parsedUrl.searchParams.get('t'))) {
      res.writeHead(302, {
        // Lax, not Strict: a join link clicked in a chat or mail app starts a cross-site navigation, and
        // Strict would withhold the cookie on the redirect back to "/", leaving a blank 401 page. Lax still
        // keeps it off cross-site background requests (fetch, WebSocket, uploads); the Origin checks stay.
        'Set-Cookie': `duet_token=${JOIN_TOKEN}; HttpOnly; SameSite=Lax; Path=/`,
        'Location': reqPath,
      });
    } else {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
    }
    return res.end();
  }

  // Only the host machine can read the join links.
  if (reqPath === '/api/join-info') {
    if (!isLocalHost(req)) { res.writeHead(403); return res.end(); }
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    // The in-app hub page is served by Vite, so let exactly the app's origins read this.
    if (req.headers.origin && APP_ORIGINS.has(req.headers.origin)) {
      headers['Access-Control-Allow-Origin'] = req.headers.origin;
      headers['Vary'] = 'Origin';
    }
    res.writeHead(200, headers);
    return res.end(JSON.stringify({ lan: LAN_ENABLED, urls: LAN_ENABLED ? joinUrls() : [] }));
  }

  if (!isAuthorized(req)) {
    res.writeHead(401, { 'Content-Type': 'text/plain' });
    return res.end('Open the join link shown on the host to connect.');
  }

  // 0. Analysis data for guests: GET /api/room-data/:part, POST (host machine only)
  const dataMatch = /^\/api\/room-data\/([A-Za-z]+)$/.exec(reqPath);
  if (dataMatch) {
    const part = dataMatch[1];
    if (!ROOM_DATA_PARTS.has(part)) { res.writeHead(404); return res.end(); }
    const cors = roomDataCors(req);
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (req.method === 'GET') {
      const entry = roomData.get(part);
      if (!entry) { res.writeHead(404, cors); return res.end(); }
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Room-Version': String(entry.version) });
      return res.end(entry.body);
    }
    if (req.method === 'POST') {
      if (!isLocalHost(req) || !sameOrigin(req)) { res.writeHead(403, cors); return res.end(); }
      readLimited(req, MAX_ROOM_DATA_BYTES).then((body) => {
        try { JSON.parse(body.toString('utf8')); } catch { res.writeHead(400, cors); return res.end(); }
        const version = ++roomDataVersion;
        roomData.set(part, { version, body });
        const update = JSON.stringify({ type: 'ROOM_DATA_UPDATED', part, version });
        for (const room of rooms.values()) {
          for (const client of room.clients) if (client.readyState === WebSocket.OPEN) client.send(update);
        }
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ version }));
      }, () => {
        if (!res.headersSent) { res.writeHead(413, cors); res.end(); }
      });
      return;
    }
    res.writeHead(405, cors);
    return res.end();
  }

  // Films already on this machine's room server, so the host's page can recognise one it uploaded earlier.
  if (req.method === 'GET' && reqPath === '/api/uploads') {
    const cors = roomDataCors(req);
    if (!isLocalHost(req)) { res.writeHead(403); return res.end(); }
    let files = [];
    try {
      files = fs.readdirSync(UPLOADS_DIR)
        .map((name) => ({ name, stat: fs.statSync(path.join(UPLOADS_DIR, name)) }))
        .filter((f) => f.stat.isFile())
        .map((f) => ({ name: f.name, size: f.stat.size }));
    } catch { /* an empty list is fine */ }
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(files));
  }

  // 1. In-App Video Upload: POST /api/upload
  if (reqPath === '/api/upload' && req.method === 'OPTIONS') {
    res.writeHead(204, roomDataCors(req, 'x-file-name, content-type'));
    return res.end();
  }
  if (req.method === 'POST' && reqPath === '/api/upload') {
    // The embedded hub uploads from the app's origin, so its answer must carry the CORS headers too.
    const cors = roomDataCors(req, 'x-file-name, content-type');
    if (!sameOrigin(req)) { res.writeHead(403); return res.end(); }
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > MAX_UPLOAD_BYTES) { res.writeHead(413, cors); return res.end(); }
    let rawFileName = String(req.headers['x-file-name'] || `video_${Date.now()}.mp4`);
    try { rawFileName = decodeURIComponent(rawFileName); } catch { /* keep raw */ }
    const cleanFileName = path.basename(rawFileName).replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_') || `video_${Date.now()}.mp4`;
    const targetFilePath = path.join(UPLOADS_DIR, cleanFileName);

    const writeStream = fs.createWriteStream(targetFilePath);
    let received = 0;
    let failed = false;
    const fail = (code, message) => {
      if (failed) return;
      failed = true;
      req.unpipe(writeStream);
      writeStream.destroy();
      fs.unlink(targetFilePath, () => {});
      if (!res.headersSent) res.writeHead(code, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: message }));
    };
    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > MAX_UPLOAD_BYTES) fail(413, 'Upload too large');
    });
    req.on('aborted', () => fail(400, 'Upload aborted'));
    req.pipe(writeStream);

    writeStream.on('finish', () => {
      if (failed) return;
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        fileName: cleanFileName,
        url: `/uploads/${encodeURIComponent(cleanFileName)}`,
        size: received
      }));
    });

    writeStream.on('error', (err) => {
      console.error('File write error:', err);
      fail(500, 'Could not store upload');
    });
    return;
  }

  // 2. Video Streaming with HTTP Range Requests: GET /uploads/:filename
  if (reqPath.startsWith('/uploads/')) {
    let fileName;
    try { fileName = decodeURIComponent(reqPath.slice('/uploads/'.length)); } catch { res.writeHead(400); return res.end(); }
    // Only a bare file name inside uploads/ is addressable: no separators, no traversal.
    const filePath = path.join(UPLOADS_DIR, path.basename(fileName));
    if (fileName !== path.basename(fileName) || path.dirname(filePath) !== UPLOADS_DIR) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('Access Denied');
    }

    let stat;
    try { stat = fs.statSync(filePath); } catch { stat = null; }
    if (!stat || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Video not found');
    }

    const fileSize = stat.size;
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'video/mp4';
    const sendStream = (options, headers, code) => {
      const file = fs.createReadStream(filePath, options);
      file.on('error', () => res.destroy());
      res.on('close', () => file.destroy());
      res.writeHead(code, headers);
      file.pipe(res);
    };

    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      let start = 0;
      let end = fileSize - 1;
      let valid = !!m && (m[1] !== '' || m[2] !== '');
      if (valid && m[1] === '') {            // suffix range: last N bytes
        start = Math.max(0, fileSize - Number(m[2]));
      } else if (valid) {
        start = Number(m[1]);
        if (m[2] !== '') end = Math.min(Number(m[2]), fileSize - 1);
      }
      if (!valid || !Number.isSafeInteger(start) || start > end || start >= fileSize) {
        res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
        return res.end();
      }
      sendStream({ start, end }, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': contentType,
      }, 206);
    } else {
      sendStream({}, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes'
      }, 200);
    }
    return;
  }

  // 3. Static Files from public/
  let filePath = path.join(PUBLIC_DIR, reqPath === '/' ? '/duet.html' : reqPath.endsWith('/') ? `${reqPath}index.html` : reqPath);

  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Access Denied');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not Found');
      }
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('Internal Server Error');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    // Pages must be re-checked every time: with no cache header Safari reuses an old copy, so a guest
    // can keep running yesterday's page after the host has updated it. (Built guest assets are hashed.)
    const headers = { 'Content-Type': contentType };
    if (ext === '.html') headers['Cache-Control'] = 'no-cache';
    res.writeHead(200, headers);
    res.end(data);
  });
});

// WebSocket Sync Server
const wss = new WebSocketServer({
  server,
  maxPayload: 1024 * 1024,
  // Reject cross-site WebSocket hijacking from pages on other origins.
  verifyClient: ({ req }) => sameOrigin(req) && isAuthorized(req),
});

// Rooms map: roomCode -> { clients: Set, clientMeta: Map, state: { isPlaying, currentTime, markers, activeMarkerId, videoUrl, videoName, mode } }
const rooms = new Map();

function getOrCreateRoom(roomCode) {
  if (!rooms.has(roomCode)) {
    rooms.set(roomCode, {
      clients: new Set(),
      clientMeta: new Map(),
      state: {
        isPlaying: false,
        currentTime: 0,
        markers: [],
        activeMarkerId: null,
        videoUrl: null,
        videoName: null,
        mode: 'screening',
        updatedAt: 0,
        workspace: null
      }
    });
  }
  return rooms.get(roomCode);
}

function broadcastToRoom(roomCode, senderWs, messageData, includeSender = false) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const payload = JSON.stringify(messageData);
  for (const client of room.clients) {
    if ((includeSender || client !== senderWs) && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

// Only the host drives the room. Everything else a participant sends is their own
// contribution (markers, notes, drawings) and is checked per message below.
// Marker ids reach the room as numbers (made on a page) and as text (after the app has saved them in the
// project), so they are always compared as text.
const sameId = (a, b) => String(a) === String(b);

const HOST_ONLY_MESSAGES = new Set([
  'SHARE_VIDEO', 'CLEAR_MARKERS', 'CLEAR_DRAW', 'PLAY', 'PAUSE', 'SEEK', 'MODE_CHANGE', 'SELECT_MARKER',
  'TIME_PULSE', 'WORKSPACE_STATE', 'RESTORE_MARKERS'
]);

// What the host is looking at in the app (Screening, Review, Studio or Explore, the
// selected shot, open tool...). The server keeps the latest one so a guest who joins
// late starts from it, and relays every change. It is opaque to the server apart from
// these bounds: the shape is defined by src/playback/workspaceState.ts.
const WORKSPACES = new Set(['screening', 'review', 'studio', 'explore']);
const MAX_WORKSPACE_BYTES = 16 * 1024;

function sanitizeWorkspace(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  if (!WORKSPACES.has(state.mode)) return null;
  let json;
  try { json = JSON.stringify(state); } catch { return null; }
  if (json.length > MAX_WORKSPACE_BYTES) return null;
  return JSON.parse(json);
}

// The room's playhead as it is now: while playing, the stored time keeps advancing.
function liveTime(room) {
  const { isPlaying, currentTime, updatedAt } = room.state;
  if (!isPlaying || !updatedAt) return currentTime;
  return currentTime + (Date.now() - updatedAt) / 1000;
}

function setPlayhead(room, currentTime, isPlaying) {
  if (typeof currentTime === 'number' && Number.isFinite(currentTime)) room.state.currentTime = currentTime;
  if (typeof isPlaying === 'boolean') room.state.isPlaying = isPlaying;
  room.state.updatedAt = Date.now();
}

wss.on('connection', (ws, req) => {
  // The host is the machine running this server. A client cannot claim it: a
  // connection from any other device is a guest whatever role it asks for.
  const fromHostMachine = isLocalHost(req);
  let currentRoomCode = null;
  let clientInfo = { id: crypto.randomUUID(), name: 'Anonymous', avatar: '🎬', role: 'student' };

  ws.on('message', (rawMessage) => {
    try {
      const data = JSON.parse(rawMessage);
      const { type, roomCode } = data;

      if (type === 'JOIN_ROOM') {
        currentRoomCode = roomCode || '4821';
        const role = fromHostMachine && data.role === 'host' ? 'host' : 'student';
        clientInfo = {
          id: clientInfo.id,
          name: data.name || (role === 'host' ? 'Teacher' : 'Student'),
          avatar: data.avatar || (role === 'host' ? '🎓' : '🎬'),
          role
        };

        const room = getOrCreateRoom(currentRoomCode);
        room.clients.add(ws);
        room.clientMeta.set(ws, clientInfo);

        // Send current room state & connected participants list
        const participants = Array.from(room.clientMeta.values());
        ws.send(JSON.stringify({
          type: 'INIT_STATE',
          state: { ...room.state, currentTime: liveTime(room) },
          participants: participants,
          connectedCount: room.clients.size,
          yourInfo: clientInfo
        }));

        // Broadcast to peers that a new student/host joined
        broadcastToRoom(currentRoomCode, ws, {
          type: 'PEER_JOINED',
          user: clientInfo,
          participants: participants,
          connectedCount: room.clients.size
        }, false);

        console.log(`[Room ${currentRoomCode}] ${clientInfo.name} (${clientInfo.avatar} - ${clientInfo.role}) joined. Total: ${room.clients.size}`);
      } 
      else if (currentRoomCode) {
        const room = rooms.get(currentRoomCode);
        if (!room) return;

        if (HOST_ONLY_MESSAGES.has(type) && clientInfo.role !== 'host') return;

        // Shared Video File: Starting a new film resets markers for a clean slate
        if (type === 'SHARE_VIDEO') {
          room.state.videoUrl = data.videoUrl;
          room.state.videoName = data.videoName;
          room.state.markers = [];
          room.state.activeMarkerId = null;
          room.state.currentTime = 0;
          broadcastToRoom(currentRoomCode, ws, {
            type: 'VIDEO_SHARED',
            videoUrl: data.videoUrl,
            videoName: data.videoName,
            sender: clientInfo
          }, false);
        }
        // Explicit clean slate request
        else if (type === 'CLEAR_MARKERS') {
          room.state.markers = [];
          room.state.activeMarkerId = null;
          broadcastToRoom(currentRoomCode, ws, {
            type: 'CLEAR_MARKERS'
          }, false);
        }
        // Playback Sync
        else if (type === 'PLAY') {
          setPlayhead(room, data.currentTime, true);
          broadcastToRoom(currentRoomCode, ws, {
            type: 'PLAY',
            currentTime: data.currentTime
          }, false);
        } 
        else if (type === 'PAUSE') {
          setPlayhead(room, data.currentTime, false);
          broadcastToRoom(currentRoomCode, ws, {
            type: 'PAUSE',
            currentTime: data.currentTime
          }, false);
        } 
        else if (type === 'SEEK') {
          setPlayhead(room, data.currentTime);
          broadcastToRoom(currentRoomCode, ws, {
            type: 'SEEK',
            currentTime: data.currentTime
          }, false);
        } 
        // Mode Switch (Screening vs Review)
        else if (type === 'MODE_CHANGE') {
          room.state.mode = data.mode;
          broadcastToRoom(currentRoomCode, ws, {
            type: 'MODE_CHANGE',
            mode: data.mode
          }, false);
        }
        // Silent Marker Drop during Screening or Review
        else if (type === 'ADD_MARKER') {
          const marker = {
            ...data.marker,
            authorId: clientInfo.id,
            authorName: clientInfo.name,
            authorAvatar: clientInfo.avatar,
            role: clientInfo.role
          };
          // A marker is added once: the same id arriving again (a resend) is ignored.
          if (room.state.markers.some(m => sameId(m.id, marker.id))) return;
          room.state.markers.push(marker);
          broadcastToRoom(currentRoomCode, ws, {
            type: 'ADD_MARKER',
            marker: marker
          }, true);
        }
        // The host's saved markers (from the project) join the room, keeping who originally wrote them.
        else if (type === 'RESTORE_MARKERS') {
          const known = new Set(room.state.markers.map(m => String(m.id)));
          for (const saved of Array.isArray(data.markers) ? data.markers.slice(0, 2000) : []) {
            if (!saved || saved.id === undefined || known.has(String(saved.id))) continue;
            known.add(String(saved.id));
            const marker = { ...saved, authorId: clientInfo.id, role: 'host' };
            room.state.markers.push(marker);
            broadcastToRoom(currentRoomCode, ws, { type: 'ADD_MARKER', marker }, false);
          }
        }
        // Edit cue note in Review Mode
        else if (type === 'UPDATE_MARKER') {
          const { id, note, solved } = data;
          const target = room.state.markers.find(m => sameId(m.id, id));
          // A marker is edited by its author or by the host, nobody else.
          if (target && (clientInfo.role === 'host' || target.authorId === clientInfo.id)) {
            if (note !== undefined) target.note = note;
            if (solved !== undefined) target.solved = solved;
            broadcastToRoom(currentRoomCode, ws, {
              type: 'UPDATE_MARKER',
              id, note, solved
            }, false);
          }
        }
        // Delete a marker: its author or the host, like editing its note.
        else if (type === 'DELETE_MARKER') {
          const index = room.state.markers.findIndex(m => sameId(m.id, data.id));
          if (index === -1) return;
          const target = room.state.markers[index];
          if (clientInfo.role !== 'host' && target.authorId !== clientInfo.id) return;
          room.state.markers.splice(index, 1);
          if (sameId(room.state.activeMarkerId, data.id)) room.state.activeMarkerId = null;
          broadcastToRoom(currentRoomCode, ws, { type: 'DELETE_MARKER', id: data.id }, false);
        }
        // Select Cue in Review Mode
        else if (type === 'SELECT_MARKER') {
          room.state.activeMarkerId = data.id;
          setPlayhead(room, data.currentTime);
          broadcastToRoom(currentRoomCode, ws, {
            type: 'SELECT_MARKER',
            id: data.id,
            currentTime: data.currentTime
          }, false);
        }
        // Host heartbeat while playing, so followers correct drift.
        else if (type === 'TIME_PULSE') {
          setPlayhead(room, data.currentTime, data.isPlaying === true);
          broadcastToRoom(currentRoomCode, ws, {
            type: 'TIME_PULSE',
            currentTime: room.state.currentTime,
            isPlaying: room.state.isPlaying
          }, false);
        }
        // The host's app workspace (also carries the playhead while the host is in Studio or Explore).
        else if (type === 'WORKSPACE_STATE') {
          const workspace = sanitizeWorkspace(data.state);
          if (!workspace) return;
          const wasInApp = room.state.workspace && (room.state.workspace.mode === 'studio' || room.state.workspace.mode === 'explore');
          room.state.workspace = workspace;
          // The app pauses when the host leaves Studio or Explore, and its Screening/Review state carries no play flag.
          if (wasInApp && (workspace.mode === 'screening' || workspace.mode === 'review') && typeof workspace.time !== 'number') {
            setPlayhead(room, undefined, false);
          }
          if (workspace.mode === 'screening' || workspace.mode === 'review') room.state.mode = workspace.mode;
          if (typeof workspace.time === 'number') setPlayhead(room, workspace.time, workspace.playing === true);
          broadcastToRoom(currentRoomCode, ws, { type: 'WORKSPACE_STATE', state: workspace }, false);
        }
        // Grease Pencil Drawing Sync
        // Drawing belongs to Review, where the frame is still; nobody draws during a screening.
        else if (type === 'DRAW_STROKE') {
          if (room.state.mode !== 'review') return;
          broadcastToRoom(currentRoomCode, ws, {
            type: 'DRAW_STROKE',
            stroke: data.stroke,
            authorId: clientInfo.id
          }, false);
        }
        else if (type === 'CLEAR_DRAW') {
          broadcastToRoom(currentRoomCode, ws, {
            type: 'CLEAR_DRAW'
          }, false);
        }
        // Anyone can take back their own strokes, nobody else's.
        else if (type === 'ERASE_DRAW') {
          broadcastToRoom(currentRoomCode, ws, {
            type: 'ERASE_DRAW',
            authorId: clientInfo.id
          }, false);
        }
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    if (currentRoomCode && rooms.has(currentRoomCode)) {
      const room = rooms.get(currentRoomCode);
      room.clients.delete(ws);
      room.clientMeta.delete(ws);
      const participants = Array.from(room.clientMeta.values());
      console.log(`[Room ${currentRoomCode}] ${clientInfo.name} disconnected. Remaining: ${room.clients.size}`);
      if (room.clients.size > 0) {
        broadcastToRoom(currentRoomCode, ws, {
          type: 'PEER_LEFT',
          user: clientInfo,
          participants: participants,
          connectedCount: room.clients.size
        }, false);
      }
    }
  });
});

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

server.listen(PORT, HOST, () => {
  const localIps = getLocalIpAddresses();
  console.log('====================================================');
  console.log(`🎬 DUET Cinema Screening & Review Console Running!`);
  console.log(`💻 Local access (This Mac):   http://localhost:${PORT}`);
  if (LAN_ENABLED) {
    localIps.forEach(ip => {
      console.log(`📱 Connect PC/iPad on Wi-Fi: http://${ip}:${PORT}/?t=${JOIN_TOKEN}`);
    });
    console.log('   (the link contains this launch\'s join secret: share it only with your audience)');
  } else {
    console.log('🔒 Loopback only. Set EDITMAP_DUET_LAN=1 to allow Wi-Fi devices.');
  }
  console.log('====================================================');
});
