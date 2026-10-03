import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { WebSocket } from "ws";

// Runs the real server from a scratch copy so its uploads/ folder never lands in the repo.
const PORT = 39000 + Math.floor(Math.random() * 500);
let child: ChildProcess;
let dir: string;
let token = "";

function request(options: { path: string; method?: string; headers?: Record<string, string>; body?: string }) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path: options.path, method: options.method ?? "GET", headers: options.headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end(options.body);
  });
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "duet-test-"));
  fs.copyFileSync("duet_server.cjs", path.join(dir, "duet_server.cjs"));
  fs.mkdirSync(path.join(dir, "public"));
  fs.writeFileSync(path.join(dir, "public", "duet.html"), "<h1>duet</h1>");
  fs.symlinkSync(path.resolve("node_modules"), path.join(dir, "node_modules"));
  fs.mkdirSync(path.join(dir, "uploads"));
  fs.writeFileSync(path.join(dir, "uploads", "clip.mp4"), "0123456789");
  fs.writeFileSync(path.join(dir, "secret.txt"), "outside");
  child = spawn(process.execPath, ["duet_server.cjs"], { cwd: dir, env: { ...process.env, PORT: String(PORT), EDITMAP_DUET_LAN: "1" } });
  let output = "";
  await new Promise<void>((resolve, reject) => {
    child.stdout!.on("data", (chunk) => {
      output += chunk;
      if (output.includes("Loopback only") || output.includes("join secret") || /Wi-Fi: http/.test(output)) resolve();
    });
    child.on("exit", () => reject(new Error("server exited early: " + output)));
    setTimeout(() => reject(new Error("server did not start: " + output)), 8000);
  });
  token = /t=([0-9a-f]+)/.exec(output)?.[1] ?? "";
  // No non-loopback address on this machine would mean no join line; fetch it from the host-only endpoint instead.
  if (!token) token = /t=([0-9a-f]+)/.exec((await request({ path: "/api/join-info" })).body)?.[1] ?? "";
});

after(() => {
  child?.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the host machine needs no token, but a rebinding Host header does", async () => {
  assert.equal((await request({ path: "/" })).status, 200);
  assert.equal((await request({ path: "/", headers: { Host: `evil.example:${PORT}` } })).status, 401);
});

test("join link validates the token and sets an HttpOnly cookie", async () => {
  assert.ok(token.length >= 32, "a join token is generated");
  const bad = await request({ path: "/?t=deadbeef", headers: { Host: `192.168.0.9:${PORT}` } });
  assert.equal(bad.status, 403);
  const good = await request({ path: `/?t=${token}`, headers: { Host: `192.168.0.9:${PORT}` } });
  assert.equal(good.status, 302);
  assert.match(String(good.headers["set-cookie"]), /duet_token=[0-9a-f]+; HttpOnly; SameSite=Lax/);
  const viaCookie = await request({ path: "/", headers: { Host: `192.168.0.9:${PORT}`, Cookie: `duet_token=${token}` } });
  assert.equal(viaCookie.status, 200);
});

test("join links are readable only from the host", async () => {
  const hostRead = await request({ path: "/api/join-info" });
  assert.equal(hostRead.status, 200);
  const remote = await request({ path: "/api/join-info", headers: { Host: `192.168.0.9:${PORT}`, Cookie: `duet_token=${token}` } });
  assert.equal(remote.status, 403);
});

test("uploads are refused without the secret or from other origins", async () => {
  const remoteHost = `192.168.0.9:${PORT}`;
  assert.equal((await request({ path: "/api/upload", method: "POST", headers: { Host: remoteHost }, body: "x" })).status, 401);
  assert.equal((await request({ path: "/api/upload", method: "POST", headers: { Origin: "https://evil.example", "x-file-name": "a.mp4" }, body: "x" })).status, 403);
  assert.equal((await request({ path: "/api/upload", method: "POST", headers: { Host: remoteHost, Cookie: `duet_token=${token}`, "x-file-name": "ok.mp4" }, body: "x" })).status, 200);
});

test("traversal is refused, ranges are validated, and the server survives a bad Range", async () => {
  assert.equal((await request({ path: "/uploads/..%2Fsecret.txt" })).status, 403);
  assert.equal((await request({ path: "/uploads/clip.mp4", headers: { Range: "bytes=0-3" } })).status, 206);
  assert.equal((await request({ path: "/uploads/clip.mp4", headers: { Range: "bytes=abc-" } })).status, 416);
  assert.equal((await request({ path: "/uploads/clip.mp4", headers: { Range: "bytes=99-" } })).status, 416);
  assert.equal((await request({ path: "/uploads/clip.mp4" })).status, 200, "still serving after bad ranges");
});

