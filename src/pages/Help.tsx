import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { HelpCircle, Compass, Upload, PlayCircle, MessageSquare, ShieldAlert, UserCircle, Send } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

const SECTIONS = [
  {
    icon: Compass,
    title: 'Getting Started',
    content:
      'Create an account, set your profile, and start browsing posts from Explore or your main feed. Open any post to view media, react, and join discussions.',
  },
  {
    icon: Upload,
    title: 'How to Post Content',
    content:
      'Use the Create Post page to upload your media, add a title, description, and tags, then publish. Clear titles and accurate tags help your content reach the right viewers.',
  },
  {
    icon: PlayCircle,
    title: 'Viewing Posts',
    content:
      'Open a post to watch or listen to content. Media is shown directly on the post page when available. Some posts may link to external content or offer file downloads.',
  },
  {
    icon: MessageSquare,
    title: 'Engagement Tools',
    content:
      'You can like/dislike posts, leave comments, reply to other comments, and submit formal reviews. Use Share to send posts to others.',
  },
  {
    icon: ShieldAlert,
    title: 'Reporting & Safety',
    content:
      'If you see spam, abuse, or suspicious activity, use the report flow from profile/post actions or submit details through the feedback form below.',
  },
  {
    icon: UserCircle,
    title: 'Account & Settings',
    content:
      'Manage your profile, password, notification preferences, and account details in your account pages. Keep your contact info updated for support responses.',
  },
];

