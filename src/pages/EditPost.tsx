import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Save, Tag, X, Image } from 'lucide-react';
import { api } from '../lib/api';
import { mapDrop, type ServerPost } from '../hooks/useData';
import type { Post } from '../types';

const FILE_TYPES = ['game', 'app', 'document', 'music', 'video', 'audio', 'image', 'other', 'picture', 'link'] as const;

export default function EditPost() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const thumbnailInputRef = useRef<HTMLInputElement>(null);

  // Form fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [fileType, setFileType] = useState<(typeof FILE_TYPES)[number]>('other');
  const [isMature, setIsMature] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [trailerUrl, setTrailerUrl] = useState('');
  const [linkUrl, setLinkUrl] = useState('');

  const [thumbnailName, setThumbnailName] = useState('');
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailPreviewUrl, setThumbnailPreviewUrl] = useState('');

  const [isThumbnailDragActive, setIsThumbnailDragActive] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.get<ServerPost>(`/api/posts/${id}`)
      .then((raw) => {
        const d = mapDrop(raw);
        // if (d.status !== 'pending') {
        //   setError('Only pending posts can be edited.');
        //   setLoading(false);
        //   return;
        // }
        setPost(d);
        setTitle(d.title);
        setDescription(d.description);
        setFileType(d.fileType);
        setIsMature(Boolean(d.mature));
        setTags(d.tags);
        setTrailerUrl(d.trailerUrl);
        setLinkUrl((d.link || (d.filePath && /^https?:\/\//i.test(d.filePath) ? d.filePath : '') || '').trim());
      })
      .catch(() => setError('Post not found'))
      .finally(() => setLoading(false));
  }, [id]);

  const addTag = () => {
    const t = tagInput.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (t && !tags.includes(t) && tags.length < 8) setTags([...tags, t]);
    setTagInput('');
  };

 const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!id || saving) return;
  setSaving(true);
  setError('');

  try {
    let thumbnailKey: string | undefined;

    // 1. Upload new thumbnail to R2 if the user selected one
    if (thumbnailFile) {
      const { signedUrl, key } = await api.post<{ signedUrl: string; key: string }>(
        `/api/posts/${id}/thumbnail-upload-url`,
        {
          fileName: thumbnailFile.name,
          mimeType: thumbnailFile.type || 'image/jpeg',
        }
      );

      await uploadToStorage(
        signedUrl,
        thumbnailFile,
        thumbnailFile.type || 'image/jpeg',
        () => {}
      );

      thumbnailKey = key;
    }

    // 2. Save post fields (+ new thumbnail key, which triggers old-file deletion server-side)
    await api.put(`/api/posts/${id}`, {
      title: title.trim(),
      description: description.trim(),
      fileType,
      mature: isMature,
      tags,
      trailerUrl: trailerUrl.trim() || null,
      link: fileType === 'link' ? linkUrl.trim() || null : null,
      ...(thumbnailKey ? { thumbnailKey } : {}),
    });

    setSuccess(true);
    setTimeout(() => navigate(`/post/${id}`), 1200);
  } catch (err: unknown) {
    setError(err instanceof Error ? err.message : 'Failed to save changes');
  } finally {
    setSaving(false);
  }
};

  const assignThumbnailFile = (f: File) => {
    setThumbnailName(f.name);
    setThumbnailFile(f);
    const reader = new FileReader();
    reader.onloadend = () => {
      setThumbnailPreviewUrl(reader.result as string);
    };
    reader.readAsDataURL(f);
  };

  const handleThumbnailSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    assignThumbnailFile(f);
  };

  const handleDragOver = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleThumbnailDrop = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    setIsThumbnailDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    assignThumbnailFile(f);
  };

  // helper — reuse from CreatePost