function connect(headers: Record<string, string>) {
  return new Promise<"open" | number>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers });
    ws.on("open", () => { ws.close(); resolve("open"); });
    ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    ws.on("error", () => undefined);
  });
}

test("WebSocket upgrades need the host, or the cookie, and a same-site origin", async () => {
  assert.equal(await connect({}), "open", "host machine");
  assert.equal(await connect({ Host: `192.168.0.9:${PORT}` }), 401, "remote without secret");
  assert.equal(await connect({ Host: `192.168.0.9:${PORT}`, Cookie: `duet_token=${token}` }), "open", "remote with secret");
  assert.equal(await connect({ Origin: "https://evil.example", Cookie: `duet_token=${token}` }), 401, "cross-site page, even with a cookie");
});

test("the EditMap app's own origin (the embedded hub, served by Vite) may connect from this machine", async () => {
  assert.equal(await connect({ Origin: "http://127.0.0.1:5173" }), "open");
  assert.equal(await connect({ Origin: "http://localhost:5174" }), "open");
  assert.equal(await connect({ Origin: "http://127.0.0.1:9999" }), 401, "other localhost pages stay out");
  // A remote device cannot borrow the app origin: it is not a loopback connection.
  assert.equal(await connect({ Origin: "http://127.0.0.1:5173", Host: `192.168.0.9:${PORT}` }), 401);

  const info = await request({ path: "/api/join-info", headers: { Origin: "http://127.0.0.1:5173" } });
  assert.equal(info.headers["access-control-allow-origin"], "http://127.0.0.1:5173");
  const other = await request({ path: "/api/join-info", headers: { Origin: "http://127.0.0.1:9999" } });
  assert.equal(other.headers["access-control-allow-origin"], undefined, "other origins cannot read the join link");
});

// --- Roles: the host drives the room, guests contribute -------------------------------------

type Peer = { ws: WebSocket; messages: any[]; send: (message: object) => void; close: () => void };

async function joinRoom(room: string, role: "host" | "student", name: string, remote: boolean): Promise<Peer> {
  const headers: Record<string, string> = remote ? { Host: `192.168.0.9:${PORT}`, Cookie: `duet_token=${token}` } : {};
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers });
  const messages: any[] = [];
  ws.on("message", (raw) => messages.push(JSON.parse(String(raw))));
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", reject);
  });
  const peer: Peer = { ws, messages, send: (message) => ws.send(JSON.stringify(message)), close: () => ws.close() };
  peer.send({ type: "JOIN_ROOM", roomCode: room, role, name });
  await until(() => messages.some((m) => m.type === "INIT_STATE"));
  return peer;
}