export default function Help() {
  const location = useLocation();
  const { user } = useAuth();
  const reportPrefill = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const isReport = params.get('report') === '1';
    const targetId = params.get('targetId')?.trim() ?? '';
    const targetUsername = params.get('targetUsername')?.trim() ?? '';
    return { isReport, targetId, targetUsername };
  }, [location.search]);

  const [supportProblemType, setSupportProblemType] = useState(
    reportPrefill.isReport ? 'report-scammer' : ''
  );
  const [supportTitle, setSupportTitle] = useState(
    reportPrefill.isReport && reportPrefill.targetUsername
      ? `Report user: ${reportPrefill.targetUsername}`
      : ''
  );
  const [supportMessage, setSupportMessage] = useState(
    reportPrefill.isReport
      ? `Target user: ${reportPrefill.targetUsername || 'Unknown'}${
          reportPrefill.targetId ? ` (ID: ${reportPrefill.targetId})` : ''
        }\nReason:`
      : ''
  );
  const [supportContactInfo, setSupportContactInfo] = useState('');
  const [supportUsername, setSupportUsername] = useState(user?.username ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (reportPrefill.isReport) {
      setSupportProblemType('report-scammer');
      if (reportPrefill.targetUsername) {
        setSupportTitle(`Report user: ${reportPrefill.targetUsername}`);
      }
      setSupportMessage(
        `Target user: ${reportPrefill.targetUsername || 'Unknown'}${
          reportPrefill.targetId ? ` (ID: ${reportPrefill.targetId})` : ''
        }\nReason:`
      );
      window.requestAnimationFrame(() => {
        document.getElementById('feedback-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [reportPrefill]);

  const isFormValid = useMemo(() => {
    return !!(
      supportProblemType.trim() &&
      supportTitle.trim() &&
      supportMessage.trim() &&
      supportUsername.trim()
    );
  }, [supportProblemType, supportTitle, supportMessage, supportUsername]);

  async function handleSubmitFeedback(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitStatus(null);

    if (!isFormValid) {
      setSubmitStatus({ kind: 'error', message: 'Please complete feedback type, title, message, and username.' });
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post('/api/site-dev-feedback', {
        supportProblemType: supportProblemType.trim(),
        supportTitle: supportTitle.trim(),
        supportMessage: supportMessage.trim(),
        supportContactInfo: supportContactInfo.trim(),
        supportUsername: supportUsername.trim(),
        supportUserId: user?.id,
        supportTargetType: reportPrefill.isReport ? 'user' : undefined,
        supportTargetId: reportPrefill.targetId || undefined,
        supportTargetUsername: reportPrefill.targetUsername || undefined,
      });

      setSubmitStatus({ kind: 'success', message: 'Thanks! Your feedback has been submitted.' });
      setSupportProblemType('');
      setSupportTitle('');
      setSupportMessage('');
      setSupportContactInfo('');
    } catch {
      setSubmitStatus({ kind: 'error', message: 'Could not submit right now. Please try again shortly.' });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-text flex items-center gap-2 mb-6">
        <HelpCircle className="w-6 h-6 text-brand" />
        Help & Site Guide
      </h1>

      <div className="space-y-4">
        {SECTIONS.map((s, i) => (
          <div key={i} className="bg-surface-2 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <s.icon className="w-5 h-5 text-brand shrink-0" />
              <h2 className="text-base font-semibold text-text">{s.title}</h2>
            </div>
            <p className="text-sm text-text-muted leading-relaxed">{s.content}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 bg-surface-2/50 border border-surface-3 rounded-xl p-6 text-center">
        <p className="text-sm text-text-muted">
          Need direct help? Contact us at{' '}
          <span className="text-brand font-medium">support@Prolifer8.com</span>
        </p>
      </div>

      <div id="feedback-form" className="mt-8 bg-surface-2 border border-surface-3 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-text mb-1">Site Feedback & Bug Reports</h2>
        <p className="text-sm text-text-muted mb-4">
          Found an issue or have an improvement idea? Submit it here and we will review it.
        </p>

        <form className="space-y-3" onSubmit={handleSubmitFeedback}>
          <label className="block">
            <span className="text-sm text-text-muted">Feedback Type</span>
            <select
              value={supportProblemType}
              onChange={(e) => setSupportProblemType(e.target.value)}
              className="mt-1 w-full rounded-lg border border-surface-3 bg-background px-3 py-2 text-sm text-text"
              style={{ backgroundColor: 'rgba(55, 67, 86, 0.94)' }}
              required
            >
              <option value="">Select Feedback Type</option>
              <option value="improvement-issue">Improvement / Tips</option>
              <option value="bug-app-issue">Bugs / App Issues</option>
              <option value="account-issue">Account Issue</option>
              <option value="billing-issue">Billing Issue</option>
              <option value="report-scammer">Report Scammer / Abuse</option>
              <option value="other">Other</option>
            </select>
          </label>

          <label className="block">
            <span className="text-sm text-text-muted">Title</span>
            <input
              type="text"
              value={supportTitle}
              onChange={(e) => setSupportTitle(e.target.value)}
              className="mt-1 w-full rounded-lg border border-surface-3 bg-background px-3 py-2 text-sm text-text"
              placeholder="Short summary"
              required
            />
          </label>

          <label className="block">
            <span className="text-sm text-text-muted">Message</span>
            <textarea
              value={supportMessage}
              onChange={(e) => setSupportMessage(e.target.value)}
              className="mt-1 w-full rounded-lg border border-surface-3 bg-background px-3 py-2 text-sm text-text min-h-28"
              placeholder="Describe the issue or feedback"
              required
            />
          </label>

          <label className="block">
            <span className="text-sm text-text-muted">Email or Other Contact Info (optional)</span>
            <input
              type="text"
              value={supportContactInfo}
              onChange={(e) => setSupportContactInfo(e.target.value)}
              className="mt-1 w-full rounded-lg border border-surface-3 bg-background px-3 py-2 text-sm text-text"
              placeholder="email@example.com or @username"
            />
          </label>

          <label className="block">
            <span className="text-sm text-text-muted">Username</span>
            <input
              type="text"
              value={supportUsername}
              onChange={(e) => setSupportUsername(e.target.value)}
              className="mt-1 w-full rounded-lg border border-surface-3 bg-background px-3 py-2 text-sm text-text"
              placeholder="Your Prolifer8 username"
              required
            />
          </label>

          {submitStatus && (
            <p
              className={`text-sm ${
                submitStatus.kind === 'success' ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {submitStatus.message}
            </p>
          )}

          <button
            type="submit"
            disabled={!isFormValid || isSubmitting}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-black disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
            {isSubmitting ? 'Submitting...' : 'Submit Issue'}
          </button>
        </form>
      </div>
    </div>
  );
}
