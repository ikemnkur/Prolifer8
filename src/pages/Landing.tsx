import { Link } from 'react-router-dom';
import { ArrowRight, Eye, Star, Shuffle, TrendingUp, Upload, Users, CheckCircle } from 'lucide-react';

const steps = [
  {
    icon: <Upload className="w-8 h-8 text-violet-400" />,
    title: 'Post Your Content',
    desc: 'Upload a photo, audio clip, or short video. Tag it so the right people find it.',
  },
  {
    icon: <Eye className="w-8 h-8 text-violet-400" />,
    title: 'We Push It Out',
    desc: 'Our algorithm immediately starts showing your post to relevant audiences — no follower count required.',
  },
  {
    icon: <TrendingUp className="w-8 h-8 text-violet-400" />,
    title: 'Quality Gets Rewarded',
    desc: 'The more people engage, rate, and react, the further your content reaches.',
  },
  {
    icon: <Users className="w-8 h-8 text-violet-400" />,
    title: 'Grow Your Audience',
    desc: 'Your work builds a real following — people who genuinely want to see more from you.',
  },
];

const features = [
  {
    icon: <Shuffle className="w-6 h-6" />,
    title: 'A Fairer Feed',
    desc: "Your content is shown to people based on what they actually like — not who has the most followers or paid the most to be seen first.",
  },
  {
    icon: <Star className="w-6 h-6" />,
    title: 'Effort Is Noticed',
    desc: 'Our community rates posts on quality and effort. High-effort content gets more circulation, not less. Your hard work will never be buried.',
  },
  {
    icon: <Eye className="w-6 h-6" />,
    title: 'Guaranteed Exposure',
    desc: 'Every post gets a real shot at being seen. No post is ignored. The algorithm actively works to maximise how many people see your content.',
  },
];

