import { useParams, Link } from 'react-router-dom';
import { SocialIcon } from 'react-social-icons';
import { Heart, Star, Users, Package, Calendar, Globe, Pencil, Eye } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { mapDrop, type ServerPost } from '../hooks/useData';
import type { Drop, CreatorProfile, SocialLinks } from '../types';

interface ServerProfile {
  id: string;
  username: string;
  profilePicture: string | null;
  bio: string | null;
  accountType: string;
  totalDropsCreated: number;
  totalCreditsEarned: number;
  creatorRating: number;
  createdAt: string;
  followerCount: number;
  followingCount: number;
  bannerUrl?: string | null;
  bioVideoUrl?: string | null;
  socialLinks?: string | SocialLinks | null;
}

function normalizeExternalUrl(raw: string): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (/^\/\//.test(value)) return `https:${value}`;
  return `https://${value}`;
}

function normalizeBioVideoEmbedUrl(raw: string): string {
  const value = String(raw || '').trim();
  if (!value) return '';

  try {
    const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(normalized);
    const host = url.hostname.toLowerCase();

    // Already an embed URL.
    if (host.includes('youtube.com') && url.pathname.startsWith('/embed/')) {
      return `https://www.youtube.com${url.pathname.split('/').slice(0, 3).join('/')}`;
    }

    // https://www.youtube.com/watch?v=VIDEO_ID
    if (host.includes('youtube.com') && url.pathname === '/watch') {
      const id = url.searchParams.get('v');
      if (id) return `https://www.youtube.com/embed/${id}`;
    }

    // https://youtu.be/VIDEO_ID
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      if (id) return `https://www.youtube.com/embed/${id}`;
    }

    // https://www.youtube.com/shorts/VIDEO_ID
    if (host.includes('youtube.com') && url.pathname.startsWith('/shorts/')) {
      const id = url.pathname.split('/').filter(Boolean)[1];
      if (id) return `https://www.youtube.com/embed/${id}`;
    }

    return normalized;
  } catch {
    return value;
  }
}

function mapProfile(s: ServerProfile): CreatorProfile {
  const rawSocial = s.socialLinks;
  const socialLinks: SocialLinks | undefined = rawSocial
    ? (typeof rawSocial === 'string' ? JSON.parse(rawSocial) as SocialLinks : rawSocial)
    : undefined;
  return {
    id: s.id,
    username: s.username,
    avatar: s.profilePicture || '',
    bio: s.bio || '',
    rating: s.creatorRating ?? 0,
    followerCount: s.followerCount ?? 0,
    totalDrops: s.totalDropsCreated ?? 0,
    totalCreditsEarned: s.totalCreditsEarned ?? 0,
    joined: new Date(s.createdAt).getTime(),
    bannerUrl: s.bannerUrl || undefined,
    bioVideoUrl: s.bioVideoUrl || undefined,
    socialLinks,
  };
}

