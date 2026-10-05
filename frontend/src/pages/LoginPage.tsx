import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Wordmark from '../components/Wordmark';
import {
  ArrowLeft,
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  LogIn,
  ArrowRight,
  Building2,
  History,
  ShieldCheck,
  Fingerprint,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Alert, Spinner } from '../components/UIKit';
import { supabaseConfigured } from '../lib/supabase';

type Portal = 'rm' | 'client';

// The axios interceptor rejects with a flat ApiError ({ detail }); keep the
// raw axios shape as a fallback.
function errorDetail(err: unknown): string | undefined {
  const e = err as { detail?: string; response?: { data?: { detail?: string } } };
  return e?.detail ?? e?.response?.data?.detail ?? (err instanceof Error ? err.message : undefined);
}


const CSS = `
.lg-root { min-height:100vh; background:#0a0a0a; color:#f4f4f4; font-family: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; -webkit-font-smoothing:antialiased; display:flex; flex-direction:column; }
.lg-top { display:flex; align-items:center; justify-content:space-between; padding:22px 32px; }
.lg-back { display:inline-flex; align-items:center; gap:6px; color:#a3a3a3; font-size:14px; font-weight:500; text-decoration:none; padding:8px 12px; border-radius:10px; }
.lg-back:hover { color:#fff; background:#161616; }
.lg-main { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:8px 20px 40px; }
.lg-card { width:100%; max-width:980px; display:grid; grid-template-columns: 0.9fr 1.1fr; background:#101010; border:1px solid #262626; border-radius:24px; overflow:hidden; box-shadow:0 30px 80px -30px rgba(0,0,0,.9); }
.lg-brand { padding:44px 40px; border-right:1px solid #262626; background:radial-gradient(120% 90% at 0% 0%, #1a1a24 0%, #101010 60%); display:flex; flex-direction:column; }
.lg-pill { align-self:flex-start; font-size:12.5px; font-weight:500; color:#d4d4d4; padding:5px 12px; border-radius:9999px; border:1px solid #2e2e2e; background:#141414; }
.lg-h1 { font-size:40px; font-weight:600; letter-spacing:-0.05em; line-height:1.02; margin:22px 0 14px; }
.lg-lede { font-size:15.5px; line-height:1.6; color:#a3a3a3; margin:0 0 30px; }
.lg-points { list-style:none; margin:auto 0 0; padding:0; display:grid; gap:16px; }
.lg-points li { display:flex; gap:14px; align-items:center; }
.lg-points li > span { width:38px; height:38px; border-radius:11px; background:#171717; border:1px solid #2a2a2a; display:inline-flex; align-items:center; justify-content:center; color:#e5e5e5; flex-shrink:0; }
.lg-points b { display:block; font-size:14.5px; font-weight:600; }
.lg-points small { display:block; font-size:13px; color:#8a8a8a; margin-top:1px; }
.lg-form { padding:44px 44px 36px; }
.lg-title { font-size:28px; font-weight:600; letter-spacing:-0.04em; margin:0 0 6px; }
.lg-sub { font-size:14.5px; color:#a3a3a3; margin:0 0 24px; }
.lg-seg { display:grid; grid-template-columns:1fr 1fr; gap:4px; padding:4px; border-radius:12px; background:#161616; border:1px solid #262626; margin-bottom:24px; }
.lg-seg button { display:inline-flex; align-items:center; justify-content:center; gap:8px; height:40px; border:0; border-radius:9px; background:none; color:#a3a3a3; font:inherit; font-size:14px; font-weight:600; cursor:pointer; }
.lg-seg button:hover { color:#fff; }
.lg-seg button[aria-selected="true"] { background:#f4f4f4; color:#0a0a0a; }
.lg-fields { display:grid; gap:18px; }
.lg-label { display:block; font-size:13.5px; font-weight:600; color:#d4d4d4; margin-bottom:8px; }
.lg-input { position:relative; display:flex; align-items:center; }
.lg-input > svg:first-child { position:absolute; left:14px; color:#7c7c7c; pointer-events:none; }
.lg-input input { width:100%; height:48px; border-radius:12px; border:1px solid #2a2a2a; background:#141414; color:#f4f4f4; font:inherit; font-size:15px; padding:0 46px 0 42px; outline:none; transition:border-color .15s, box-shadow .15s; }
.lg-input input::placeholder { color:#6b6b6b; }
.lg-input input:focus { border-color:#6b6b6b; box-shadow:0 0 0 3px rgba(255,255,255,.07); }
.lg-eye { position:absolute; right:6px; width:36px; height:36px; display:inline-flex; align-items:center; justify-content:center; border:0; background:none; color:#8a8a8a; cursor:pointer; border-radius:8px; }
.lg-eye:hover { color:#fff; background:#1c1c1c; }
.lg-submit { margin-top:6px; height:50px; width:100%; display:inline-flex; align-items:center; justify-content:center; gap:10px; border:0; border-radius:12px; background:#f4f4f4; color:#0a0a0a; font:inherit; font-size:15.5px; font-weight:600; cursor:pointer; transition:background .15s, opacity .15s; }
.lg-submit:hover:not(:disabled) { background:#fff; }
.lg-submit:disabled { opacity:.65; cursor:not-allowed; }
.lg-foot { margin-top:22px; padding-top:20px; border-top:1px solid #262626; text-align:center; font-size:14px; color:#a3a3a3; }
.lg-link { color:#fff; font-weight:600; text-decoration:none; display:inline-flex; align-items:center; gap:4px; }
.lg-link:hover { text-decoration:underline; }
.lg-note { margin:20px 0 0; font-size:13px; color:#6f6f6f; text-align:center; }
.lg-root a:focus-visible, .lg-root button:focus-visible, .lg-root input:focus-visible { outline:2px solid #fff; outline-offset:2px; }
@media (max-width: 860px) {
  .lg-card { grid-template-columns:1fr; max-width:520px; }
  .lg-brand { display:none; }
  .lg-form { padding:32px 24px 28px; }
  .lg-top { padding:16px 20px; }
}
`;

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { loginAsRM, loginAsClient } = useAuth();

  const [activePortal, setActivePortal] = useState<Portal>('rm');

  // RM form state
  const [rmEmail, setRmEmail] = useState('');
  const [rmPassword, setRmPassword] = useState('');

  // Client form state
  const [clientEmail, setClientEmail] = useState('');
  const [clientPassword, setClientPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRMLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await loginAsRM(rmEmail.trim(), rmPassword);
      navigate('/rm');
    } catch (err: unknown) {
      setError(errorDetail(err) ?? 'Login failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleClientLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await loginAsClient(clientEmail.trim(), clientPassword);
      navigate('/client');
    } catch (err: unknown) {
      setError(errorDetail(err) ?? 'Login failed. Check your email and password.');
    } finally {
      setLoading(false);
    }
  };

  const switchPortal = (p: Portal) => {
    setActivePortal(p);
    setError(null);
  };

  const isRM = activePortal === 'rm';
  const email = isRM ? rmEmail : clientEmail;
  const password = isRM ? rmPassword : clientPassword;
  const setEmail = isRM ? setRmEmail : setClientEmail;
  const setPassword = isRM ? setRmPassword : setClientPassword;

  return (
    <div className="lg-root">
      <style>{CSS}</style>

      <header className="lg-top">
        <Link to="/" aria-label="Neural Nexus home" style={{ textDecoration: 'none' }}><Wordmark size={19} /></Link>
        <Link to="/" className="lg-back"><ArrowLeft size={14} /> Back to home</Link>
      </header>

      <main className="lg-main">
        <div className="lg-card">
          {/* Brand panel */}
          <aside className="lg-brand" aria-label="About Neural Nexus">
            <span className="lg-pill">Structured product platform</span>
            <h1 className="lg-h1">Welcome back.</h1>
            <p className="lg-lede">Sign in to configure products, replay them on real market history and review every suitability decision.</p>
            <ul className="lg-points">
              <li><span><History size={16} /></span><div><b>20 real past periods</b><small>replayed for every product</small></div></li>
              <li><span><ShieldCheck size={16} /></span><div><b>9 deterministic checks</b><small>fixed, versioned suitability rules</small></div></li>
              <li><span><Fingerprint size={16} /></span><div><b>SHA-256 audit chain</b><small>every assessment recorded</small></div></li>
            </ul>
          </aside>

          {/* Form panel */}
          <section className="lg-form" aria-label="Sign in">
            <h2 className="lg-title">Sign in</h2>
            <p className="lg-sub">Choose your portal and authenticate to continue.</p>

            <div className="lg-seg" role="tablist" aria-label="Choose portal">
              <button id="portal-rm-tab" type="button" role="tab" aria-selected={isRM} onClick={() => switchPortal('rm')}>
                <Building2 size={15} /> RM portal
              </button>
              <button id="portal-client-tab" type="button" role="tab" aria-selected={!isRM} onClick={() => switchPortal('client')}>
                <User size={15} /> Client portal
              </button>
            </div>

            {!supabaseConfigured && (
              <Alert variant="warning" className="mb-4">
                Supabase is not configured. Add the project URL and public anon key to <code>frontend/.env.local</code>, then restart the frontend.
              </Alert>
            )}
            {error && <Alert variant="error" className="mb-4">{error}</Alert>}

            <form onSubmit={isRM ? handleRMLogin : handleClientLogin} className="lg-fields" key={activePortal}>
              <div>
                <label className="lg-label" htmlFor={isRM ? 'rm-login-email' : 'client-login-email'}>
                  {isRM ? 'Corporate email' : 'Email address'}
                </label>
                <div className="lg-input">
                  <Mail size={16} aria-hidden="true" />
                  <input
                    id={isRM ? 'rm-login-email' : 'client-login-email'}
                    type="email"
                    placeholder={isRM ? 'you@institution.com' : 'you@email.com'}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </div>
              </div>

              <div>
                <label className="lg-label" htmlFor={isRM ? 'rm-login-password' : 'client-login-password'}>Password</label>
                <div className="lg-input">
                  <Lock size={16} aria-hidden="true" />
                  <input
                    id={isRM ? 'rm-login-password' : 'client-login-password'}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                  />
                  <button type="button" className="lg-eye" onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}>
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button id={isRM ? 'rm-login-submit' : 'client-login-submit'} type="submit" className="lg-submit" disabled={loading}>
                {loading ? <Spinner size={16} /> : <LogIn size={16} />}
                {loading ? 'Authenticating…' : isRM ? 'Sign in to RM workspace' : 'Sign in to client portal'}
              </button>
            </form>

            <div className="lg-foot">
              {isRM ? 'Not registered yet?' : 'Don’t have an account?'}{' '}
              <Link to={isRM ? '/rm/register' : '/client/register'} className="lg-link">
                {isRM ? 'Register as RM' : 'Register as client'} <ArrowRight size={13} />
              </Link>
            </div>
          </section>
        </div>

        <p className="lg-note">Decision-support tool for institutional use only. Not investment advice.</p>
      </main>
    </div>
  );
};

export default LoginPage;
