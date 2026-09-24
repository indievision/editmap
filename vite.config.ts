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

function autoPythonBackendPlugin(): Plugin {
  let backendProcess: ChildProcess | null = null;

  return {
    name: "auto-python-backend",
    configureServer(server) {
      const serverDir = path.resolve(__dirname, "server");
      const venvPython = path.join(serverDir, ".venv", "bin", "python");

      void (async () => {
        const isAlive = await checkBackendAlive(8000);
        if (isAlive) {
          console.log("\x1b[32m[EditMap]\x1b[0m Python CV backend is already running on http://127.0.0.1:8000");
          return;
        }

        if (!fs.existsSync(venvPython)) {
          console.warn("\x1b[33m[EditMap]\x1b[0m Python virtual environment not found at server/.venv. Backend auto-start skipped.");
          return;
        }

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

        backendProcess.on("exit", (code) => {
          if (code !== 0 && code !== null) {
            console.warn(`\x1b[33m[EditMap]\x1b[0m Python backend exited with code ${code}`);
          }
        });
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
  plugins: [autoPythonBackendPlugin()],
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