export default function UserProfile() {
  const { identifier } = useParams<{ identifier: string }>();
  const { drops: contextDrops } = useApp();
  const { user: authUser } = useAuth();
  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [userDrops, setUserDrops] = useState<Drop[]>([]);
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followLoading, setFollowLoading] = useState(false);

  useEffect(() => {
    if (!identifier) return;
    let cancelled = false;
    setLoading(true);

    api.get<ServerProfile>(`/api/users/${encodeURIComponent(identifier)}`)
      .then(async (profileRes) => {
        if (cancelled) return;
        const mapped = mapProfile(profileRes);
        setProfile(mapped);
        setFollowerCount(mapped.followerCount);

        const [dropsRes, followRes] = await Promise.all([
          api.get<ServerPost[]>(`/api/users/${mapped.id}/posts`),
          authUser && authUser.id !== mapped.id
            ? api.get<{ following: boolean }>(`/api/users/${mapped.id}/am-i-following`).catch(() => null)
            : Promise.resolve(null),
        ]);

        if (cancelled) return;
        setUserDrops(dropsRes.map(mapDrop));
        if (followRes) setFollowing(followRes.following);
      })
      .catch(() => {
        // Fallback: try to build profile from context drops
        const fallbackDrops = contextDrops.filter(
          (d) => d.creatorId === identifier || d.creatorName.toLowerCase() === identifier.toLowerCase()
        );
        if (fallbackDrops.length > 0) {
          setProfile({
            id: fallbackDrops[0].creatorId,
            username: fallbackDrops[0].creatorName,
            avatar: fallbackDrops[0].creatorAvatar,
            bio: '',
            rating: 0,
            followerCount: 0,
            totalDrops: fallbackDrops.length,
            totalCreditsEarned: 0,
            joined: Date.now(),
          });
          setFollowerCount(0);
          setUserDrops(fallbackDrops);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [identifier, contextDrops, authUser]);

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center">
        <p className="text-text-muted text-lg">Loading profile...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center">
        <p className="text-text-muted text-lg">User not found.</p>
        <Link to="/dashboard" className="text-brand hover:underline mt-4 inline-block">
          ← Back to Dashboard
        </Link>
      </div>
    );
  }

  const avatarFallback = `https://picsum.photos/seed/user-avatar-${profile.id}/240/240`;
  const bannerFallback = `https://picsum.photos/seed/user-banner-${profile.id}/1600/400`;
  const avatarSrc = (profile.avatar || '').trim() || avatarFallback;
  const bannerSrc = (profile.bannerUrl || '').trim() || bannerFallback;

  const joinedDate = new Date(profile.joined).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const ratingColor =
    profile.rating >= 80 ? 'text-green-500' : profile.rating >= 50 ? 'text-yellow-500' : 'text-red-500';
  const reportHref = `/help?report=1&targetId=${encodeURIComponent(profile.id)}&targetUsername=${encodeURIComponent(profile.username)}`;
  const bioVideoEmbedUrl = profile.bioVideoUrl ? normalizeBioVideoEmbedUrl(profile.bioVideoUrl) : '';

  return (
    <div className="max-w-4xl mx-auto py-0 px-1 space-y-1">
      {/* Profile Header */}
      <div className="bg-surface rounded-2xl border border-surface-3 overflow-hidden">
        {/* Banner */}
        <div className="h-36 bg-surface-3 overflow-hidden">
          <img
            src={bannerSrc}
            alt={`${profile.username} banner`}
            className="w-full h-full object-cover"
            onError={(e) => {
              const img = e.currentTarget;
              if (img.src !== bannerFallback) img.src = bannerFallback;
            }}
          />
        </div>

        <div className="px-5 pb-2 -mt-28">
          <div className="flex flex-col sm:flex-row items-start gap-5">
            {/* Avatar */}
            <div className="w-24 h-24 rounded-full bg-surface-3 border-4 border-surface flex items-center justify-center text-3xl font-bold text-brand shrink-0 overflow-hidden">
              <img
                src={avatarSrc}
                alt={profile.username}
                className="w-full h-full object-cover"
                onError={(e) => {
                  const img = e.currentTarget;
                  if (img.src !== avatarFallback) img.src = avatarFallback;
                }}
              />
            </div>

            <div className="flex-1 pt-2 sm:pt-6">
              <div className="flex items-center justify-between gap-3">
                <h1 className="text-2xl font-bold text-text truncate">{profile.username}</h1>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={async () => {
                      if (!authUser || authUser.id === profile.id || followLoading) return;
                      setFollowLoading(true);
                      try {
                        const res = await api.post<{ following: boolean; followerCount: number }>(
                          `/api/users/${profile.id}/follow`, {}
                        );
                        setFollowing(res.following);
                        setFollowerCount(res.followerCount);
                      } catch {
                        // silently fail — button reverts visually
                      } finally {
                        setFollowLoading(false);
                      }
                    }}
                    disabled={followLoading || !authUser || authUser.id === profile.id}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                      following
                        ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                        : 'bg-surface-2 text-text-muted border border-surface-3 hover:border-brand/50 hover:text-brand'
                    } disabled:opacity-50`}
                  >
                    <Heart className={`w-4 h-4 ${following ? 'fill-red-400' : ''}`} />
                    {followLoading ? '…' : following ? 'Unfollow' : 'Follow'}
                  </button>

                  {/* Edit own profile */}
                  {authUser?.id === profile.id && (
                    <Link
                      to="/edit-profile"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-2 border border-surface-3 text-text-muted hover:text-brand hover:border-brand/50 transition no-underline"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </Link>
                  )}

                  {authUser?.id !== profile.id && (
                    <Link to={reportHref} className="text-xs text-text-muted hover:text-danger no-underline">
                      Report
                    </Link>
                  )}
                </div>
              </div>
              <p className="text-text-muted mt-2 text-sm leading-relaxed max-w-xl">{profile.bio}</p>
              <p className="text-text-muted text-xs mt-2 flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                Joined {joinedDate}
              </p>

              {/* Social links */}
              {profile.socialLinks && (
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {([
                    { key: 'website',   network: null,        label: 'Website' },
                    { key: 'twitter',   network: 'twitter',   label: 'Twitter' },
                    { key: 'instagram', network: 'instagram', label: 'Instagram' },
                    { key: 'youtube',   network: 'youtube',   label: 'YouTube' },
                    { key: 'github',    network: 'github',    label: 'GitHub' },
                    { key: 'tiktok',    network: 'tiktok',    label: 'TikTok' },
                    { key: 'discord',   network: 'discord',   label: 'Discord' },
                  ] as { key: keyof SocialLinks; network: string | null; label: string }[]).map(({ key, network, label }) => {
                    const href = profile.socialLinks?.[key];
                    if (!href) return null;
                    const externalHref = normalizeExternalUrl(href);
                    return (
                      <a
                        key={key}
                        href={externalHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={label}
                        className="w-8 h-8 rounded-lg bg-surface-2 border border-surface-3 flex items-center justify-center text-text-muted hover:text-brand hover:border-brand/50 transition"
                      >
                        {network
                          ? <SocialIcon network={network} style={{ width: 24, height: 24 }} />
                          : <Globe className="w-4 h-4" />
                        }
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="bg-surface rounded-xl border border-surface-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <span className="inline-flex items-center gap-1.5 text-text-muted">
            <Star className={`w-4 h-4 ${ratingColor}`} />
            Rating <strong className={`${ratingColor}`}>{profile.rating}%</strong>
          </span>
          <span className="inline-flex items-center gap-1.5 text-text-muted">
            <Users className="w-4 h-4 text-brand" />
            Followers <strong className="text-text">{followerCount.toLocaleString()}</strong>
          </span>
          <span className="inline-flex items-center gap-1.5 text-text-muted">
            <Package className="w-4 h-4 text-brand" />
            Posts <strong className="text-text">{profile.totalDrops}</strong>
          </span>
        </div>
      </div>

      {/* All Posts */}
      <section>
        <h2 className="text-lg font-semibold text-text flex items-center gap-2 mb-3">
          <Package className="w-5 h-5 text-brand" />
          All Posts
        </h2>
        {userDrops.length === 0 ? (
          <div className="bg-surface rounded-xl border border-surface-3 p-8 text-center">
            <Package className="w-8 h-8 text-text-muted mx-auto mb-3" />
            <p className="text-text-muted">This user hasn't created any posts yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {userDrops.map((d) => (
              <PostThumbCard key={d.id} drop={d} />
            ))}
          </div>
        )}
      </section>

      {/* Bio Video */}
      {bioVideoEmbedUrl && (
        <div className="bg-surface rounded-2xl border border-surface-3 overflow-hidden">
          <div className="px-5 pt-5 pb-3">
            <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wider">Intro Video</h2>
          </div>
          <div className="aspect-video">
            <iframe
              src={bioVideoEmbedUrl}
              title={`${profile.username} intro video`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="w-full h-full"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PostThumbCard({ drop }: { drop: import('../types').Drop }) {
  const statusColors: Record<string, string> = {
    active: 'bg-green-500/15 text-green-400',
    pending: 'bg-yellow-500/15 text-yellow-400',
    dropped: 'bg-blue-500/15 text-blue-400',
    expired: 'bg-red-500/15 text-red-400',
    draft: 'bg-surface-3 text-text-muted',
    removed: 'bg-surface-3 text-text-muted',
  };

  return (
    <Link
      to={`/post/${drop.id}`}
      className="group block overflow-hidden rounded-xl border border-surface-3 bg-surface-2 no-underline hover:border-brand/50 transition"
    >
      <div className="relative h-28 w-full overflow-hidden bg-surface-3">
        <img
          src={drop.thumbnailUrl || `https://picsum.photos/seed/${drop.id}/360/220`}
          alt={drop.title}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
        />
        <div className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-white">
          <Eye className="w-3 h-3" />
          {Number(drop.views || 0).toLocaleString()}
        </div>
        <span className={`absolute right-2 top-2 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${statusColors[drop.status] || 'bg-surface-3 text-text-muted'}`}>
          {drop.status}
        </span>
      </div>

      <div className="px-2.5 py-2">
        <p className="truncate text-xs font-semibold text-text group-hover:text-brand transition">{drop.title}</p>
      </div>
    </Link>
  );
}
