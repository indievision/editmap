import { defineConfig } from "vite";

// The read-only Studio and Explore that guests in the screening room follow. It is
// built into public/guest/ so the room server can serve it without serving anything
// else (the server only ever serves public/ and uploads/).
export default defineConfig({
  base: "/guest/",
  publicDir: false,
  build: {
    outDir: "public/guest",
    emptyOutDir: true,
    rollupOptions: { input: "guest.html" },
  },
});
