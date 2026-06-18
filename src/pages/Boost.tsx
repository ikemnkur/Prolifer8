import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Zap } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import type { Drop } from '../types';
import { mapDrop, type ServerPost } from '../hooks/useData';

// ── Boost cost constants ──────────────────────────────────────────────────────
// BC is fetched from the server, but we fall back locally while loading.
const DEFAULT_BC = 2;
const COST_PER_HOUR = 2; // 2 credits / hour

function calcCostPerView(bc: number, mediaDurationSecs: number): number {
    return Math.round(bc + 5 * (1 + mediaDurationSecs / 60));
}

const DURATION_OPTIONS: { label: string; hours: number }[] = [
    { label: '6 h', hours: 6 },
    { label: '12 h', hours: 12 },
    { label: '24 h', hours: 24 },
    { label: '48 h', hours: 48 },
    { label: '72 h', hours: 72 },
];

const IMPRESSION_OPTIONS: { label: string; count: number }[] = [
    { label: '1 K', count: 1_000 },
    { label: '2 K', count: 2_000 },
    { label: '5 K', count: 5_000 },
    { label: '10 K', count: 10_000 },
    { label: '15 K', count: 15_000 },
    { label: '20 K', count: 20_000 },
];

const PRIORITY_OPTIONS: { label: string; probability: number }[] = [
    { label: 'Min', probability: 0.1 },
    { label: 'Low', probability: 0.2 },
    { label: 'Medium', probability: 0.3 },
    { label: 'High', probability: 0.4 },
    { label: 'Max', probability: 0.5 },
];

