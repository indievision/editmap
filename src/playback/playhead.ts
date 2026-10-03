import { useRef, useSyncExternalStore } from "react";

/**
 * The playback clock, held outside React state.
 *
 * Playback writes it every animation frame. If it lived in the root component's
 * state, every frame would re-render the whole workspace. Here only components
 * that subscribe re-render, and `usePlayheadSelector` lets them re-render only
 * when something derived from the time actually changes (for example which shot
 * is active), not on every tick.
 */
let current = 0;
const listeners = new Set<() => void>();

export const playhead = {
  get: () => current,
  set(next: number) {
    if (next === current) return;
    current = next;
    listeners.forEach((listener) => listener());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** React-style setter: accepts a value or an updater of the previous time. */
export function setPlayhead(next: number | ((previous: number) => number)) {
  playhead.set(typeof next === "function" ? next(current) : next);
}

const noopSubscribe = () => () => {};

/**
 * Re-renders on every change of the clock. Use for readouts that show the exact
 * time. Pass `enabled = false` while the component is hidden: it then stops
 * subscribing (no re-renders) and catches up to the live time when re-enabled.
 */
export function usePlayhead(enabled = true): number {
  const last = useRef(current);
  return useSyncExternalStore(enabled ? playhead.subscribe : noopSubscribe, () => (enabled ? (last.current = current) : last.current));
}

/**
 * Re-renders only when `select(time)` returns a different value (compared with
 * Object.is). `select` must be cheap and derive its result from `time` only; it
 * may read other current data through refs.
 */
export function usePlayheadSelector<T>(select: (time: number) => T): T {
  const selectRef = useRef(select);
  selectRef.current = select;
  return useSyncExternalStore(playhead.subscribe, () => selectRef.current(current));
}
