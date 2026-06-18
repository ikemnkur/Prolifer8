import { useCallback, useEffect, useState } from 'react';

interface WatchedPost {
  postId: string;
  timestamp: number; // unix ms
}

const STORAGE_KEY = 'prolifer8_watched_posts';
const WATCH_WINDOW_MS = 60 * 60 * 1000; // 60 minutes

/**
 * Hook to manage locally-tracked post views with a 60-minute window.
 * Prevents double-counting and duplicate boost charges.
 */
export function useWatchedPosts() {
  const [watched, setWatched] = useState<WatchedPost[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as WatchedPost[];
        // Filter out entries older than 60 mins
        const now = Date.now();
        const fresh = parsed.filter((w) => now - w.timestamp < WATCH_WINDOW_MS);
        setWatched(fresh);
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  // Check if a post was already watched in the current window
  const isAlreadyWatched = useCallback(
    (postId: string): boolean => {
      const now = Date.now();
      return watched.some(
        (w) => w.postId === postId && now - w.timestamp < WATCH_WINDOW_MS
      );
    },
    [watched]
  );

  // Mark a post as watched and persist
  const markAsWatched = useCallback((postId: string) => {
    setWatched((prev) => {
      // Add if not already present in the window
      if (!prev.some((w) => w.postId === postId)) {
        const updated = [...prev, { postId, timestamp: Date.now() }];
        // Cleanup old entries before saving
        const now = Date.now();
        const cleaned = updated.filter(
          (w) => now - w.timestamp < WATCH_WINDOW_MS
        );
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
        return cleaned;
      }
      return prev;
    });
  }, []);

  // Clear all watched posts (for debugging or logout)
  const clearWatched = useCallback(() => {
    setWatched([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { watched, isAlreadyWatched, markAsWatched, clearWatched };
}
