import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useWatchedPosts } from '../hooks/useWatchedPosts';
import { mapDrop, type ServerPost } from '../hooks/useData';
import { loadTagProfile, scoreByTagAffinity } from '../lib/tagProfile';
import type { Drop, Review } from '../types';
import ReviewForm from '../components/ReviewForm';
import ShareModal from '../components/ShareModal';
import { ChevronDown, ChevronUp, Eye, MessageCircle, PlusCircle, Send, Share2, Star, ThumbsDown, ThumbsUp, X } from 'lucide-react';

type FilePayload = {
  fileUrl: string;
  mimeType: string | null;
  originalFileName: string | null;
};

type ServerReview = {
  id: string;
  userId: string;
  username: string;
  avatar: string | null;
  comment: string;
  rating: number;
  effortRating?: number | null;
  liked: boolean | null;
  created_at: string;
};

type CommentNode = {
  id: string;
  userId: string;
  username: string;
  avatar: string | null;
  comment: string;
  parentCommentId: string | null;
  createdAt: string;
  likeCount: number;
  dislikeCount: number;
  myReaction?: 'like' | 'dislike' | null;
  replies: CommentNode[];
};

type MediaKind = 'video' | 'audio' | 'image' | 'link' | 'file';
type MoreItemKind = 'related' | 'recommended' | 'boosted' | 'ad' | 'random';
type MoreRailItem =
  | { kind: 'ad'; id: string }
  | { kind: Exclude<MoreItemKind, 'ad'>; id: string; post: Drop };

function getUserProfilePath(username?: string | null, userId?: string | null): string {
  const identifier = String(username || userId || '').trim();
  return `/user/${encodeURIComponent(identifier)}`;
}

function getAvatarFallback(seed?: string | null): string {
  return `https://i.pravatar.cc/80?u=${encodeURIComponent(String(seed || 'user'))}`;
}

