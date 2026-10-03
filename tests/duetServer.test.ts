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
  assert.match(String(good.headers["set-cookie"]), /duet_token=[0-9a-f]+; HttpOnly; SameSite=Strict/);
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