async function until(condition: () => boolean, ms = 2000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting for a message");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
const received = (peer: Peer, type: string) => peer.messages.filter((m) => m.type === type);

test("a device that is not the host machine cannot claim the host role", async () => {
  const room = "roles-claim";
  const guest = await joinRoom(room, "host", "Sneaky", true);
  assert.equal(guest.messages.find((m) => m.type === "INIT_STATE").yourInfo.role, "student");
  const host = await joinRoom(room, "host", "Teacher", false);
  assert.equal(host.messages.find((m) => m.type === "INIT_STATE").yourInfo.role, "host");
  guest.close();
  host.close();
});

test("only the host moves playback, switches mode, changes the film or clears the room", async () => {
  const room = "roles-transport";
  const host = await joinRoom(room, "host", "Teacher", false);
  const guest = await joinRoom(room, "student", "Anna", true);

  for (const message of [
    { type: "PLAY", currentTime: 5 }, { type: "PAUSE", currentTime: 5 }, { type: "SEEK", currentTime: 9 },
    { type: "MODE_CHANGE", mode: "review" }, { type: "SHARE_VIDEO", videoUrl: "/uploads/x.mp4", videoName: "x" },
    { type: "CLEAR_MARKERS" }, { type: "CLEAR_DRAW" }, { type: "SELECT_MARKER", id: "m", currentTime: 3 },
  ]) guest.send(message);
  await settle();
  for (const type of ["PLAY", "PAUSE", "SEEK", "MODE_CHANGE", "VIDEO_SHARED", "CLEAR_MARKERS", "CLEAR_DRAW", "SELECT_MARKER"]) {
    assert.equal(received(host, type).length, 0, `host must not receive ${type} from a guest`);
  }

  host.send({ type: "PLAY", currentTime: 12 });
  host.send({ type: "MODE_CHANGE", mode: "review" });
  await until(() => received(guest, "PLAY").length > 0 && received(guest, "MODE_CHANGE").length > 0);
  assert.equal(received(guest, "PLAY")[0].currentTime, 12);
  guest.close();
  host.close();
});

test("a marker can be edited only by its author or the host", async () => {
  const room = "roles-markers";
  const host = await joinRoom(room, "host", "Teacher", false);
  const anna = await joinRoom(room, "student", "Anna", true);
  const ben = await joinRoom(room, "student", "Ben", true);

  anna.send({ type: "ADD_MARKER", marker: { id: "m1", time: 4, note: "original", authorName: "Forged" } });
  await until(() => received(host, "ADD_MARKER").length > 0);
  const stamped = received(host, "ADD_MARKER")[0].marker;
  assert.equal(stamped.authorName, "Anna", "the server stamps the author, a forged name is overwritten");
  assert.ok(stamped.authorId, "the marker carries its author's id");

  ben.send({ type: "UPDATE_MARKER", id: "m1", note: "hijacked" });
  await settle();
  assert.equal(received(host, "UPDATE_MARKER").length, 0, "another guest cannot edit it");
  assert.equal(received(anna, "UPDATE_MARKER").length, 0);

  anna.send({ type: "UPDATE_MARKER", id: "m1", note: "mine" });
  await until(() => received(host, "UPDATE_MARKER").length === 1);
  assert.equal(received(host, "UPDATE_MARKER")[0].note, "mine", "the author can edit it");

  host.send({ type: "UPDATE_MARKER", id: "m1", note: "host fix" });
  await until(() => received(anna, "UPDATE_MARKER").length === 1);
  assert.equal(received(anna, "UPDATE_MARKER")[0].note, "host fix", "the host can edit any marker");
  anna.close();
  ben.close();
  host.close();
});

test("drawing is relayed only in Review", async () => {
  const room = "roles-draw";
  const host = await joinRoom(room, "host", "Teacher", false);
  const anna = await joinRoom(room, "student", "Anna", true);
  const stroke = { points: [[0, 0], [1, 1]], color: "#e5a93c" };

  anna.send({ type: "DRAW_STROKE", stroke });
  await settle();
  assert.equal(received(host, "DRAW_STROKE").length, 0, "no drawing during a screening");

  host.send({ type: "MODE_CHANGE", mode: "review" });
  await until(() => received(anna, "MODE_CHANGE").length > 0);
  anna.send({ type: "DRAW_STROKE", stroke });
  await until(() => received(host, "DRAW_STROKE").length === 1);
  assert.ok(received(host, "DRAW_STROKE")[0].authorId, "strokes carry their author so they can be coloured and erased per person");
  anna.close();
  host.close();
});

test("the host's workspace is relayed to guests, kept for late joiners, and only the host can send it", async () => {
  const room = "roles-workspace";
  const host = await joinRoom(room, "host", "Teacher", false);
  const anna = await joinRoom(room, "student", "Anna", true);

  anna.send({ type: "WORKSPACE_STATE", state: { mode: "studio", deckTab: "cast" } });
  await settle();
  assert.equal(received(host, "WORKSPACE_STATE").length, 0, "a guest cannot set the workspace");

  host.send({ type: "WORKSPACE_STATE", state: { mode: "studio", deckTab: "cuts", selectedShot: "s12", time: 42.5, playing: true } });
  await until(() => received(anna, "WORKSPACE_STATE").length === 1);
  assert.deepEqual(received(anna, "WORKSPACE_STATE")[0].state.deckTab, "cuts");

  host.send({ type: "WORKSPACE_STATE", state: { mode: "nonsense" } });
  host.send({ type: "WORKSPACE_STATE", state: { mode: "explore", blob: "x".repeat(20_000) } });
  await settle();
  assert.equal(received(anna, "WORKSPACE_STATE").length, 1, "unknown modes and oversized states are dropped");

  const late = await joinRoom(room, "student", "Ben", true);
  const init = late.messages.find((m) => m.type === "INIT_STATE");
  assert.equal(init.state.workspace.mode, "studio", "a late joiner starts from the host's workspace");
  assert.ok(init.state.currentTime >= 42.5, "and from the host's playhead, which keeps moving while playing");
  assert.equal(init.state.isPlaying, true);
  anna.close();
  late.close();
  host.close();
});

test("the host's playhead heartbeat reaches guests and a guest's cannot reach anyone", async () => {
  const room = "roles-pulse";
  const host = await joinRoom(room, "host", "Teacher", false);
  const anna = await joinRoom(room, "student", "Anna", true);
  anna.send({ type: "TIME_PULSE", currentTime: 99, isPlaying: true });
  await settle();
  assert.equal(received(host, "TIME_PULSE").length, 0);
  host.send({ type: "TIME_PULSE", currentTime: 10, isPlaying: true });
  await until(() => received(anna, "TIME_PULSE").length === 1);
  assert.equal(received(anna, "TIME_PULSE")[0].currentTime, 10);
  anna.close();
  host.close();
});

test("a guest can erase their own pencil strokes, and the room is told whose", async () => {
  const room = "roles-erase";
  const host = await joinRoom(room, "host", "Teacher", false);
  const anna = await joinRoom(room, "student", "Anna", true);
  const annaId = host.messages.find((m) => m.type === "PEER_JOINED")?.user.id ?? anna.messages.find((m) => m.type === "INIT_STATE").yourInfo.id;
  anna.send({ type: "ERASE_DRAW" });
  await until(() => received(host, "ERASE_DRAW").length === 1);
  assert.equal(received(host, "ERASE_DRAW")[0].authorId, annaId, "the erase names the guest who sent it, not a client-supplied id");
  anna.close();
  host.close();
});

// --- Analysis data for guests' read-only Studio -----------------------------------------------

test("only the host machine writes the room's analysis data; anyone in the room reads it", async () => {
  const remote = { Host: `192.168.0.9:${PORT}`, Cookie: `duet_token=${token}` };
  const body = JSON.stringify({ shots: [{ id: "s1" }] });
  const json = { "Content-Type": "application/json" };

  assert.equal((await request({ path: "/api/room-data/project" })).status, 404, "nothing yet");
  assert.equal((await request({ path: "/api/room-data/project", method: "POST", headers: { ...remote, ...json }, body })).status, 403, "a guest cannot write it");
  assert.equal((await request({ path: "/api/room-data/project", method: "POST", headers: { Origin: "https://evil.example", ...json }, body })).status, 403, "nor can another site");
  assert.equal((await request({ path: "/api/room-data/nonsense", method: "POST", headers: json, body })).status, 404, "unknown parts are refused");
  assert.equal((await request({ path: "/api/room-data/project", method: "POST", headers: json, body: "{not json" })).status, 400);

  const written = await request({ path: "/api/room-data/project", method: "POST", headers: { Origin: "http://127.0.0.1:5173", ...json }, body });
  assert.equal(written.status, 200);
  assert.equal(written.headers["access-control-allow-origin"], "http://127.0.0.1:5173", "the app's own origin may post");

  const read = await request({ path: "/api/room-data/project", headers: remote });
  assert.equal(read.status, 200);
  assert.equal(read.body, body);
  assert.equal((await request({ path: "/api/room-data/project", headers: { Host: `192.168.0.9:${PORT}` } })).status, 401, "reading still needs the join secret");

  const preflight = await request({ path: "/api/room-data/project", method: "OPTIONS", headers: { Origin: "http://127.0.0.1:5173" } });
  assert.equal(preflight.status, 204);
  assert.equal((await request({ path: "/api/room-data/project", method: "OPTIONS", headers: { Origin: "https://evil.example" } })).headers["access-control-allow-origin"], undefined);
});

test("guests in the room are told when the analysis data changes", async () => {
  const guest = await joinRoom("roles-data", "student", "Anna", true);
  const res = await request({ path: "/api/room-data/thumbnails", method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(res.status, 200);
  await until(() => received(guest, "ROOM_DATA_UPDATED").length === 1);
  assert.equal(received(guest, "ROOM_DATA_UPDATED")[0].part, "thumbnails");
  guest.close();
});

test("the embedded hub can upload the film from the app's origin, and no other site can", async () => {
  const app = { Origin: "http://127.0.0.1:5173" };
  const preflight = await request({ path: "/api/upload", method: "OPTIONS", headers: app });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], "http://127.0.0.1:5173");
  assert.match(String(preflight.headers["access-control-allow-headers"]), /x-file-name/);

  const sent = await request({ path: "/api/upload", method: "POST", headers: { ...app, "x-file-name": "hub.mp4" }, body: "data" });
  assert.equal(sent.status, 200);
  assert.equal(sent.headers["access-control-allow-origin"], "http://127.0.0.1:5173", "the page can read the answer");

  const evil = await request({ path: "/api/upload", method: "OPTIONS", headers: { Origin: "https://evil.example" } });
  assert.equal(evil.headers["access-control-allow-origin"], undefined);
  assert.equal((await request({ path: "/api/upload", method: "POST", headers: { Origin: "https://evil.example", "x-file-name": "a.mp4" }, body: "x" })).status, 403);
});

test("only the host machine can list the films already uploaded", async () => {
  const list = await request({ path: "/api/uploads", headers: { Origin: "http://127.0.0.1:5173" } });
  assert.equal(list.status, 200);
  assert.equal(list.headers["access-control-allow-origin"], "http://127.0.0.1:5173");
  const files = JSON.parse(list.body) as { name: string; size: number }[];
  assert.ok(files.some((f) => f.name === "clip.mp4" && f.size === 10), "name and size, so the host can recognise a film");
  assert.equal((await request({ path: "/api/uploads", headers: { Host: `192.168.0.9:${PORT}`, Cookie: `duet_token=${token}` } })).status, 403, "a guest cannot list them");
});
