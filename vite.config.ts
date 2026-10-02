import { defineConfig, type Plugin } from "vite";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function checkBackendAlive(port = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: "127.0.0.1",
        port,
        path: "/health",
        timeout: 800,
      },
      () => resolve(true),
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function checkDuetAlive(port = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: "127.0.0.1",
        port,
        path: "/",
        timeout: 800,
      },
      () => resolve(true),
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function autoBackendPlugin(): Plugin {
  let backendProcess: ChildProcess | null = null;
  let duetProcess: ChildProcess | null = null;

  return {
    name: "auto-backend",
    configureServer(server) {
      const serverDir = path.resolve(__dirname, "server");
      const venvPython = path.join(serverDir, ".venv", "bin", "python");

      void (async () => {
        // 1. Python CV backend
        const isCvAlive = await checkBackendAlive(8000);
        if (isCvAlive) {
          console.log("\x1b[32m[EditMap]\x1b[0m Python CV backend is already running on http://127.0.0.1:8000");
        } else if (fs.existsSync(venvPython)) {
          console.log("\x1b[36m[EditMap]\x1b[0m Starting local Python CV backend (Uvicorn / FastAPI)...");
          backendProcess = spawn(
            venvPython,
            ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"],
            {
              cwd: serverDir,
              stdio: "inherit",
            },
          );

          backendProcess.on("error", (err) => {
            console.error("\x1b[31m[EditMap]\x1b[0m Failed to start Python backend:", err.message);
          });
        }

        // 2. DUET Screening & Wi-Fi server (Port 3000)
        const isDuetAlive = await checkDuetAlive(3000);
        if (isDuetAlive) {
          console.log("\x1b[32m[EditMap]\x1b[0m DUET Screening server is already running on http://127.0.0.1:3000");
        } else {
          console.log("\x1b[36m[EditMap]\x1b[0m Starting DUET Screening & Wi-Fi server on port 3000...");
          duetProcess = spawn(process.execPath, [path.resolve(__dirname, "duet_server.cjs")], {
            cwd: __dirname,
            stdio: "inherit",
          });

          duetProcess.on("error", (err) => {
            console.error("\x1b[31m[EditMap]\x1b[0m Failed to start DUET server:", err.message);
          });
        }
      })();

      const cleanup = () => {
        if (backendProcess && !backendProcess.killed) {
          console.log("\x1b[36m[EditMap]\x1b[0m Stopping local Python backend...");
          try {
            backendProcess.kill("SIGTERM");
          } catch {
            // Process may already be stopped
          }
          backendProcess = null;
        }

        if (duetProcess && !duetProcess.killed) {
          console.log("\x1b[36m[EditMap]\x1b[0m Stopping DUET server...");
          try {
            duetProcess.kill("SIGTERM");
          } catch {
            // Process may already be stopped
          }
          duetProcess = null;
        }
      };

      server.httpServer?.on("close", cleanup);
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);
      process.on("exit", cleanup);
    },
  };
}

// Local-only bridge: forwards /api and /local-model to the local CV microservice
export default defineConfig({
  plugins: [autoBackendPlugin()],
  server: {
    open: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/local-model": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/local-model/, ""),
      },
    },
  },
});