function uploadToStorage(
  signedUrl: string,
  file: File,
  mimeType: string,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', signedUrl);
    xhr.setRequestHeader('Content-Type', mimeType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed: HTTP ${xhr.status}`));
    xhr.onerror = () => reject(new Error('Network error during file upload'));
    xhr.send(file);
  });
}

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error && !post) {
    return (
      <div className="max-w-lg mx-auto py-20 text-center">
        <p className="text-danger mb-4">{error}</p>
        <Link to="/dashboard" className="text-brand hover:underline">← Back to Dashboard</Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-6 px-4">
      <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text transition no-underline mb-6">
        <ArrowLeft className="w-4 h-4" />
        Back to Dashboard
      </Link>

      <h1 className="text-2xl font-bold text-text mb-6">Edit Post</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Title */}
        <div>
          <label className="text-sm text-text-muted block mb-1">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-surface-2 border border-surface-3 rounded-xl px-4 py-2.5 text-sm text-text focus:outline-none focus:border-brand"
            required
          />
        </div>

        {/* Description */}
        <div>
          <label className="text-sm text-text-muted block mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="w-full bg-surface-2 border border-surface-3 rounded-xl px-4 py-2.5 text-sm text-text focus:outline-none focus:border-brand resize-none"
            required
          />
        </div>

        {/* File type */}
        <div>
          <label className="text-sm text-text-muted block mb-1">File Type</label>
          <div className="flex gap-2 flex-wrap">
            {FILE_TYPES.map((ft) => (
              <button
                key={ft}
                type="button"
                onClick={() => setFileType(ft)}
                className={`px-3 py-1.5 rounded-lg text-sm capitalize transition ${fileType === ft
                    ? 'bg-brand text-white'
                    : 'bg-surface-2 text-text-muted hover:text-text border border-surface-3'
                  }`}
              >
                {ft}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-xl border border-surface-3 bg-surface-2 px-4 py-3">
          <input
            type="checkbox"
            checked={isMature}
            onChange={(e) => setIsMature(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-surface-3 text-brand focus:ring-brand"
          />
          <span className="text-sm text-text-muted">
            Mark this post as mature so it is blurred in Explore and More Posts.
          </span>
        </label>

        {/* Tags */}
        <div>
          <label className="text-sm text-text-muted block mb-1">Tags</label>
          <div className="flex gap-2 flex-wrap mb-2">
            {tags.map((t) => (
              <span key={t} className="bg-surface-2 text-text-muted text-xs px-2 py-1 rounded-full flex items-center gap-1">
                #{t}
                <button type="button" onClick={() => setTags(tags.filter((x) => x !== t))} className="hover:text-danger">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } }}
              placeholder="Add a tag…"
              className="flex-1 bg-surface-2 border border-surface-3 rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-brand"
            />
            <button type="button" onClick={addTag} className="px-3 py-2 bg-surface-2 rounded-lg text-text-muted hover:text-brand transition">
              <Tag className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Goal & Price */}
        {/* <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-text-muted block mb-1">Goal Amount (credits)</label>
            <input
              type="number"
              min={1000}
              value={goalAmount}
              onChange={(e) => setGoalAmount(e.target.value)}
              className="w-full bg-surface-2 border border-surface-3 rounded-xl px-4 py-2.5 text-sm text-text font-mono focus:outline-none focus:border-brand"
              required
            />
          </div>
          <div>
            <label className="text-sm text-text-muted block mb-1">Base Price (credits)</label>
            <input
              type="number"
              min={100}
              value={basePrice}
              onChange={(e) => setBasePrice(e.target.value)}
              className="w-full bg-surface-2 border border-surface-3 rounded-xl px-4 py-2.5 text-sm text-text font-mono focus:outline-none focus:border-brand"
              required
            />
          </div>
        </div> */}

        {/* ── Thumbnail + Trailer ── */}
        <div>
          {/* <section className="bg-surface rounded-2xl border border-surface-3 p-5 space-y-4"> */}
          <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wider flex items-center gap-2">
            <Image className="w-4 h-4" /> Thumbnail + Trailer
          </h2>
          <br></br>

          <div>
            <label className="block text-xs text-text-muted mb-1.5">Thumbnail Image</label>
            <input
              ref={thumbnailInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleThumbnailSelect}
            />
            <button
              type="button"
              onClick={() => thumbnailInputRef.current?.click()}
              onDragEnter={() => setIsThumbnailDragActive(true)}
              onDragOver={handleDragOver}
              onDragLeave={() => setIsThumbnailDragActive(false)}
              onDrop={handleThumbnailDrop}
              className={`w-full border border-dashed rounded-xl p-4 flex items-center gap-4 text-left text-text-muted transition ${isThumbnailDragActive
                  ? 'border-brand bg-brand/5 text-brand'
                  : 'border-surface-3 hover:border-brand/50 hover:text-brand'
                }`}
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-surface-3 bg-surface-2">
                <Image className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text">{thumbnailName || 'Upload thumbnail image'}</p>
                <p className="text-xs text-text-muted">Click or drag an image here. Recommended for reels and links.</p>
              </div>
            </button>

            {thumbnailFile && (
              <div className="mt-3 overflow-hidden rounded-2xl border border-surface-3 bg-black/20">
                <img
                  src={thumbnailPreviewUrl}
                  alt={thumbnailName}
                  className="h-56 w-full object-cover"
                />
              </div>
            )}
          </div>
          {/* </section> */}

        </div>


        {/* Trailer URL */}
        <div>
          <label className="text-sm text-text-muted block mb-1">Trailer URL (optional)</label>
          <input
            type="url"
            value={trailerUrl}
            onChange={(e) => setTrailerUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=…"
            className="w-full bg-surface-2 border border-surface-3 rounded-xl px-4 py-2.5 text-sm text-text focus:outline-none focus:border-brand"
          />
        </div>

        {fileType === 'link' && (
          <div>
            <label className="text-sm text-text-muted block mb-1">External Link URL</label>
            <input
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://example.com"
              className="w-full bg-surface-2 border border-surface-3 rounded-xl px-4 py-2.5 text-sm text-text focus:outline-none focus:border-brand"
              required
            />
          </div>
        )}

        {error && <p className="text-danger text-sm">{error}</p>}
        {success && <p className="text-green-500 text-sm">Changes saved! Redirecting…</p>}

        <button
          type="submit"
          disabled={saving || !title.trim() || !description.trim() || (fileType === 'link' && !linkUrl.trim())}
          className="w-full py-3 rounded-xl bg-brand text-white font-bold text-sm hover:bg-brand-dark transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}
