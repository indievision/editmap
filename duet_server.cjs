const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
// Loopback only unless the user explicitly opts in to Wi-Fi screening.
const LAN_ENABLED = process.env.EDITMAP_DUET_LAN === '1';
const HOST = LAN_ENABLED ? '0.0.0.0' : '127.0.0.1';
const MAX_UPLOAD_BYTES = 8 * 1024 ** 3;

// A browser page from another site must not drive this server: when an Origin
// header is present its host must be the host the request was addressed to.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
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

// HTTP Server with static serving, uploads, and video range streaming
const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const reqPath = parsedUrl.pathname;

  // 1. In-App Video Upload: POST /api/upload
  if (req.method === 'POST' && reqPath === '/api/upload') {
    if (!sameOrigin(req)) { res.writeHead(403); return res.end(); }
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > MAX_UPLOAD_BYTES) { res.writeHead(413); return res.end(); }
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
      if (!res.headersSent) res.writeHead(code, { 'Content-Type': 'application/json' });
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
      res.writeHead(200, { 'Content-Type': 'application/json' });
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
  let filePath = path.join(PUBLIC_DIR, reqPath === '/' ? '/duet.html' : reqPath);

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
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// WebSocket Sync Server
const wss = new WebSocketServer({
  server,
  maxPayload: 1024 * 1024,
  // Reject cross-site WebSocket hijacking from pages on other origins.
  verifyClient: ({ req }) => sameOrigin(req),
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
        mode: 'screening'
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

wss.on('connection', (ws) => {
  let currentRoomCode = null;
  let clientInfo = { name: 'Anonymous', avatar: '🎬', role: 'guest' };

  ws.on('message', (rawMessage) => {
    try {
      const data = JSON.parse(rawMessage);
      const { type, roomCode } = data;

      if (type === 'JOIN_ROOM') {
        currentRoomCode = roomCode || '4821';
        clientInfo = {
          name: data.name || (data.role === 'host' ? 'Teacher' : 'Student'),
          avatar: data.avatar || (data.role === 'host' ? '🎓' : '🎬'),
          role: data.role || 'student'
        };

        const room = getOrCreateRoom(currentRoomCode);
        room.clients.add(ws);
        room.clientMeta.set(ws, clientInfo);

        // Send current room state & connected participants list
        const participants = Array.from(room.clientMeta.values());
        ws.send(JSON.stringify({
          type: 'INIT_STATE',
          state: room.state,
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
          room.state.isPlaying = true;
          room.state.currentTime = data.currentTime;
          broadcastToRoom(currentRoomCode, ws, {
            type: 'PLAY',
            currentTime: data.currentTime
          }, false);
        } 
        else if (type === 'PAUSE') {
          room.state.isPlaying = false;
          room.state.currentTime = data.currentTime;
          broadcastToRoom(currentRoomCode, ws, {
            type: 'PAUSE',
            currentTime: data.currentTime
          }, false);
        } 
        else if (type === 'SEEK') {
          room.state.currentTime = data.currentTime;
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
            authorName: clientInfo.name,
            authorAvatar: clientInfo.avatar,
            role: clientInfo.role
          };
          room.state.markers.push(marker);
          broadcastToRoom(currentRoomCode, ws, {
            type: 'ADD_MARKER',
            marker: marker
          }, true);
        }
        // Edit cue note in Review Mode
        else if (type === 'UPDATE_MARKER') {
          const { id, note, solved } = data;
          const target = room.state.markers.find(m => m.id === id);
          if (target) {
            if (note !== undefined) target.note = note;
            if (solved !== undefined) target.solved = solved;
            broadcastToRoom(currentRoomCode, ws, {
              type: 'UPDATE_MARKER',
              id, note, solved
            }, false);
          }
        }
        // Select Cue in Review Mode
        else if (type === 'SELECT_MARKER') {
          room.state.activeMarkerId = data.id;
          room.state.currentTime = data.currentTime;
          broadcastToRoom(currentRoomCode, ws, {
            type: 'SELECT_MARKER',
            id: data.id,
            currentTime: data.currentTime
          }, false);
        }
        // Grease Pencil Drawing Sync
        else if (type === 'DRAW_STROKE') {
          broadcastToRoom(currentRoomCode, ws, {
            type: 'DRAW_STROKE',
            stroke: data.stroke
          }, false);
        }
        else if (type === 'CLEAR_DRAW') {
          broadcastToRoom(currentRoomCode, ws, {
            type: 'CLEAR_DRAW'
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
      console.log(`📱 Connect PC/iPad on Wi-Fi: http://${ip}:${PORT}`);
    });
  } else {
    console.log('🔒 Loopback only. Set EDITMAP_DUET_LAN=1 to allow Wi-Fi devices.');
  }
  console.log('====================================================');
});
