import { useEffect, useRef, useState } from "react";
import type { ColorProfile, Project } from "../models/project";

/** The screening room server, on this machine. It accepts these writes only from the host machine and the app's own origin. */
const ROOM_SERVER = "http://127.0.0.1:3000";
const PUSH_DELAY_MS = 1200;
const CHECK_EVERY_MS = 20_000;

async function push(part: "project" | "thumbnails" | "colorProfiles", data: unknown) {
  try {
    await fetch(`${ROOM_SERVER}/api/room-data/${part}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch {
    // The room server not running is normal; guests just have nothing to read.
  }
}

/**
 * Keeps the room server's copy of the analysis current, so guests can open a
 * read-only Studio and Explore on the same data. It only sends while Wi-Fi
 * screening is on (otherwise there are no guests), and sends the thumbnails and
 * colour profiles separately so a small edit does not resend them.
 */
export function useRoomDataRelay(project: Project, thumbnails: Record<string, string>, colorProfiles: Record<string, ColorProfile>) {
  const [shared, setShared] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const check = async () => {
      try {
        const res = await fetch(`${ROOM_SERVER}/api/join-info`);
        const info = (await res.json()) as { lan?: boolean };
        if (alive.current) setShared(Boolean(info.lan));
      } catch {
        if (alive.current) setShared(false);
      }
    };
    void check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!shared) return;
    const timer = window.setTimeout(() => void push("project", project), PUSH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [shared, project]);

  const thumbnailKey = `${project.id}:${Object.keys(thumbnails).length}`;
  useEffect(() => {
    if (!shared) return;
    const timer = window.setTimeout(() => void push("thumbnails", thumbnails), PUSH_DELAY_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resent when the set of frames changes, not on every identity change
  }, [shared, thumbnailKey]);

  const profileKey = `${project.id}:${Object.keys(colorProfiles).length}`;
  useEffect(() => {
    if (!shared) return;
    const timer = window.setTimeout(() => void push("colorProfiles", colorProfiles), PUSH_DELAY_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as above
  }, [shared, profileKey]);
}
