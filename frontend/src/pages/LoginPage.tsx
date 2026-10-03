import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  User,
  Mail,
  Lock,
  IdCard,
  Eye,
  EyeOff,
  LogIn,
  ArrowRight,
  Building2,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Alert, Spinner } from '../components/UIKit';

type Portal = 'rm' | 'client';

// The axios interceptor rejects with a flat ApiError ({ detail }); keep the
// raw axios shape as a fallback.
function errorDetail(err: unknown): string | undefined {
  const e = err as { detail?: string; response?: { data?: { detail?: string } } };
  return e?.detail ?? e?.response?.data?.detail;
}

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { loginAsRM, loginAsClient } = useAuth();

  const [activePortal, setActivePortal] = useState<Portal>('rm');

  // RM form state
  const [rmEmail, setRmEmail] = useState('');
  const [rmEmployeeId, setRmEmployeeId] = useState('');

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
      await loginAsRM(rmEmail.trim(), rmEmployeeId.trim());
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

  return (
    <div className="login-page">
      <div className="login-shell">
        <Link to="/" className="login-back">
          <ArrowLeft size={14} /> Back to home
        </Link>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Link to="/" className="navbar-logo" style={{ justifyContent: 'center', marginBottom: 28 }}>
            <img src="/logo.png" alt="" aria-hidden="true" className="navbar-logo-img" />
            <span>Neural Nexus</span>
          </Link>
          <h1 className="display-md" style={{ color: 'var(--on-dark)', marginBottom: 10 }}>
            Sign in
          </h1>
          <p style={{ fontSize: 15, color: 'var(--on-dark-mute)', maxWidth: 380, margin: '0 auto' }}>
            Choose your portal and authenticate to access the structured product platform.
          </p>
        </div>

        {/* Portal selector */}
        <div className="segmented" role="tablist" aria-label="Choose portal">
          <button
            id="portal-rm-tab"
            type="button"
            role="tab"
            aria-selected={activePortal === 'rm'}
            className={`segmented-btn ${activePortal === 'rm' ? 'active' : ''}`}
            onClick={() => switchPortal('rm')}
          >
            <Building2 size={15} /> RM Portal
          </button>
          <button
            id="portal-client-tab"
            type="button"
            role="tab"
            aria-selected={activePortal === 'client'}
            className={`segmented-btn ${activePortal === 'client' ? 'active' : ''}`}
            onClick={() => switchPortal('client')}
          >
            <User size={15} /> Client Portal
          </button>
        </div>

        <div className="login-card animate-scale" key={activePortal}>
          {error && (
            <Alert variant="error" className="mb-4">
              {error}
            </Alert>
          )}

          {/* ── RM Login ─────────────────────────────────────────────────── */}
          {activePortal === 'rm' && (
            <>
              <div className="login-card-head">
                <div className="card-title" style={{ marginBottom: 2 }}>Relationship Manager</div>
                <div style={{ fontSize: 13, color: 'var(--stone)' }}>
                  Use your institutional credentials
                </div>
              </div>

              <form onSubmit={handleRMLogin} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="rm-login-email">
                    Corporate email
                  </label>
                  <div className="input-icon">
                    <Mail size={16} aria-hidden="true" />
                    <input
                      id="rm-login-email"
                      type="email"
                      className="form-input"
                      placeholder="you@institution.com"
                      value={rmEmail}
                      onChange={(e) => setRmEmail(e.target.value)}
                      required
                      autoComplete="email"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="rm-login-emp-id">
                    Employee ID
                  </label>
                  <div className="input-icon">
                    <IdCard size={16} aria-hidden="true" />
                    <input
                      id="rm-login-emp-id"
                      type="text"
                      className="form-input mono"
                      placeholder="e.g. EMP-SNR-D5B487"
                      value={rmEmployeeId}
                      onChange={(e) => setRmEmployeeId(e.target.value)}
                      required
                      autoComplete="off"
                    />
                  </div>
                  <div className="form-hint">The employee ID you used during RM registration.</div>
                </div>

                <button
                  id="rm-login-submit"
                  type="submit"
                  className="btn btn-primary w-full"
                  style={{ marginTop: 6 }}
                  disabled={loading}
                >
                  {loading ? <Spinner size={16} /> : <LogIn size={16} />}
                  {loading ? 'Authenticating…' : 'Sign in to RM Workspace'}
                </button>
              </form>

              <div className="login-card-foot">
                Not registered yet?{' '}
                <Link to="/rm/register" className="login-link">
                  Register as RM <ArrowRight size={13} />
                </Link>
              </div>
            </>
          )}

          {/* ── Client Login ─────────────────────────────────────────────── */}
          {activePortal === 'client' && (
            <>
              <div className="login-card-head">
                <div className="card-title" style={{ marginBottom: 2 }}>Client Portal</div>
                <div style={{ fontSize: 13, color: 'var(--stone)' }}>
                  Sign in with your registered email
                </div>
              </div>

              <form onSubmit={handleClientLogin} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="client-login-email">
                    Email address
                  </label>
                  <div className="input-icon">
                    <Mail size={16} aria-hidden="true" />
                    <input
                      id="client-login-email"
                      type="email"
                      className="form-input"
                      placeholder="your@email.com"
                      value={clientEmail}
                      onChange={(e) => setClientEmail(e.target.value)}
                      required
                      autoComplete="email"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="client-login-password">
                    Password
                  </label>
                  <div className="input-icon">
                    <Lock size={16} aria-hidden="true" />
                    <input
                      id="client-login-password"
                      type={showPassword ? 'text' : 'password'}
                      className="form-input"
                      placeholder="Enter your password"
                      value={clientPassword}
                      onChange={(e) => setClientPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      style={{ paddingRight: 48 }}
                    />
                    <button
                      type="button"
                      className="input-icon-action"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <button
                  id="client-login-submit"
                  type="submit"
                  className="btn btn-primary w-full"
                  style={{ marginTop: 6 }}
                  disabled={loading}
                >
                  {loading ? <Spinner size={16} /> : <LogIn size={16} />}
                  {loading ? 'Authenticating…' : 'Sign in to Client Portal'}
                </button>
              </form>

              <div className="login-card-foot">
                Don't have an account?{' '}
                <Link to="/client/register" className="login-link">
                  Register as client <ArrowRight size={13} />
                </Link>
              </div>
            </>
          )}
        </div>

        <p className="login-note">
          Decision-support tool for institutional use only. Not investment advice.
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