function formatTimeAgo(timestamp: string): string {
  const then = new Date(timestamp).getTime();
  if (!Number.isFinite(then)) return 'just now';
  const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (sec < 60) return `${sec || 1}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(mo / 12);
  return `${yr}y ago`;
}

function toYouTubeEmbed(url: string): string | null {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/|youtube\.com\/shorts\/)([-\w]+)/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}

function inferMediaKind({
  mimeType,
  fileType,
  fileUrl,
  filePath,
  originalFileName,
}: {
  mimeType?: string | null;
  fileType: string;
  fileUrl?: string | null;
  filePath?: string | null;
  originalFileName?: string | null;
}): MediaKind {
  const mime = (mimeType || '').toLowerCase();
  const candidate = (originalFileName || filePath || fileUrl || '').toLowerCase();
  const isExternal = /^https?:\/\//i.test(filePath || '');

  if (mime.startsWith('video/') || /\.(mp4|webm|mov|avi|mkv)$/i.test(candidate)) return 'video';
  if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(candidate)) return 'audio';
  if (mime.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(candidate)) return 'image';

  if (isExternal && (fileType === 'other' || mime.includes('text') || mime.includes('html') || !mime)) {
    return 'link';
  }

  return 'file';
}

function ImageZoomPanViewer({ src, alt }: { src: string; alt: string }) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  const handleWheel: React.WheelEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    const next = Math.max(1, Math.min(5, scale + (e.deltaY < 0 ? 0.2 : -0.2)));
    setScale(next);
    if (next === 1) setOffset({ x: 0, y: 0 });
  };

  const handleMouseDown: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (scale <= 1) return;
    setDragging(true);
    dragStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
  };

  const handleMouseMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (!dragging) return;
    setOffset({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    });
  };

  return (
    <div className="relative">
      <div
        className={`max-h-[560px] w-full overflow-hidden bg-black/80 ${scale > 1 ? 'cursor-grab' : 'cursor-zoom-in'}`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={() => setDragging(false)}
        onMouseLeave={() => setDragging(false)}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="mx-auto max-h-[560px] w-auto select-none"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: 'center center',
            transition: dragging ? 'none' : 'transform 120ms ease-out',
          }}
        />
      </div>
      <button
        type="button"
        onClick={() => {
          setScale(1);
          setOffset({ x: 0, y: 0 });
        }}
        className="absolute right-3 top-3 rounded-lg bg-black/70 px-2 py-1 text-xs text-white"
      >
        Reset view
      </button>
    </div>
  );
}

function AudioWaveformPlayer({
  src,
  thumbnailUrl,
  title,
}: {
  src: string;
  thumbnailUrl?: string;
  title: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const channelDataRef = useRef<Float32Array | null>(null);
  const decodedDurationRef = useRef(0);
  const [waveformReady, setWaveformReady] = useState(false);

  const drawWindow = () => {
    const canvas = canvasRef.current;
    const audioEl = audioRef.current;
    const data = channelDataRef.current;
    if (!canvas || !audioEl || !data) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#1f2633';
    ctx.fillRect(0, 0, width, height);

    const duration = audioEl.duration || decodedDurationRef.current;
    if (!duration || !Number.isFinite(duration)) return;

    const VIEW_SPAN = 15;
    const HALF_SPAN = VIEW_SPAN / 2;
    const cursor = Number.isFinite(audioEl.currentTime) ? audioEl.currentTime : 0;
    const viewStart = cursor - HALF_SPAN;
    const viewEnd = cursor + HALF_SPAN;
    const viewDuration = viewEnd - viewStart;
    const centerY = height / 2;

    // Midline
    ctx.beginPath();
    ctx.strokeStyle = '#3b465c';
    ctx.lineWidth = 1;
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    const totalSamples = data.length;
    ctx.fillStyle = '#5fb5ff';

    for (let x = 0; x < width; x += 1) {
      const t = viewStart + (x / width) * viewDuration;

      // Outside audio bounds: keep buffer area visually flat.
      if (t < 0 || t > duration) {
        ctx.fillRect(x, centerY, 1, 1);
        continue;
      }

      const sampleStart = Math.floor((t / duration) * totalSamples);
      const nextT = t + viewDuration / width;
      const sampleEnd = Math.floor((nextT / duration) * totalSamples);
      const step = Math.max(1, sampleEnd - sampleStart);

      let min = 1;
      let max = -1;
      for (let i = 0; i < step; i += 1) {
        const sampleIndex = sampleStart + i;
        if (sampleIndex >= 0 && sampleIndex < totalSamples) {
          const sample = data[sampleIndex];
          if (sample < min) min = sample;
          if (sample > max) max = sample;
        }
      }

      const y1 = ((1 + min) * 0.5) * height;
      const y2 = ((1 + max) * 0.5) * height;
      ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }

    // Draw tick marks every 5 seconds in the current viewport.
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 1;
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#a0aec0';
    ctx.textAlign = 'center';

    const TICK_INTERVAL = 5;
    const firstTick = Math.ceil(viewStart / TICK_INTERVAL) * TICK_INTERVAL;
    for (let t = firstTick; t <= viewEnd; t += TICK_INTERVAL) {
      if (t < 0 || t > duration) continue;
      const x = ((t - viewStart) / viewDuration) * width;
      if (x < 0 || x > width) continue;

      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 8);
      ctx.stroke();

      ctx.fillText(`${Math.floor(t)}s`, x, 20);
    }

    // Centered seeker line.
    const seekerX = width / 2;
    ctx.beginPath();
    ctx.strokeStyle = '#ff4d4f';
    ctx.lineWidth = 2;
    ctx.moveTo(seekerX, 0);
    ctx.lineTo(seekerX, height);
    ctx.stroke();
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const audioEl = audioRef.current;
    if (!canvas || !audioEl) return;

    const duration = audioEl.duration || decodedDurationRef.current;
    if (!duration || !Number.isFinite(duration)) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = canvas.width;

    const VIEW_SPAN = 15;
    const HALF_SPAN = VIEW_SPAN / 2;
    const cursor = Number.isFinite(audioEl.currentTime) ? audioEl.currentTime : 0;
    const viewStart = cursor - HALF_SPAN;
    const clickedTime = viewStart + (x / width) * VIEW_SPAN;
    const clampedTime = Math.max(0, Math.min(duration, clickedTime));

    audioEl.currentTime = clampedTime;
  };

  useEffect(() => {
    let cancelled = false;

    const draw = async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#1f2633';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      try {
        const res = await fetch(src);
        const buf = await res.arrayBuffer();
        const audioCtx = new AudioContext();
        const decoded = await audioCtx.decodeAudioData(buf.slice(0));
        channelDataRef.current = decoded.getChannelData(0);
        decodedDurationRef.current = decoded.duration;
        await audioCtx.close();
        if (!cancelled) {
          setWaveformReady(true);
          drawWindow();
        }
      } catch {
        if (!cancelled) setWaveformReady(false);
      }
    };

    draw();
    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return;

    const redraw = () => drawWindow();
    audioEl.addEventListener('timeupdate', redraw);
    audioEl.addEventListener('seeked', redraw);
    audioEl.addEventListener('loadedmetadata', redraw);
    audioEl.addEventListener('play', redraw);
    audioEl.addEventListener('pause', redraw);

    return () => {
      audioEl.removeEventListener('timeupdate', redraw);
      audioEl.removeEventListener('seeked', redraw);
      audioEl.removeEventListener('loadedmetadata', redraw);
      audioEl.removeEventListener('play', redraw);
      audioEl.removeEventListener('pause', redraw);
    };
  }, []);

  return (
    <div className="space-y-3 p-4">
      {thumbnailUrl && (
        <img
          src={thumbnailUrl}
          alt={title}
          className="max-h-[320px] w-full rounded-xl object-cover"
        />
      )}
      <canvas
        ref={canvasRef}
        width={1200}
        height={180}
        onClick={handleCanvasClick}
        className="h-24 w-full rounded-lg border border-surface-3 bg-surface cursor-pointer hover:opacity-90 transition-opacity"
      />
      {!waveformReady && <p className="text-xs text-text-muted">Waveform preview unavailable for this audio source.</p>}
      <audio ref={audioRef} controls src={src} className="w-full" />
      {/* <p className="text-xs text-text-muted">Waveform spans the full audio duration with 7.5s buffer space on each side. Click to seek to a time.</p> */}
    </div>
  );
}

function CommentCard({
  node,
  onReply,
  onReact,
}: {
  node: CommentNode;
  onReply: (parentId: string, username: string) => void;
  onReact: (commentId: string, reaction: 'like' | 'dislike') => void;
}) {
  const profilePath = getUserProfilePath(node.username, node.userId);
  const avatarSrc = (node.avatar || '').trim() || getAvatarFallback(node.userId || node.username);

  return (
    <div className="space-y-2 rounded-lg border border-surface-3 bg-surface-2 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link to={profilePath} className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-surface-3">
            <img src={avatarSrc} alt={node.username} className="h-full w-full object-cover" />
          </Link>
          <Link to={profilePath} className="truncate text-sm font-semibold text-text no-underline hover:text-brand">
            {node.username}
          </Link>
          <p className="text-[11px] text-text-muted">{formatTimeAgo(node.createdAt)}</p>
        </div>
        <div className="flex items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() => onReact(node.id, 'like')}
            title="Like comment"
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 transition ${
              node.myReaction === 'like' ? 'bg-success/20 text-success' : 'text-text-muted hover:text-success'
            }`}
          >
            <ThumbsUp className="h-3.5 w-3.5" />
            {node.likeCount > 0 ? node.likeCount : ''}
          </button>
          <button
            type="button"
            onClick={() => onReact(node.id, 'dislike')}
            title="Dislike comment"
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 transition ${
              node.myReaction === 'dislike' ? 'bg-danger/20 text-danger' : 'text-text-muted hover:text-danger'
            }`}
          >
            <ThumbsDown className="h-3.5 w-3.5" />
            {node.dislikeCount > 0 ? node.dislikeCount : ''}
          </button>
          <button
            type="button"
            onClick={() => onReply(node.id, node.username)}
            title="Reply"
            className="rounded-md px-1.5 py-1 text-text-muted transition hover:text-brand"
          >
            <MessageCircle className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <p className="whitespace-pre-wrap text-sm text-text-muted">{node.comment}</p>

      <div className="hidden items-center gap-3 text-xs">
        <button
          type="button"
          onClick={() => onReact(node.id, 'like')}
          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 transition ${
            node.myReaction === 'like' ? 'bg-success/20 text-success' : 'bg-surface text-text-muted hover:text-success'
          }`}
        >
          <ThumbsUp className="h-3.5 w-3.5" />
          {node.likeCount}
        </button>
        <button
          type="button"
          onClick={() => onReact(node.id, 'dislike')}
          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 transition ${
            node.myReaction === 'dislike' ? 'bg-danger/20 text-danger' : 'bg-surface text-text-muted hover:text-danger'
          }`}
        >
          <ThumbsDown className="h-3.5 w-3.5" />
          {node.dislikeCount}
        </button>
        <button
          type="button"
          onClick={() => onReply(node.id, node.username)}
          className="rounded-lg bg-surface px-2 py-1 text-text-muted transition hover:text-brand"
        >
          Reply
        </button>
      </div>

      {node.replies.length > 0 && (
        <div className="space-y-2 border-l border-surface-3 pl-3">
          {node.replies.map((reply) => (
            <CommentCard key={reply.id} node={reply} onReply={onReply} onReact={onReact} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Posts() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { drops } = useApp();
  const { isAuthenticated } = useAuth();
  const { isAlreadyWatched, markAsWatched } = useWatchedPosts();

  const localDrop = drops.find((d) => d.id === id);
  const [fetchedDrop, setFetchedDrop] = useState<Drop | null>(null);
  const [loading, setLoading] = useState(true);

  const [filePayload, setFilePayload] = useState<FilePayload | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewError, setReviewError] = useState('');
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [postReaction, setPostReaction] = useState<'like' | 'dislike' | null>(null);
  const [reactionCounts, setReactionCounts] = useState({ likeCount: 0, dislikeCount: 0 });
  const [viewCount, setViewCount] = useState(0);

  const [comments, setComments] = useState<CommentNode[]>([]);
  const [commentText, setCommentText] = useState('');
  const [replyTarget, setReplyTarget] = useState<{ id: string; username: string } | null>(null);
  const [commentError, setCommentError] = useState('');
  const [commentsExpanded, setCommentsExpanded] = useState(true);
  const [commentModalOpen, setCommentModalOpen] = useState(false);

  const drop = localDrop ?? fetchedDrop;

  useEffect(() => {
    

    if (!drop) return;
    setReactionCounts({
      likeCount: drop.likeCount ?? 0,
      dislikeCount: drop.dislikeCount ?? 0,
    });
    setViewCount(drop.views ?? 0);
  }, [drop?.id]);

  useEffect(() => {
    console.log(`Viewing post ${id}`);
    if (!id) return;
    const viewKey = `prolifer8_viewed_post_${id}`;
    if (sessionStorage.getItem(viewKey)) return;
    const alreadyWatched = isAlreadyWatched(id);

    // alert(`Viewing post ${id}`);

    api.post<{ views: number }>(`/api/posts/${id}/view`)
      .then((res) => {
        setViewCount(res.views ?? 0);
        sessionStorage.setItem(viewKey, '1');

        // If this is a boosted post and not already in the watched window, call boost-view to deduct credits
        if (drop?.status === 'boosted' && !alreadyWatched) {
          api.post(`/api/posts/${id}/boost-view`).catch(() => {
            // Non-blocking boost tracking
          });
        }

        markAsWatched(id);
      })
      .catch(() => {
        // Non-blocking view count update.
      });
  }, [id, drop?.status, isAlreadyWatched, markAsWatched]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const boot = async () => {
      setLoading(true);
      try {
        const tasks: Promise<unknown>[] = [];

        if (!localDrop) {
          tasks.push(
            api.get<ServerPost>(`/api/posts/${id}`).then((raw) => {
              if (!cancelled) setFetchedDrop(mapDrop(raw));
            })
          );
        }

        tasks.push(
          api
            .get<FilePayload>(`/api/posts/${id}/file-url`)
            .then((payload) => {
              if (!cancelled) setFilePayload(payload);
            })
            .catch(() => {
              if (!cancelled) setFilePayload(null);
            })
        );

        tasks.push(
          api
            .get<ServerReview[]>(`/api/posts/${id}/reviews`)
            .then((rows) => {
              if (cancelled) return;
              setReviews(
                rows.map((r) => ({
                  id: r.id,
                  userId: r.userId,
                  username: r.username,
                  avatar: r.avatar || '',
                  comment: r.comment,
                  liked: r.liked,
                  rating: r.rating,
                  effortRating: r.effortRating ?? undefined,
                  timestamp: new Date(r.created_at).getTime(),
                }))
              );
            })
            .catch(() => {
              if (!cancelled) setReviews([]);
            })
        );

        tasks.push(
          api
            .get<{ comments: CommentNode[] }>(`/api/posts/${id}/comments`)
            .then((res) => {
              if (!cancelled) setComments(res.comments || []);
            })
            .catch(() => {
              if (!cancelled) setComments([]);
            })
        );

        if (isAuthenticated) {
          tasks.push(
            api.get<{ reaction: 'like' | 'dislike' | null }>(`/api/posts/${id}/reaction`).then((res) => {
              if (!cancelled) setPostReaction(res.reaction);
            }).catch(() => {
              if (!cancelled) setPostReaction(null);
            })
          );
        } else if (!cancelled) {
          setPostReaction(null);
        }

        await Promise.all(tasks);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    boot();
    return () => {
      cancelled = true;
    };
  }, [id, isAuthenticated, localDrop]);

  const avgRating = useMemo(() => {
    if (!reviews.length) return 0;
    return Math.round(reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length);
  }, [reviews]);

  const avgEffortRating = useMemo(() => {
    const withEffort = reviews.filter((r) => typeof r.effortRating === 'number');
    if (!withEffort.length) return 0;
    return Math.round(withEffort.reduce((sum, r) => sum + Number(r.effortRating || 0), 0) / withEffort.length);
  }, [reviews]);

  const numComments = useMemo(() => {
    const countTree = (nodes: CommentNode[]): number => nodes.reduce((sum, n) => sum + 1 + countTree(n.replies || []), 0);
    return countTree(comments);
  }, [comments]);

  const moreRailItems = useMemo<MoreRailItem[]>(() => {
    if (!drop) return [];

    const MAX_ITEMS = 10;
    const sourceTags = new Set((drop.tags || []).map((t) => String(t).toLowerCase()));
    const profile = loadTagProfile();

    const eligible = drops.filter(
      (p) => p.id !== drop.id && p.isPublic && !['removed', 'draft', 'hidden'].includes(p.status)
    );

    const relatedPool = eligible
      .map((p) => {
        const overlap = (p.tags || []).reduce(
          (sum, tag) => sum + (sourceTags.has(String(tag).toLowerCase()) ? 1 : 0),
          0
        );
        return { post: p, overlap };
      })
      .filter((entry) => entry.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap || b.post.createdAt - a.post.createdAt)
      .map((entry) => entry.post);

    const recommendedPool = [...eligible]
      .map((p) => ({ post: p, score: scoreByTagAffinity(p.tags || [], profile) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || b.post.createdAt - a.post.createdAt)
      .map((entry) => entry.post);

    const boostedPool = [...eligible]
      .filter((p) => p.status === 'boosted')
      .sort((a, b) => b.createdAt - a.createdAt);

    const selected = new Set<string>();
    const items: MoreRailItem[] = [];

    const addPost = (kind: Exclude<MoreItemKind, 'ad'>, post: Drop) => {
      if (selected.has(post.id) || items.length >= MAX_ITEMS) return;
      selected.add(post.id);
      items.push({ kind, id: `${kind}-${post.id}`, post });
    };

    // Start with related content first.
    for (const post of relatedPool.slice(0, 4)) addPost('related', post);

    // Include 2 boosted if possible, otherwise 1, before generic recommendations.
    const boostedTarget = boostedPool.length >= 2 ? 2 : boostedPool.length >= 1 ? 1 : 0;
    for (const post of boostedPool.slice(0, boostedTarget)) addPost('boosted', post);

    // Reserve one ad slot and 1-2 random slots.
    const remainingAfterAd = Math.max(0, MAX_ITEMS - items.length - 1);
    const randomTarget = remainingAfterAd >= 2 ? 2 : remainingAfterAd >= 1 ? 1 : 0;
    const recommendedTarget = Math.max(0, remainingAfterAd - randomTarget);
    for (const post of recommendedPool) {
      if (items.filter((it) => it.kind === 'recommended').length >= recommendedTarget) break;
      addPost('recommended', post);
    }

    // Add one ad placeholder.
    if (items.length < MAX_ITEMS) {
      items.push({ kind: 'ad', id: 'ad-slot-1' });
    }

    // Fill 1-2 random posts.
    const remainingForRandom = Math.max(0, MAX_ITEMS - items.length);
    const randomPool = [...eligible]
      .filter((p) => !selected.has(p.id))
      .sort(() => Math.random() - 0.5);
    for (const post of randomPool.slice(0, Math.min(randomTarget, remainingForRandom))) {
      addPost('random', post);
    }

    // Final fill to reach 10, preferring recommendation affinity then remaining random.
    for (const post of recommendedPool) {
      if (items.length >= MAX_ITEMS) break;
      addPost('recommended', post);
    }
    for (const post of randomPool) {
      if (items.length >= MAX_ITEMS) break;
      addPost('random', post);
    }

    return items.slice(0, MAX_ITEMS);
  }, [drop, drops]);

  const handleSubmitReview = async (data: {
    comment: string;
    liked: boolean | null;
    rating: number;
    effortRating: number;
  }) => {
    if (!id) return;
    try {
      const res = await api.post<{ id: string }>(`/api/posts/${id}/reviews`, data);
      setReviews((prev) => [
        {
          id: res.id,
          userId: 'me',
          username: 'You',
          avatar: '',
          comment: data.comment,
          liked: data.liked,
          rating: data.rating,
          effortRating: data.effortRating,
          timestamp: Date.now(),
        },
        ...prev,
      ]);
      setReviewError('');
      setReviewModalOpen(false);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'Failed to submit review');
    }
  };

  const refreshComments = async () => {
    if (!id) return;
    try {
      const res = await api.get<{ comments: CommentNode[] }>(`/api/posts/${id}/comments`);
      setComments(res.comments || []);
    } catch {
      // Keep existing list if refresh fails.
    }
  };

  const handleSubmitComment = async () => {
    if (!id || !commentText.trim()) return;
    if (!isAuthenticated) {
      navigate(`/login?redirect=/post/${id}`);
      return;
    }

    try {
      await api.post(`/api/posts/${id}/comments`, {
        comment: commentText.trim(),
        parentCommentId: replyTarget?.id || null,
      });
      setCommentText('');
      setReplyTarget(null);
      setCommentError('');
      setCommentModalOpen(false);
      await refreshComments();
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : 'Failed to post comment');
    }
  };

  const openCommentModal = (target?: { id: string; username: string } | null) => {
    if (!id) return;
    if (!isAuthenticated) {
      navigate(`/login?redirect=/post/${id}`);
      return;
    }
    setReplyTarget(target || null);
    setCommentError('');
    setCommentModalOpen(true);
  };

  const handleReactComment = async (commentId: string, reaction: 'like' | 'dislike') => {
    if (!isAuthenticated) {
      navigate(`/login?redirect=/post/${id}`);
      return;
    }
    try {
      await api.post(`/api/comments/${commentId}/reaction`, { reaction });
      await refreshComments();
    } catch {
      // Keep optimistic UI simple by waiting for server round-trip.
    }
  };

  const handleReactPost = async (reaction: 'like' | 'dislike') => {
    if (!id) return;
    if (!isAuthenticated) {
      navigate(`/login?redirect=/post/${id}`);
      return;
    }

    const previousReaction = postReaction;
    const previousCounts = reactionCounts;

    const nextCounts = { ...previousCounts };
    if (previousReaction === reaction) {
      nextCounts[reaction === 'like' ? 'likeCount' : 'dislikeCount'] = Math.max(0, nextCounts[reaction === 'like' ? 'likeCount' : 'dislikeCount'] - 1);
      setPostReaction(null);
    } else {
      if (previousReaction) {
        nextCounts[previousReaction === 'like' ? 'likeCount' : 'dislikeCount'] = Math.max(0, nextCounts[previousReaction === 'like' ? 'likeCount' : 'dislikeCount'] - 1);
      }
      nextCounts[reaction === 'like' ? 'likeCount' : 'dislikeCount'] += 1;
      setPostReaction(reaction);
    }
    setReactionCounts(nextCounts);

    try {
      const res = await api.post<{ reaction: 'like' | 'dislike' | null; likeCount: number; dislikeCount: number }>(
        `/api/posts/${id}/reaction`,
        { reaction }
      );
      setPostReaction(res.reaction);
      setReactionCounts({ likeCount: res.likeCount, dislikeCount: res.dislikeCount });
    } catch {
      setPostReaction(previousReaction);
      setReactionCounts(previousCounts);
    }
  };

  if (loading) {
    return <div className="py-20 text-center text-text-muted">Loading post...</div>;
  }

  if (!drop) {
    return (
      <div className="py-20 text-center">
        <p className="text-text-muted">Post not found.</p>
        <Link to="/explore" className="mt-2 block text-sm text-brand no-underline hover:underline">
          Back to Explore
        </Link>
      </div>
    );
  }

  const trailerEmbed = toYouTubeEmbed(drop.trailerUrl || '');
  const dropUrl = `${window.location.origin}/post/${drop.id}`;
  const mediaKind = inferMediaKind({
    mimeType: filePayload?.mimeType || drop.mimeType,
    fileType: drop.fileType,
    fileUrl: filePayload?.fileUrl,
    filePath: drop.filePath,
    originalFileName: filePayload?.originalFileName || drop.originalFileName,
  });
  const resolvedFileUrl = filePayload?.fileUrl || null;
  const externalLinkUrl = drop.filePath && /^https?:\/\//i.test(drop.filePath) ? drop.filePath : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-text">{drop.title}</h1>
        <div className="flex items-center gap-3 text-sm text-text-muted">
          <Link
            to={getUserProfilePath(drop.creatorName, drop.creatorId)}
            className="inline-flex items-center gap-2 text-text-muted no-underline hover:text-brand"
          >
            <span className="h-8 w-8 overflow-hidden rounded-full bg-surface-3">
              <img
                src={(drop.creatorAvatar || '').trim() || getAvatarFallback(drop.creatorId || drop.creatorName)}
                alt={drop.creatorName}
                className="h-full w-full object-cover"
              />
            </span>
            <span>by {drop.creatorName}</span>
          </Link>
          <span className="inline-flex items-center gap-1">
            <Eye className="h-4 w-4" />
            {viewCount.toLocaleString()} views
          </span>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-surface-3 bg-surface-2">
        {resolvedFileUrl && mediaKind === 'video' ? (
          <video controls src={resolvedFileUrl} className="max-h-[560px] w-full bg-black" />
        ) : resolvedFileUrl && mediaKind === 'audio' ? (
          <AudioWaveformPlayer src={resolvedFileUrl} thumbnailUrl={drop.thumbnailUrl} title={drop.title} />
        ) : resolvedFileUrl && mediaKind === 'image' ? (
          <ImageZoomPanViewer src={resolvedFileUrl} alt={drop.title} />
        ) : mediaKind === 'link' && externalLinkUrl ? (
          <div className="space-y-4 p-6 text-sm text-text-muted">
            <p>This post points to an external link.</p>
            <a href={externalLinkUrl} target="_blank" rel="noreferrer" className="inline-flex rounded-lg bg-brand px-3 py-2 text-white no-underline hover:bg-brand-dark">
              Open Link
            </a>
          </div>
        ) : mediaKind === 'file' ? (
          <div className="space-y-4 p-6">
            {drop.thumbnailUrl ? (
              <img src={drop.thumbnailUrl} alt={drop.title} className="max-h-[360px] w-full rounded-xl object-cover" />
            ) : (
              <div className="rounded-xl border border-surface-3 bg-surface p-6 text-sm text-text-muted">No preview available for this file type.</div>
            )}
            <div className="text-sm text-text-muted">
              {resolvedFileUrl ? (
                <a href={resolvedFileUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                  Download file
                </a>
              ) : externalLinkUrl ? (
                <a href={externalLinkUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                  Open source file
                </a>
              ) : (
                'File URL unavailable.'
              )}
            </div>
          </div>
        ) : trailerEmbed ? (
          <iframe
            src={trailerEmbed}
            title="Trailer"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="h-[560px] w-full"
          />
        ) : (
          <div className="p-12 text-center text-text-muted">No media available.</div>
        )}
      </div>

      <p className="text-sm leading-relaxed text-text-muted">{drop.description}</p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => handleReactPost('like')}
          title="Like post"
          aria-label="Like post"
          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
            postReaction === 'like'
              ? 'border-success bg-success/10 text-success'
              : 'border-surface-3 text-text-muted hover:text-success'
          }`}
        >
          <ThumbsUp className="h-4 w-4" />
          <span className="text-xs">{reactionCounts.likeCount > 0 ? reactionCounts.likeCount : ''}</span>
        </button>
        <button
          type="button"
          onClick={() => handleReactPost('dislike')}
          title="Dislike post"
          aria-label="Dislike post"
          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
            postReaction === 'dislike'
              ? 'border-danger bg-danger/10 text-danger'
              : 'border-surface-3 text-text-muted hover:text-danger'
          }`}
        >
          <ThumbsDown className="h-4 w-4" />
          <span className="text-xs">{reactionCounts.dislikeCount > 0 ? reactionCounts.dislikeCount : ''}</span>
        </button>
        <button
          type="button"
          onClick={() => setShareModalOpen(true)}
          title="Share post"
          aria-label="Share post"
          className="inline-flex items-center gap-2 rounded-lg border border-surface-3 px-3 py-2 text-sm text-text-muted transition hover:text-brand"
        >
          <Share2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setReviewModalOpen(true)}
          title="Write review"
          aria-label="Write review"
          className="inline-flex items-center gap-2 rounded-lg border border-surface-3 px-3 py-2 text-sm text-text-muted transition hover:text-brand"
        >
          <Star className="h-4 w-4" />
        </button>



        <div className="inline-flex items-center gap-3 px-1 text-xs text-text-muted">
          <span>Comments: <span className="font-mono text-text">{numComments}</span></span>
          <span>Quality: <span className="font-mono text-text">{avgRating}%</span></span>
          <span>Effort: <span className="font-mono text-text">{avgEffortRating}%</span></span>
        </div>
      </div>

      <section className="space-y-1 rounded-2xl border border-surface-3 bg-surface p-2">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setCommentsExpanded((prev) => !prev)}
            className="inline-flex items-center gap-2 text-lg font-semibold text-text"
          >
            <MessageCircle className="h-5 w-5 text-brand" />
            Comments ({numComments})
            {commentsExpanded ? <ChevronUp className="h-4 w-4 text-text-muted" /> : <ChevronDown className="h-4 w-4 text-text-muted" />}
          </button>

          <button
            type="button"
            id="add-comment-button"
            onClick={() => openCommentModal(null)}
            title="Add comment"
            aria-label="Add comment"
            className="inline-flex items-center gap-2 rounded-lg  border-surface-3 px-2.5 py-1.5 text-sm text-text-muted transition hover:text-brand"
          >
            <PlusCircle className="h-5 w-5 text-brand" />
          </button>
          {/* <div className="text-xs text-text-muted">
            Quality: <span className="font-mono text-text">{avgRating}%</span> | Effort:{' '}
            <span className="font-mono text-text">{avgEffortRating}%</span>
          </div> */}
        </div>

        {commentsExpanded && <div className="space-y-3">
          {comments.length === 0 ? (
            <p className="py-4 text-sm text-text-muted">No comments yet. Start the conversation.</p>
          ) : (
            comments.map((node) => (
              <CommentCard
                key={node.id}
                node={node}
                onReply={(parentId, username) => openCommentModal({ id: parentId, username })}
                onReact={handleReactComment}
              />
            ))
          )}
        </div>}
      </section>

      <section className="space-y-3 rounded-2xl border border-surface-3 bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-text">More Posts</h2>
          {/* <p className="text-xs text-text-muted">Based on matching tags</p> */}
        </div>

        {moreRailItems.length === 0 ? (
          <p className="text-sm text-text-muted">No recommendations yet.</p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {moreRailItems.map((item) => {
              const chipClass =
                item.kind === 'related'
                  ? 'bg-blue-500/90'
                  : item.kind === 'recommended'
                    ? 'bg-emerald-500/90'
                    : item.kind === 'boosted'
                      ? 'bg-brand/90'
                      : item.kind === 'random'
                        ? 'bg-amber-500/90'
                        : 'bg-slate-500/90';

              if (item.kind === 'ad') {
                return (
                  <div
                    key={item.id}
                    className="relative min-w-[140px] overflow-hidden rounded-lg border border-dashed border-surface-3 bg-surface-2"
                  >
                    <span className={`absolute right-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white ${chipClass}`}>
                      ad
                    </span>
                    <div className="flex h-28 items-center justify-center px-3 text-center text-[11px] text-text-muted">
                      Ad space
                    </div>
                  </div>
                );
              }

              return (
                <Link
                  key={item.id}
                  to={`/post/${item.post.id}`}
                  className="group relative min-w-[140px] overflow-hidden rounded-lg border border-surface-3 bg-surface-2 no-underline"
                >
                  <span className={`absolute right-1.5 top-1.5 z-10 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white ${chipClass}`}>
                    {item.kind}
                  </span>
                  <img
                    src={item.post.thumbnailUrl || `https://picsum.photos/seed/${item.post.id}/300/220`}
                    alt={item.post.title}
                    className="h-20 w-full object-cover transition group-hover:opacity-90"
                  />
                  <p className="truncate px-2 py-1 text-[11px] text-text-muted">{item.post.title}</p>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {shareModalOpen && <ShareModal dropTitle={drop.title} dropUrl={dropUrl} onClose={() => setShareModalOpen(false)} />}

      {reviewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl border border-surface-3 bg-surface p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-text">Formal Review</h3>
              <button type="button" onClick={() => setReviewModalOpen(false)} className="text-text-muted hover:text-text">
                <X className="h-5 w-5" />
              </button>
            </div>
            <ReviewForm onSubmit={handleSubmitReview} />
            {reviewError && <p className="mt-3 text-xs text-danger">{reviewError}</p>}
          </div>
        </div>
      )}

      {commentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-surface-3 bg-surface p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-text">
                {replyTarget ? `Reply to ${replyTarget.username}` : 'Add Comment'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setCommentModalOpen(false);
                  setReplyTarget(null);
                  setCommentError('');
                }}
                className="text-text-muted hover:text-text"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              rows={4}
              placeholder={replyTarget ? `Write a reply to ${replyTarget.username}...` : 'Write a comment...'}
              className="w-full resize-none rounded-xl border border-surface-3 bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-brand focus:outline-none"
            />

            {commentError && <p className="mt-2 text-xs text-danger">{commentError}</p>}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCommentModalOpen(false);
                  setReplyTarget(null);
                  setCommentError('');
                }}
                className="rounded-lg border border-surface-3 px-3 py-2 text-sm text-text-muted transition hover:text-text"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmitComment}
                disabled={!commentText.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
                Post
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
