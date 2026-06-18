import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload,
  Film,
  Image,
  FileText,
  Tag,
  X,
  Flame,
  CheckCircle,
  Lock,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const API_BASE = import.meta.env.VITE_API_URL || '';
const FILE_TYPE_OPTIONS = [
  { value: 'video', label: 'Video clip' },
  { value: 'audio', label: 'Audio' },
  { value: 'image', label: 'Picture' },
  { value: 'document', label: 'Text / Doc' },
  { value: 'game', label: 'Game' },
  { value: 'app', label: 'App' },
  { value: 'other', label: 'Link / Other' },
] as const;

type FileTypeOption = (typeof FILE_TYPE_OPTIONS)[number]['value'];

export default function CreatePost() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isPremium = (user?.accountType ?? '').toLowerCase() === 'premium';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [fileType, setFileType] = useState<FileTypeOption>('image');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [goalAmount, setGoalAmount] = useState('');
  const [basePrice, setBasePrice] = useState('');
  const [durationDays, setDurationDays] = useState('7');
  const [trailerUrl, setTrailerUrl] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  // 'refund' = credits returned to contributors on expiry | 'keep' = post stays downloadable
  const [expiryBehaviour] = useState<'refund' | 'keep'>('refund');
  const [expiryThreshold] = useState<number>(0);
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState('');
  const [thumbnailName, setThumbnailName] = useState('');
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailPreviewUrl, setThumbnailPreviewUrl] = useState('');
  const [postFile, setPostFile] = useState<File | null>(null);
  const [postFileMime, setPostFileMime] = useState('');
  const [filePreviewUrl, setFilePreviewUrl] = useState('');
  const [filePreviewText, setFilePreviewText] = useState('');
  const [isFileDragActive, setIsFileDragActive] = useState(false);
  const [isThumbnailDragActive, setIsThumbnailDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStep, setUploadStep] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [createdPostId, setCreatedPostId] = useState('');

  const assignPostFile = (f: File) => {
    setFileName(f.name);
    setPostFile(f);
    setPostFileMime(f.type || 'application/octet-stream');
    const mb = f.size / (1024 * 1024);
    setFileSize(mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`);
  };

  const assignThumbnailFile = (f: File) => {
    if (!f.type.startsWith('image/')) {
      setSubmitError('Thumbnail must be an image file.');
      return;
    }
    setSubmitError('');
    setThumbnailName(f.name);
    setThumbnailFile(f);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setSubmitError('');
    assignPostFile(f);
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

  const handleFileDrop = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    setIsFileDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    setSubmitError('');
    assignPostFile(f);
  };

  const handleThumbnailDrop = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    setIsThumbnailDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    assignThumbnailFile(f);
  };

  const addTag = () => {
    const t = tagInput.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (t && !tags.includes(t) && tags.length < 10) {
      setTags([...tags, t]);
    }
    setTagInput('');
  };

  const removeTag = (t: string) => setTags(tags.filter((x) => x !== t));

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    }
  };

  const allowsLinkOnly = ['game', 'app', 'document', 'other'].includes(fileType);
  const canSubmit = title.trim() && summary.trim() && !submitting && (fileName || (allowsLinkOnly && linkUrl.trim()));

  useEffect(() => {
    if (!postFile) {
      setFilePreviewUrl('');
      setFilePreviewText('');
      return;
    }

    const previewUrl = URL.createObjectURL(postFile);
    setFilePreviewUrl(previewUrl);
    setFilePreviewText('');

    const shouldReadText = postFile.type.startsWith('text/') || ['application/json', 'application/xml', 'application/pdf'].includes(postFile.type);
    if (shouldReadText) {
      const reader = new FileReader();
      reader.onload = () => {
        const raw = typeof reader.result === 'string' ? reader.result : '';
        setFilePreviewText(raw.slice(0, 1400));
      };
      reader.readAsText(postFile);
    }

    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [postFile]);

  useEffect(() => {
    if (!thumbnailFile) {
      setThumbnailPreviewUrl('');
      return;
    }

    const previewUrl = URL.createObjectURL(thumbnailFile);
    setThumbnailPreviewUrl(previewUrl);

    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [thumbnailFile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitError('');
    setSubmitting(true);
    setUploadProgress(0);
    setUploadStep('');

    try {
      const durationMs = Number(durationDays) * 24 * 60 * 60 * 1000;
      const now = Date.now();
      // const scheduledDropTime = new Date(now + durationMs).toISOString();
      const expiresAt = new Date(now + durationMs + 2 * 24 * 60 * 60 * 1000).toISOString();

      // 1. Create the drop record
      setUploadStep('Creating drop…');
      const { id: dropId } = await api.post<{ id: string; message: string }>('/api/posts', {
        title: title.trim(),
        description: summary.trim(),
        fileType,
        tags,
        goalAmount: Number(goalAmount),
        basePrice: Number(basePrice),
        // scheduledDropTime,
        expiresAt,
        trailerUrl: trailerUrl.trim() || null,
        externalUrl: linkUrl.trim() || null,
        expiryBehaviour: isPremium ? expiryBehaviour : 'refund',
        expiryThreshold: (isPremium && expiryBehaviour === 'keep' && expiryThreshold > 0) ? expiryThreshold / 100 : null,
      });

      setCreatedPostId(dropId);

      // 2. Upload thumbnail if selected
      if (thumbnailFile) {
        setUploadStep('Uploading thumbnail…');
        const token = localStorage.getItem('prolifer8_token');
        const form = new FormData();
        form.append('banner', thumbnailFile);
        await fetch(`${API_BASE}/api/posts/${dropId}/banner`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: form,
        });
      }

      // 3. Upload the post file to GCS
      if (postFile) {
        const mimeType = postFileMime || 'application/octet-stream';

        setUploadStep('Preparing upload…');
        const { uploadUrl } = await api.post<{ uploadUrl: string; gcsPath: string }>(
          `/api/posts/${dropId}/upload-url`,
          { fileName: postFile.name, fileType: mimeType, fileSize: postFile.size }
        );

        setUploadStep('Uploading file…');
        await uploadToGCS(uploadUrl, postFile, mimeType, setUploadProgress);

        setUploadStep('Confirming upload…');
        await api.post(`/api/posts/${dropId}/confirm-upload`, {
          originalFileName: postFile.name,
        });
      }

      // 4. Publish (draft → pending)
      setUploadStep('Publishing…');
      await api.post(`/api/posts/${dropId}/publish`);

      setSubmitted(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create post';
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
      setUploadStep('');
    }
  };

  if (submitted) {
    return (
      <div className="max-w-lg mx-auto py-20 text-center space-y-4">
        <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
        <h1 className="text-2xl font-bold text-text">Post Created!</h1>
        <p className="text-text-muted text-sm">
          Your post <span className="text-brand font-semibold">{title}</span> is now live and
          ready to publically viewable on the network.
        </p>
        <div className="flex justify-center gap-3 pt-2">
          <button
            onClick={() => navigate(`/post/${createdPostId}`)}
            className="px-5 py-2 rounded-lg bg-brand text-white font-medium text-sm hover:bg-brand-dark transition"
          >
            View Post
          </button>
          <button
            onClick={() => navigate('/dashboard')}
            className="px-5 py-2 rounded-lg bg-surface-2 text-text-muted font-medium text-sm hover:text-text border border-surface-3 transition"
          >
            Go to Dashboard
          </button>
          <button
            onClick={() => {
              setSubmitted(false);
              setTitle('');
              setSummary('');
              setFileName('');
              setFileSize('');
              setThumbnailName('');
              setThumbnailFile(null);
              setPostFile(null);
              setLinkUrl('');
              setTags([]);
              setGoalAmount('');
              setBasePrice('');
              setTrailerUrl('');
              setDurationDays('7');
              setCreatedPostId('');
              setSubmitError('');
            }}
            className="px-5 py-2 rounded-lg bg-surface-2 text-text-muted font-medium text-sm hover:text-text border border-surface-3 transition"
          >
            Create Another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-6 px-4">
      <div className="flex items-center gap-3 mb-6">
        <Flame className="w-6 h-6 text-brand" />
        <h1 className="text-2xl font-bold text-text">Create a Post</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* ── File Upload ── */}
        <section className="bg-surface rounded-2xl border border-surface-3 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wider flex items-center gap-2">
            <Upload className="w-4 h-4" /> File
          </h2>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileSelect}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={() => setIsFileDragActive(true)}
            onDragOver={handleDragOver}
            onDragLeave={() => setIsFileDragActive(false)}
            onDrop={handleFileDrop}
            className={`w-full border-2 border-dashed rounded-xl p-8 flex flex-col items-center gap-2 text-text-muted transition group ${
              isFileDragActive
                ? 'border-brand bg-brand/5 text-brand'
                : 'border-surface-3 hover:border-brand/50 hover:text-brand'
            }`}
          >
            <Upload className="w-8 h-8 group-hover:scale-110 transition-transform" />
            {fileName ? (
              <div className="text-center">
                <p className="text-sm font-medium text-text">{fileName}</p>
                <p className="text-xs text-text-muted">{fileSize}</p>
              </div>
            ) : (
              <p className="text-sm">Click or drag a file here to post</p>
            )}
          </button>

          {postFile && (
            <div className="overflow-hidden rounded-2xl border border-surface-3 bg-surface-2">
              <div className="border-b border-surface-3 px-4 py-3">
                <p className="text-xs uppercase tracking-wider text-text-muted">Preview</p>
                <p className="text-sm text-text">{fileName}</p>
              </div>
              <div className="p-4">
                {postFileMime.startsWith('image/') ? (
                  <img src={filePreviewUrl} alt={fileName} className="max-h-80 w-full rounded-xl object-contain bg-black/20" />
                ) : postFileMime.startsWith('video/') ? (
                  <video controls src={filePreviewUrl} className="max-h-80 w-full rounded-xl bg-black/20" />
                ) : postFileMime.startsWith('audio/') ? (
                  <audio controls src={filePreviewUrl} className="w-full" />
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 rounded-xl border border-surface-3 bg-black/10 p-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface-3">
                        <FileText className="h-5 w-5 text-brand" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-text">Document preview</p>
                        <p className="text-xs text-text-muted">{fileSize}</p>
                      </div>
                    </div>
                    {filePreviewText ? (
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-surface-3 bg-black/20 p-4 text-xs leading-6 text-text-muted">
                        {filePreviewText}
                      </pre>
                    ) : (
                      <p className="text-sm text-text-muted">
                        This file type does not render inline. The card above shows the selected document.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-text-muted mb-1.5">File Type</label>
              <select
                value={fileType}
                onChange={(e) => setFileType(e.target.value as FileTypeOption)}
                className="w-full bg-surface-2 border border-surface-3 rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-brand"
              >
                {FILE_TYPE_OPTIONS.map((ft) => (
                  <option key={ft.value} value={ft.value}>
                    {ft.label}
                  </option>
                ))}
              </select>
            </div>
            {/* <div>
              <label className="block text-xs text-text-muted mb-1.5">Duration (days until expiry)</label>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-text-muted shrink-0" />
                <input
                  type="number"
                  min="1"
                  max="90"
                  value={durationDays}
                  onChange={(e) => setDurationDays(e.target.value)}
                  className="w-full bg-surface-2 border border-surface-3 rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-brand"
                />
              </div>
            </div> */}
          </div>
        </section>

        {/* ── Details ── */}
        <section className="bg-surface rounded-2xl border border-surface-3 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wider flex items-center gap-2">
            <FileText className="w-4 h-4" /> Details
          </h2>

          <div>
            <label className="block text-xs text-text-muted mb-1.5">Title</label>
            <input
              type="text"
              maxLength={80}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Galactic Frontier — Season Pass"
              className="w-full bg-surface-2 border border-surface-3 rounded-lg px-3 py-2 text-sm text-text placeholder-text-muted/50 focus:outline-none focus:border-brand"
            />
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1.5">Summary</label>
            <textarea
              rows={4}
              maxLength={1000}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Tell people what this post is about…"
              className="w-full bg-surface-2 border border-surface-3 rounded-lg px-3 py-2 text-sm text-text placeholder-text-muted/50 focus:outline-none focus:border-brand resize-none"
            />
            <p className="text-right text-xs text-text-muted mt-1">{summary.length}/1000</p>
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1.5">Tags (up to 10)</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 bg-surface-2 text-text-muted text-xs px-2.5 py-1 rounded-full"
                >
                  #{t}
                  <button type="button" onClick={() => removeTag(t)} className="hover:text-red-400 transition">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Tag className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  placeholder="Add a tag, press Enter"
                  className="w-full bg-surface-2 border border-surface-3 rounded-lg pl-8 pr-3 py-2 text-sm text-text placeholder-text-muted/50 focus:outline-none focus:border-brand"
                />
              </div>
              <button
                type="button"
                onClick={addTag}
                className="px-3 py-2 rounded-lg bg-surface-2 border border-surface-3 text-sm text-text-muted hover:text-brand hover:border-brand/50 transition"
              >
                Add
              </button>
            </div>
          </div>
        </section>

        {/* ── Thumbnail + Trailer ── */}
        <section className="bg-surface rounded-2xl border border-surface-3 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wider flex items-center gap-2">
            <Image className="w-4 h-4" /> Thumbnail + Trailer
          </h2>

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
              className={`w-full border border-dashed rounded-xl p-4 flex items-center gap-4 text-left text-text-muted transition ${
                isThumbnailDragActive
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

          {allowsLinkOnly && (
            <div>
              <label className="block text-xs text-text-muted mb-1.5">Link URL</label>
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-text-muted shrink-0" />
                <input
                  type="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://example.com/game-or-app"
                  className="w-full bg-surface-2 border border-surface-3 rounded-lg px-3 py-2 text-sm text-text placeholder-text-muted/50 focus:outline-none focus:border-brand"
                />
              </div>
              <p className="mt-1 text-xs text-text-muted">
                Optional for game, app, text/doc, or link-based posts.
              </p>
            </div>
          )}

          {allowsLinkOnly && (
            <div>
              <label className="block text-xs text-text-muted mb-1.5">Trailer / Preview Video (YouTube URL)</label>
              <div className="flex items-center gap-2">
                <Film className="w-4 h-4 text-text-muted shrink-0" />
                <input
                  type="url"
                  value={trailerUrl}
                  onChange={(e) => setTrailerUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="w-full bg-surface-2 border border-surface-3 rounded-lg px-3 py-2 text-sm text-text placeholder-text-muted/50 focus:outline-none focus:border-brand"
                />
              </div>
              <p className="mt-1 text-xs text-text-muted">
                Most useful for game, app, text/doc, and link-style posts.
              </p>
            </div>
          )}

          {trailerUrl && /youtube\.com|youtu\.be/.test(trailerUrl) && (
            <div className="rounded-xl overflow-hidden border border-surface-3 aspect-video">
              <iframe
                src={toYouTubeEmbed(trailerUrl)}
                title="Trailer preview"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full"
              />
            </div>
          )}
        </section>

        {/* ── Pricing & Goal ── */}
        {/* <section className="bg-surface rounded-2xl border border-surface-3 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wider flex items-center gap-2">
            <DollarSign className="w-4 h-4" /> Pricing &amp; Goal
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-text-muted mb-1.5">Spark Goal (credits to activate timer)</label>
              <input
                type="number"
                min="1000"
                step="100"
                value={goalAmount}
                onChange={(e) => setGoalAmount(e.target.value)}
                placeholder="e.g. 50000"
                className="w-full bg-surface-2 border border-surface-3 rounded-lg px-3 py-2 text-sm text-text placeholder-text-muted/50 focus:outline-none focus:border-brand"
              />
              {goalAmount && (
                <p className="text-xs text-text-muted mt-1">
                  ≈ ${(Number(goalAmount) / 1000).toFixed(2)} USD
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1.5">Base Price (credits after drop)</label>
              <input
                type="number"
                min="100"
                step="1"
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
                placeholder="e.g. 5000"
                className="w-full bg-surface-2 border border-surface-3 rounded-lg px-3 py-2 text-sm text-text placeholder-text-muted/50 focus:outline-none focus:border-brand"
              />
              {basePrice && (
                <p className="text-xs text-text-muted mt-1">
                  ≈ ${(Number(basePrice) / 1000).toFixed(2)} USD
                </p>
              )}
            </div>
          </div>
        </section> */}

        {/* ── Submit ── */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 pb-8">
          {submitError && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 w-full sm:w-auto">
              {submitError}
            </p>
          )}
          {submitting && uploadStep.includes('Uploading file') && (
            <div className="w-full">
              <div className="flex justify-between text-xs text-text-muted mb-1">
                <span>{uploadStep}</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
                <div className="h-full bg-brand transition-all duration-150" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          )}
          <p className="text-xs text-text-muted">
            By creating a drop you agree to the Prolifer8 Creator Terms.
          </p>
          <button
            type="submit"
            disabled={!canSubmit}
            className={`px-8 py-3 rounded-xl font-semibold text-sm transition flex items-center gap-2 ${
              canSubmit
                ? 'bg-brand text-white hover:bg-brand-dark shadow-lg shadow-brand/20'
                : 'bg-surface-3 text-text-muted cursor-not-allowed'
            }`}
          >
            <Flame className="w-4 h-4" />
            {submitting ? (uploadStep || 'Creating…') : 'Create Post'}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Upload a file to GCS via a pre-signed PUT URL, reporting progress 0→100. */
function uploadToGCS(
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
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Network error during file upload'));
    xhr.send(file);
  });
}

/** Convert a YouTube watch/share URL to an embed URL */
function toYouTubeEmbed(url: string): string {
  try {
    const u = new URL(url);
    let videoId = '';
    if (u.hostname.includes('youtu.be')) {
      videoId = u.pathname.slice(1);
    } else {
      videoId = u.searchParams.get('v') || '';
    }
    return videoId ? `https://www.youtube.com/embed/${encodeURIComponent(videoId)}` : '';
  } catch {
    return '';
  }
}
