import { useEffect, useMemo, useRef, useState } from 'react';

type SponsoredMediaKind = 'image' | 'video' | 'audio';

export interface ExploreSponsoredPromo {
  id: string;
  title: string;
  mediaType: string | null;
  mediaUrl: string | null;
  assetPath: string | null;
  thumbnailPath?: string | null;
  thumbnailImg?: string | null;
}

interface ExploreSponsoredAdCardProps {
  ad: ExploreSponsoredPromo | null;
  onOpen: () => void;
  detectMediaKind: (assetPath: string | null, mediaUrl: string | null, mediaType: string | null | undefined) => SponsoredMediaKind;
  resolveAssetUrl: (pathOrUrl: string | null, fallbackUrl: string | null) => string;
  toEmbedUrl: (url: string) => string | null;
}

export default function ExploreSponsoredAdCard({
  ad,
  onOpen,
  detectMediaKind,
  resolveAssetUrl,
  toEmbedUrl,
}: ExploreSponsoredAdCardProps) {
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [inView, setInView] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [iframeFailed, setIframeFailed] = useState(false);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting && entry.intersectionRatio >= 0.55),
      { threshold: [0, 0.25, 0.55, 0.8, 1] }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (inView) {
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [inView, ad?.id]);

  useEffect(() => {
    setIframeLoaded(false);
    setIframeFailed(false);
  }, [ad?.id]);

  const mediaKind = ad ? detectMediaKind(ad.assetPath, ad.mediaUrl, ad.mediaType) : 'image';
  const mediaUrlSrc = ad ? resolveAssetUrl(ad.mediaUrl, null) : '';
  const audioOrFallbackSrc = ad ? resolveAssetUrl(ad.assetPath, ad.mediaUrl) : '';
  const thumbnailSrc = ad ? resolveAssetUrl(ad.thumbnailPath || ad.thumbnailImg || null, ad.mediaUrl || ad.assetPath) : '';
  console.log('thumbnailSrc:', thumbnailSrc);
  const embedSrc = useMemo(() => {
    if (!ad || mediaKind !== 'video') return null;
    return toEmbedUrl(mediaUrlSrc);
  }, [ad, mediaKind, mediaUrlSrc, toEmbedUrl]);

  useEffect(() => {
    if (!ad || mediaKind !== 'video' || !embedSrc) return;
    if (iframeLoaded || iframeFailed) return;
    const timer = window.setTimeout(() => {
      setIframeFailed(true);
    }, 3500);

    return () => window.clearTimeout(timer);
  }, [ad, mediaKind, embedSrc, iframeLoaded, iframeFailed]);

  const iframeUrl = embedSrc
    ? embedSrc + (embedSrc.includes('?') ? '&' : '?') + (inView ? 'autoplay=1&mute=1' : 'mute=1')
    : null;

  return (
    <button
      ref={cardRef}
      type="button"
      onClick={onOpen}
      className="relative block aspect-[9/12] w-full overflow-hidden rounded-2xl border border-dashed border-surface-3 bg-surface-2 text-left no-underline transition hover:border-brand/50"
      aria-label={ad ? `Open sponsored ad: ${ad.title}` : 'Open sponsored ad slot'}
    >
      <span className="absolute right-2 top-2 z-10 rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
        advertisement
      </span>
      {/* <span className="absolute right-2 top-6 z-10 rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
        sponsored
      </span> */}

      <div className="h-[78%] w-full overflow-hidden bg-surface-3">
        {ad ? (
          mediaKind === 'video' ? (
            iframeUrl && !iframeFailed ? (
              <iframe
                src={iframeUrl}
                title={ad.title}
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                onLoad={() => setIframeLoaded(true)}
              />
            ) : embedSrc ? (
              <img src={thumbnailSrc} alt={ad.title} className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <video
                ref={videoRef}
                src={mediaUrlSrc || audioOrFallbackSrc}
                className="h-full w-full object-cover"
                muted
                playsInline
                loop
                preload="metadata"
              />
            )
          ) : (
            <img src={thumbnailSrc} alt={ad.title} className="h-full w-full object-cover" loading="lazy" />
          )
        ) : (
          <div className="flex h-full items-center justify-center px-3 text-center text-[11px] text-text-muted">Ad space</div>
        )}
      </div>

      <div className="border-t border-surface-3 px-2 py-1.5">
        <div className="relative overflow-hidden whitespace-nowrap text-[10px] font-semibold text-text">
          {ad ? (
            ad.title.length > 30 ? (
              <span className="inline-block min-w-full animate-[marquee_10s_linear_infinite] pr-4">
                {ad.title}
              </span>
            ) : (
                <span className="inline-block min-w-full pr-4">
                {ad.title}
              </span>
            )
          ) : (
            <span className="text-text-muted">Sponsored ad</span>
          )}
        </div>
      </div>
    </button>
  );
}