export default function Boost() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { user } = useAuth();

    const [post, setPost] = useState<Drop | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    // Boost config
    const [bc, setBc] = useState(DEFAULT_BC);
    const [budget, setBudget] = useState(500);
    const [selectedHours, setSelectedHours] = useState<number | null>(null);
    const [selectedImpressions, setSelectedImpressions] = useState<number | null>(null);
    const [selectedPriority, setSelectedPriority] = useState<number>(0.3);

    useEffect(() => {
        if (!id) return;
        api
            .get<ServerPost>(`/api/posts/${id}`)
            .then((raw) => setPost(mapDrop(raw)))
            .catch(() => setError('Post not found'))
            .finally(() => setLoading(false));

        // Fetch current baseline cost from server (non-critical)
        api
            .get<{ bc: number }>('/api/boosts/config')
            .then((res) => setBc(res.bc))
            .catch(() => {}); // fall back to DEFAULT_BC
    }, [id]);

    const mediaDuration = 0; // non-video types treated as 0 => cost = BC branch
    const baseCpv = post
        ? ['video', 'music'].includes(post.fileType)
            ? calcCostPerView(bc, mediaDuration)
            : bc
        : bc;
    const cpv = Math.max(1, Math.round(baseCpv * (0.7 + selectedPriority)));

    const estimatedViews = cpv > 0 ? Math.floor(budget / cpv) : 0;
    const canAfford = (user?.creditBalance ?? 0) >= budget;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!id || submitting) return;
        if (budget < 500) {
            setError('Minimum budget is 500 credits.');
            return;
        }
        if (!canAfford) {
            setError('Insufficient credits.');
            return;
        }

        setSubmitting(true);
        setError('');
        try {
            await api.post(`/api/posts/${id}/boost`, {
                budget,
                durationHours: selectedHours,
                maxImpressions: selectedImpressions,
                priorityProbability: selectedPriority,
            });
            setSuccess(true);
            setTimeout(() => navigate('/dashboard'), 1500);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to start boost');
        } finally {
            setSubmitting(false);
        }
    };

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
        <div className="max-w-2xl mx-auto py-6 px-4">
            <Link
                to="/dashboard"
                className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text transition no-underline mb-6"
            >
                <ArrowLeft className="w-4 h-4" />
                Back to Dashboard
            </Link>

            <div className="flex items-center gap-3 mb-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/15">
                    <Zap className="h-5 w-5 text-brand" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-text">Boost Post</h1>
                    {post && <p className="text-sm text-text-muted truncate max-w-xs">{post.title}</p>}
                </div>
            </div>

            <div className="mb-6 rounded-xl border border-surface-3 bg-surface-2/50 px-4 py-3 text-xs text-text-muted space-y-1">
                <p>• <strong className="text-text">Budget:</strong> pre-allocated once from your wallet into campaign balance.</p>
                <p>• <strong className="text-text">Cost per view:</strong> {cpv} credits — watchers earn {Math.floor(cpv / 2)} credits back.</p>
                <p>• <strong className="text-text">Cost per hour active:</strong> {COST_PER_HOUR} credits / hour.</p>
                <p>• <strong className="text-text">Priority affects CPV:</strong> cpv = base * (0.7 + probability).</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                    <label className="text-sm text-text-muted block mb-1">
                        Campaign Budget <span className="text-text-muted/60">(min 500)</span>
                    </label>
                    <input
                        type="number"
                        min={500}
                        step={100}
                        value={budget}
                        onChange={(e) => setBudget(Math.max(500, Number(e.target.value)))}
                        className="w-full bg-surface-2 border border-surface-3 rounded-xl px-4 py-2.5 text-sm text-text font-mono focus:outline-none focus:border-brand"
                        required
                    />
                    <p className="mt-1 text-xs text-text-muted">
                        Approx views from campaign balance: {estimatedViews.toLocaleString()}
                    </p>
                </div>

                <div>
                    <label className="text-sm text-text-muted block mb-2">Time Limit (optional stop rule)</label>
                    <div className="flex flex-wrap gap-2">
                        {DURATION_OPTIONS.map(({ label, hours }) => (
                            <button
                                key={hours}
                                type="button"
                                onClick={() => setSelectedHours(selectedHours === hours ? null : hours)}
                                className={`px-3 py-1.5 rounded-lg text-sm transition ${
                                    selectedHours === hours
                                        ? 'bg-brand text-white'
                                        : 'bg-surface-2 text-text-muted hover:text-text border border-surface-3'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                <div>
                    <label className="text-sm text-text-muted block mb-2">Max Impressions (optional stop rule)</label>
                    <div className="flex flex-wrap gap-2">
                        {IMPRESSION_OPTIONS.map(({ label, count }) => (
                            <button
                                key={count}
                                type="button"
                                onClick={() => setSelectedImpressions(selectedImpressions === count ? null : count)}
                                className={`px-3 py-1.5 rounded-lg text-sm transition ${
                                    selectedImpressions === count
                                        ? 'bg-brand text-white'
                                        : 'bg-surface-2 text-text-muted hover:text-text border border-surface-3'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                <div>
                    <label className="text-sm text-text-muted block mb-2">Priority (delivery frequency)</label>
                    <div className="flex flex-wrap gap-2">
                        {PRIORITY_OPTIONS.map(({ label, probability }) => (
                            <button
                                key={label}
                                type="button"
                                onClick={() => setSelectedPriority(probability)}
                                className={`px-3 py-1.5 rounded-lg text-sm transition ${
                                    selectedPriority === probability
                                        ? 'bg-brand text-white'
                                        : 'bg-surface-2 text-text-muted hover:text-text border border-surface-3'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="rounded-xl border border-surface-3 bg-surface-2 p-4 space-y-1 text-sm">
                    <div className="flex justify-between text-text-muted">
                        <span>Cost per view</span>
                        <span className="font-mono text-text">{cpv.toLocaleString()} cr</span>
                    </div>
                    <div className="flex justify-between text-text-muted">
                        <span>Cost per hour</span>
                        <span className="font-mono text-text">{COST_PER_HOUR.toLocaleString()} cr</span>
                    </div>
                    <div className="flex justify-between text-xs text-text-muted border-t border-surface-3 pt-2">
                        <span>Wallet balance</span>
                        <span className={`font-mono ${canAfford ? 'text-green-500' : 'text-red-400'}`}>
                            {(user?.creditBalance ?? 0).toLocaleString()} cr
                        </span>
                    </div>
                </div>

            {error && <p className="text-danger text-sm">{error}</p>}
            {success && <p className="text-green-500 text-sm">Boost started! Redirecting…</p>}

                <button
                    type="submit"
                    disabled={submitting || !canAfford || budget < 500}
                    className="w-full py-3 rounded-xl bg-brand text-white font-bold text-sm hover:bg-brand-dark transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                >
                    <Zap className="w-4 h-4" />
                    {submitting ? 'Starting...' : 'Start Boost'}
                </button>
            </form>
        </div>
    );
}
