import { Link, useNavigate } from 'react-router-dom';
import { Eye, Grid3X3, Heart, MessageCircle, MoreVertical, PlusCircle, UserPlus, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useDashboard } from '../hooks/useData';
import { api } from '../lib/api';
import type { Drop } from '../types';

// ── Per-post action menu ──────────────────────────────────────────────────────
function PostMenu({ post, onMutate }: { post: Drop; onMutate: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    try { await action(); onMutate(); } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Action failed');
    } finally { setBusy(false); setOpen(false); }
  }, [onMutate]);

  const items = [
    {
      label: '⚡ Boost',
      onClick: () => navigate(`/boost/${post.id}`),
    },
    {
      label: '✏️ Edit',
      onClick: () => navigate(`/post/${post.id}/edit`),
    },
    {
      label: '📋 Duplicate',
      onClick: () => run(() => api.post(`/api/posts/${post.id}/duplicate`)),
    },
    {
      label: post.status === 'hidden' ? '👁️ Unhide' : '🙈 Hide',
      onClick: () => run(() => api.patch(`/api/posts/${post.id}/visibility`)),
    },
    {
      label: '🗑️ Delete',
      danger: true,
      onClick: () => {
        if (!confirm(`Delete "${post.title}"? This cannot be undone.`)) return;
        run(() => api.delete(`/api/posts/${post.id}`));
      },
    },
  ];

  return (
    <div ref={ref} className="absolute top-1.5 right-1.5 z-20">
      <button
        type="button"
        disabled={busy}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80 transition disabled:opacity-50"
        aria-label="Post actions"
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 top-8 w-40 rounded-xl border border-surface-3 bg-surface shadow-xl z-30 overflow-hidden">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); item.onClick(); }}
              className={`w-full px-3 py-2 text-left text-xs transition hover:bg-surface-2 ${item.danger ? 'text-red-400 hover:text-red-300' : 'text-text'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { data, loading, error, refetch } = useDashboard();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return <p className="text-danger text-center py-20">{error || 'Failed to load dashboard'}</p>;
  }

  const { myPosts, profileStats } = data;

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 overflow-hidden rounded-full bg-surface-2 ring-2 ring-surface-3">
            <img
              src={user?.avatar || `https://i.pravatar.cc/150?u=${user?.id || 'user'}`}
              alt={user?.username || 'Profile'}
              className="h-full w-full object-cover"
            />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-text">@{user?.username}</h1>
            <p className="text-sm text-text-muted">Creator dashboard</p>
          </div>
        </div>
        <Link
          to="/create"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand text-white text-sm font-medium hover:bg-brand-dark transition no-underline shadow-lg shadow-brand/20"
        >
          <PlusCircle className="w-4 h-4" />
          New Post
        </Link>
      </div>

      <div className="grid grid-cols-4 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <div className="bg-surface-2 rounded-xl p-4 text-center">
          <Grid3X3 className="w-5 h-5 mx-auto mb-1 text-brand" />
          <p className="text-xl font-bold text-text">{profileStats.numPosts}</p>
          <p className="text-xs text-text-muted">Posts</p>
        </div>
        <div className="bg-surface-2 rounded-xl p-4 text-center">
          <Users className="w-5 h-5 mx-auto mb-1 text-brand" />
          <p className="text-xl font-bold text-text">{profileStats.followers}</p>
          <p className="text-xs text-text-muted">Followers</p>
        </div>
        <div className="bg-surface-2 rounded-xl p-4 text-center">
          <UserPlus className="w-5 h-5 mx-auto mb-1 text-brand" />
          <p className="text-xl font-bold text-text">{profileStats.following}</p>
          <p className="text-xs text-text-muted">Following</p>
        </div>
        <div className="bg-surface-2 rounded-xl p-4 text-center">
          <Eye className="w-5 h-5 mx-auto mb-1 text-brand" />
          <p className="text-xl font-bold text-text">{profileStats.views30d}</p>
          <p className="text-xs text-text-muted">Views (30d)</p>
        </div>
        <div className="bg-surface-2 rounded-xl p-4 text-center">
          <MessageCircle className="w-5 h-5 mx-auto mb-1 text-brand" />
          <p className="text-xl font-bold text-text">{profileStats.comments30d}</p>
          <p className="text-xs text-text-muted">Comments (30d)</p>
        </div>
        <div className="bg-surface-2 rounded-xl p-4 text-center">
          <Heart className="w-5 h-5 mx-auto mb-1 text-green-500" />
          <p className="text-xl font-bold text-text">{profileStats.likes30d}</p>
          <p className="text-xs text-text-muted">Likes (30d)</p>
        </div>
        <div className="bg-surface-2 rounded-xl p-4 text-center">
          <Heart className="w-5 h-5 mx-auto mb-1 text-red-400" />
          <p className="text-xl font-bold text-text">{profileStats.dislikes30d}</p>
          <p className="text-xs text-text-muted">Dislikes (30d)</p>
        </div>
        <div className="bg-surface-2 rounded-xl p-4 text-center">
          <p className="text-xs uppercase tracking-wide text-text-muted">Avg Quality</p>
          <p className="mt-1 text-xl font-bold text-text">{profileStats.avgRating30d}</p>
          <p className="text-xs text-text-muted">Score (30d)</p>
        </div>
      </div>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-text">My Posts</h2>
        </div>
        {myPosts.length === 0 ? (
          <div className="bg-surface-2 rounded-xl p-8 text-center">
            <Grid3X3 className="w-8 h-8 text-text-muted mx-auto mb-2" />
            <p className="text-text-muted text-sm mb-3">No posts yet. Create your first reel-style post.</p>
            <Link to="/create" className="text-brand text-sm hover:underline no-underline">
              Create post →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:gap-3 md:grid-cols-4 lg:grid-cols-5">
            {myPosts.map((post) => (
              <div key={post.id} className="relative group">
                <Link
                  to={`/post/${post.id}`}
                  className="relative block aspect-square overflow-hidden rounded-xl bg-surface-2 no-underline"
                  aria-label={`Open ${post.title}`}
                >
                  <img
                    src={post.thumbnailUrl || `https://picsum.photos/seed/${post.id}/600/600`}
                    alt={post.title}
                    className="h-full w-full object-cover transition group-hover:scale-[1.03]"
                  />
                  {post.status === 'hidden' && (
                    <span className="absolute left-1.5 top-1.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white/80">
                      Hidden
                    </span>
                  )}
                  {post.status === 'boosted' && (
                    <span className="absolute left-1.5 top-1.5 rounded-full bg-brand/80 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                      Boosted
                    </span>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-black/55 px-2 py-1 text-[10px] text-white opacity-0 transition group-hover:opacity-100">
                    <p className="truncate">{post.title}</p>
                  </div>
                </Link>
                <PostMenu post={post} onMutate={refetch} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Quick credit summary */}
      {/* <div className="bg-surface-2/50 border border-surface-3 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div>
          <p className="text-sm text-text">
            Balance: <span className="text-brand font-bold">{(user?.creditBalance ?? 0).toLocaleString()}</span> credits
          </p>
          <p className="text-xs text-text-muted">Posts</p>
        </div>
        <Link
          to="/buy-credits"
          className="px-4 py-2 rounded-lg bg-brand/10 text-brand text-sm font-medium hover:bg-brand/20 transition no-underline"
        >
          Buy Credits
        </Link>
      </div> */}
    </div>
  );
}