const stats = [
  { value: '100%', label: 'Posts Actively Promoted' },
  { value: 'Tag-Based', label: 'Personalised Matching' },
  { value: 'Quality-First', label: 'Ranking System' },
  { value: 'Free', label: 'To Start' },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#111827] text-[#e2e8f0]">
      {/* Nav */}
      <nav className="sticky top-0 z-50 bg-[#111827]/90 backdrop-blur border-b border-[#35354d]">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <Link to="/" className="text-violet-400 font-extrabold text-2xl tracking-tight">
            Prolifer<span className="text-white">8</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link to="/login" className="text-sm text-[#94a3b8] hover:text-white transition">
              Sign In
            </Link>
            <Link
              to="/register"
              className="bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition shadow-lg shadow-violet-500/20"
            >
              Get Started Free
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-violet-500/5 via-transparent to-transparent" />
        <div className="max-w-4xl mx-auto text-center px-6 pt-24 pb-20 relative">
          <div className="inline-flex items-center gap-2 bg-violet-500/10 border border-violet-500/30 text-violet-400 text-sm font-medium px-4 py-1.5 rounded-full mb-8">
            <CheckCircle className="w-4 h-4" />
            Every post deserves to be seen
          </div>
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-extrabold leading-tight mb-6">
            <span className="text-white">Your content.</span>
            <br />
            <span className="bg-gradient-to-r from-violet-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              Maximum exposure.
            </span>
            <br />
            <span className="text-white">Fair and square.</span>
          </h1>
          <p className="text-lg md:text-xl text-[#94a3b8] max-w-2xl mx-auto mb-6 leading-relaxed">
            On most platforms, great content gets buried unless you already have a huge following or pay to boost it.
            Prolifer8 is different — our algorithm is built from the ground up to push <strong className="text-white">every</strong> quality post
            in front of the people who will actually love it.
          </p>
          <p className="text-base text-violet-300 font-medium mb-10">
            No gatekeeping. No pay-to-win feeds. Just your best work, reaching the widest possible audience.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/register"
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-bold text-lg px-8 py-4 rounded-xl transition shadow-xl shadow-violet-500/25"
            >
              Start Posting <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              to="/login"
              className="flex items-center gap-2 border border-[#35354d] hover:border-violet-500/50 text-[#e2e8f0] font-semibold text-lg px-8 py-4 rounded-xl transition"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* Problem / Solution callout */}
      <section className="py-16 bg-[#1a1a2e] border-y border-[#35354d]">
        <div className="max-w-5xl mx-auto px-6 grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-white mb-4">
              Other platforms ignore your work.
            </h2>
            <p className="text-[#94a3b8] leading-relaxed">
              You spend hours creating something genuinely good — and it gets shown to 12 people.
              Meanwhile, low-effort content from big accounts floods everyone's feeds.
              The algorithm punishes newcomers and rewards popularity, not quality.
            </p>
          </div>
          <div className="bg-[#2a2a3e] border border-violet-500/30 rounded-2xl p-6">
            <h3 className="text-violet-400 font-bold text-xl mb-3">Prolifer8 flips the script.</h3>
            <ul className="space-y-3 text-[#94a3b8] text-sm leading-relaxed">
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-violet-400 mt-0.5 flex-shrink-0" />
                Every post is actively circulated — no post is just dropped and forgotten.
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-violet-400 mt-0.5 flex-shrink-0" />
                Quality and effort are measured by real community ratings and directly influence reach.
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-violet-400 mt-0.5 flex-shrink-0" />
                Your tags match your content to the exact people who want to see it.
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-violet-400 mt-0.5 flex-shrink-0" />
                Randomness baked into the algorithm gives every post a fair shot, even with zero followers.
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-white mb-4">
            How It Works
          </h2>
          <p className="text-[#94a3b8] text-center max-w-xl mx-auto mb-14">
            Post it, tag it, and let Prolifer8 do the rest.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map((s, i) => (
              <div
                key={i}
                className="relative bg-[#2a2a3e] border border-[#35354d] rounded-xl p-6 hover:border-violet-500/50 transition"
              >
                <div className="absolute -top-3 -left-3 w-7 h-7 bg-violet-600 rounded-full flex items-center justify-center text-xs font-bold text-white">
                  {i + 1}
                </div>
                <div className="mb-4">{s.icon}</div>
                <h3 className="text-white font-semibold text-lg mb-2">{s.title}</h3>
                <p className="text-[#94a3b8] text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Algorithm highlight */}
      <section className="bg-[#1e1e2e] border-y border-[#35354d] py-20">
        <div className="max-w-5xl mx-auto px-6">
          <div className="bg-gradient-to-r from-violet-600/10 to-pink-600/10 border border-violet-500/30 rounded-2xl p-8 md:p-12 flex flex-col md:flex-row items-center gap-10">
            <div className="flex-1">
              <p className="text-violet-400 text-sm font-semibold uppercase tracking-widest mb-3">Our Algorithm</p>
              <h2 className="text-3xl font-bold text-white mb-4">
                Built to be uniquely fair.
              </h2>
              <p className="text-[#94a3b8] leading-relaxed mb-6">
                We don't just look at follower counts or engagement history.
                Our recommendation engine weighs <span className="text-white font-medium">what your content is about</span>,
                the <span className="text-white font-medium">quality and effort</span> the community says it reflects,
                and a <span className="text-white font-medium">built-in randomness</span> factor that ensures undiscovered creators
                always have a fighting chance.
              </p>
              <p className="text-[#94a3b8] leading-relaxed">
                As viewers watch content, the system quietly builds a personalised taste profile for them — so your post
                reaches people who are <em>genuinely interested</em>, not just whoever the algorithm defaults to.
              </p>
            </div>
            <div className="flex-shrink-0 grid grid-cols-2 gap-4 text-center">
              {[
                { label: 'Tag Match', sub: 'Reaches the right audience' },
                { label: 'Quality Score', sub: 'Community-rated reach boost' },
                { label: 'Randomness', sub: 'Discovery for new creators' },
                { label: 'Boost Credits', sub: 'Optional extended reach' },
              ].map((item, i) => (
                <div key={i} className="bg-[#111827] border border-[#35354d] rounded-xl p-4">
                  <p className="text-violet-400 font-bold text-sm">{item.label}</p>
                  <p className="text-[#64748b] text-xs mt-1 leading-tight">{item.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20">
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-center text-white mb-4">
            Why Prolifer8?
          </h2>
          <p className="text-[#94a3b8] text-center max-w-xl mx-auto mb-14">
            A platform that actually works for creators at every level.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {features.map((f, i) => (
              <div key={i} className="text-center">
                <div className="inline-flex items-center justify-center w-14 h-14 bg-violet-500/10 text-violet-400 rounded-xl mb-4">
                  {f.icon}
                </div>
                <h3 className="text-white font-semibold text-lg mb-2">{f.title}</h3>
                <p className="text-[#94a3b8] text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="bg-[#1e1e2e] border-y border-[#35354d] py-16">
        <div className="max-w-4xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {stats.map((s, i) => (
              <div
                key={i}
                className="bg-[#2a2a3e] border border-[#35354d] rounded-xl p-6 text-center"
              >
                <p className="text-2xl md:text-3xl font-bold text-violet-400">{s.value}</p>
                <p className="text-[#94a3b8] text-sm mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-violet-500/10 rounded-full mb-6">
            <TrendingUp className="w-8 h-8 text-violet-400" />
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Ready to be seen?
          </h2>
          <p className="text-[#94a3b8] text-lg mb-8 max-w-xl mx-auto">
            Join Prolifer8 and start sharing content that gets the audience it deserves.
            Free to start — no credit card required.
          </p>
          <Link
            to="/register"
            className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-bold text-lg px-10 py-4 rounded-xl transition shadow-xl shadow-violet-500/25"
          >
            Create Your Account <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#35354d] py-8">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-[#94a3b8] text-sm">
            © {new Date().getFullYear()} <span className="text-violet-400 font-bold">Prolifer8</span>. All rights reserved.
          </div>
          <div className="flex gap-6 text-sm text-[#64748b]">
            <Link to="/help" className="hover:text-white transition">Help</Link>
            <a href="mailto:support@prolifer8.com" className="hover:text-white transition">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
