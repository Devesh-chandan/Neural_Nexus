import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldCheck,
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
import { Spinner } from '../components/UIKit';

type Portal = 'rm' | 'client';

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
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e?.response?.data?.detail ?? 'Login failed. Check your credentials.');
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
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e?.response?.data?.detail ?? 'Login failed. Check your email and password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Background grid decoration */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(rgba(73,79,223,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(73,79,223,0.06) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          zIndex: 0,
        }}
        aria-hidden="true"
      />
      {/* Subtle radial glow behind cards */}
      <div
        style={{
          position: 'absolute',
          top: '30%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 600,
          height: 600,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(73,79,223,0.12) 0%, transparent 70%)',
          zIndex: 0,
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      />

      {/* Page content */}
      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 880 }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div className="flex items-center justify-center gap-3 mb-4">
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: 'linear-gradient(135deg, var(--primary) 0%, #7c3aed 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ShieldCheck size={22} color="#fff" />
            </div>
            <span
              style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: 22,
                fontWeight: 700,
                color: '#fff',
                letterSpacing: '-0.5px',
              }}
            >
              Neural Nexus
            </span>
          </div>
          <h1
            style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: 32,
              fontWeight: 700,
              color: '#fff',
              letterSpacing: '-0.5px',
              marginBottom: 8,
            }}
          >
            Secure Portal Access
          </h1>
          <p style={{ fontSize: 15, color: 'var(--stone)', maxWidth: 480, margin: '0 auto' }}>
            Select your portal below and authenticate to access the structured product platform
          </p>
        </div>

        {/* Portal selector tabs */}
        <div
          className="flex"
          style={{
            gap: 12,
            justifyContent: 'center',
            marginBottom: 32,
          }}
        >
          <button
            id="portal-rm-tab"
            className={`btn btn-sm ${activePortal === 'rm' ? 'btn-cobalt' : 'btn-ghost'}`}
            style={{
              height: 42,
              padding: '0 24px',
              fontSize: 14,
              fontWeight: 600,
              borderRadius: 10,
              transition: 'all 0.2s',
            }}
            onClick={() => { setActivePortal('rm'); setError(null); }}
          >
            <Building2 size={15} /> RM Portal
          </button>
          <button
            id="portal-client-tab"
            className={`btn btn-sm ${activePortal === 'client' ? 'btn-cobalt' : 'btn-ghost'}`}
            style={{
              height: 42,
              padding: '0 24px',
              fontSize: 14,
              fontWeight: 600,
              borderRadius: 10,
              transition: 'all 0.2s',
            }}
            onClick={() => { setActivePortal('client'); setError(null); }}
          >
            <User size={15} /> Client Portal
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div
            style={{
              background: 'rgba(226,59,74,0.1)',
              border: '1px solid rgba(226,59,74,0.35)',
              borderRadius: 10,
              padding: '12px 16px',
              marginBottom: 20,
              fontSize: 14,
              color: '#f87171',
              textAlign: 'center',
            }}
          >
            {error}
          </div>
        )}

        {/* ── RM Login Card ───────────────────────────────────────────────── */}
        {activePortal === 'rm' && (
          <div
            className="card animate-in"
            style={{
              maxWidth: 440,
              margin: '0 auto',
              border: '1px solid rgba(73,79,223,0.3)',
              background: 'var(--surface-elevated)',
              padding: '36px 40px',
              borderRadius: 18,
            }}
          >
            {/* Card header */}
            <div className="flex items-center gap-3 mb-6">
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 10,
                  background: 'linear-gradient(135deg, var(--primary) 0%, #7c3aed 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Building2 size={20} color="#fff" />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 17, color: '#fff' }}>
                  Relationship Manager
                </div>
                <div style={{ fontSize: 12, color: 'var(--stone)' }}>
                  Use your institutional credentials
                </div>
              </div>
            </div>

            <form onSubmit={handleRMLogin} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="rm-login-email">
                  <Mail size={13} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                  Corporate Email
                </label>
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

              <div className="form-group">
                <label className="form-label" htmlFor="rm-login-emp-id">
                  <IdCard size={13} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                  Employee ID
                </label>
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
                <div style={{ fontSize: 11, color: 'var(--stone)', marginTop: 4 }}>
                  Same employee ID you used during RM registration
                </div>
              </div>

              <button
                id="rm-login-submit"
                type="submit"
                className="btn btn-cobalt"
                style={{ height: 46, fontSize: 15, justifyContent: 'center', marginTop: 8 }}
                disabled={loading}
              >
                {loading ? <Spinner size={16} /> : <LogIn size={16} />}
                {loading ? 'Authenticating…' : 'Login to RM Workspace'}
              </button>
            </form>

            <div
              style={{
                marginTop: 24,
                paddingTop: 20,
                borderTop: '1px solid var(--hairline-dark)',
                textAlign: 'center',
                fontSize: 13,
                color: 'var(--stone)',
              }}
            >
              Not registered yet?{' '}
              <a
                href="/rm/register"
                style={{ color: 'var(--primary-bright)', textDecoration: 'none', fontWeight: 600 }}
              >
                Register as RM <ArrowRight size={12} style={{ display: 'inline', verticalAlign: 'middle' }} />
              </a>
            </div>
          </div>
        )}

        {/* ── Client Login Card ───────────────────────────────────────────── */}
        {activePortal === 'client' && (
          <div
            className="card animate-in"
            style={{
              maxWidth: 440,
              margin: '0 auto',
              border: '1px solid rgba(0,168,126,0.3)',
              background: 'var(--surface-elevated)',
              padding: '36px 40px',
              borderRadius: 18,
            }}
          >
            {/* Card header */}
            <div className="flex items-center gap-3 mb-6">
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 10,
                  background: 'linear-gradient(135deg, #00a87e 0%, #0284c7 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <User size={20} color="#fff" />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 17, color: '#fff' }}>
                  Client Portal
                </div>
                <div style={{ fontSize: 12, color: 'var(--stone)' }}>
                  Log in with your registered email
                </div>
              </div>
            </div>

            <form onSubmit={handleClientLogin} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="client-login-email">
                  <Mail size={13} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                  Email Address
                </label>
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

              <div className="form-group">
                <label className="form-label" htmlFor="client-login-password">
                  <Lock size={13} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                  Password
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="client-login-password"
                    type={showPassword ? 'text' : 'password'}
                    className="form-input"
                    placeholder="Enter your password"
                    value={clientPassword}
                    onChange={(e) => setClientPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    style={{ paddingRight: 44 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      right: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--stone)',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button
                id="client-login-submit"
                type="submit"
                className="btn btn-sm"
                style={{
                  height: 46,
                  fontSize: 15,
                  justifyContent: 'center',
                  marginTop: 8,
                  background: 'linear-gradient(135deg, #00a87e 0%, #0284c7 100%)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
                disabled={loading}
              >
                {loading ? <Spinner size={16} /> : <LogIn size={16} />}
                {loading ? 'Authenticating…' : 'Login to Client Portal'}
              </button>
            </form>

            <div
              style={{
                marginTop: 24,
                paddingTop: 20,
                borderTop: '1px solid var(--hairline-dark)',
                textAlign: 'center',
                fontSize: 13,
                color: 'var(--stone)',
              }}
            >
              Don't have an account?{' '}
              <a
                href="/client/register"
                style={{ color: '#00a87e', textDecoration: 'none', fontWeight: 600 }}
              >
                Register as Client <ArrowRight size={12} style={{ display: 'inline', verticalAlign: 'middle' }} />
              </a>
            </div>
          </div>
        )}

        {/* Footer note */}
        <div
          style={{
            textAlign: 'center',
            marginTop: 32,
            fontSize: 12,
            color: 'var(--stone)',
            opacity: 0.7,
          }}
        >
          Decision-support tool for institutional use only. Not investment advice.
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
