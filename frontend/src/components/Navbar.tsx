import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LogOut, ChevronDown, User, Building2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

interface NavbarProps {
  mode?: 'rm' | 'client' | null;
}

const Navbar: React.FC<NavbarProps> = ({ mode }) => {
  const navigate = useNavigate();
  const { user, role, logout } = useAuth();
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const displayName =
    role === 'rm'
      ? user?.legal_name || 'RM'
      : role === 'client'
      ? user?.client_name || 'Client'
      : null;

  return (
    <nav className="navbar" role="navigation" aria-label="Main navigation">
      <div className="navbar-inner">
        <NavLink to="/" className="navbar-logo" aria-label="Neural Nexus home" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img
            src="/logo.png"
            alt="Neural Nexus Logo"
            style={{
              height: 36,
              width: 'auto',
              borderRadius: 6,
              objectFit: 'contain',
              boxShadow: '0 2px 8px rgba(0, 168, 126, 0.25)',
            }}
          />
          <span style={{
            fontFamily: 'Inter, sans-serif',
            fontWeight: 800,
            fontSize: 18,
            letterSpacing: '0.03em',
            background: 'linear-gradient(135deg, #ffffff 40%, #00a87e 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            textTransform: 'uppercase',
          }}>
            Neural Nexus
          </span>
        </NavLink>

        <ul className="navbar-nav" role="list">
          <li>
            <NavLink
              to="/"
              end
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              Home
            </NavLink>
          </li>
          {/* Show nav links relevant to the logged-in role */}
          {role === 'client' && (
            <li>
              <NavLink
                to="/client"
                end
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                Client Portal
              </NavLink>
            </li>
          )}
          {role === 'rm' && (
            <li>
              <NavLink
                to="/rm"
                end
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                RM Workspace
              </NavLink>
            </li>
          )}
          {/* Always show registration links for unauthenticated users */}
          {!role && (
            <>
              <li>
                <NavLink
                  to="/client/register"
                  className={({ isActive }) => (isActive ? 'active' : '')}
                >
                  Client KYC
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/rm/register"
                  className={({ isActive }) => (isActive ? 'active' : '')}
                >
                  RM Onboarding
                </NavLink>
              </li>
            </>
          )}
        </ul>

        <div className="flex items-center gap-3">
          {mode && (
            <span
              className={`navbar-mode-badge ${mode}`}
              aria-label={`Current mode: ${mode === 'rm' ? 'Relationship Manager' : 'Client'}`}
            >
              <span className={`rule-dot ${mode === 'rm' ? 'GREEN' : 'GREEN'}`} style={{ width: 6, height: 6 }} aria-hidden="true" />
              {mode === 'rm' ? 'RM View' : 'Client View'}
            </span>
          )}

          {/* Logged-in user chip */}
          {displayName && role ? (
            <div style={{ position: 'relative' }}>
              <button
                id="navbar-user-menu-btn"
                className="btn btn-outline-dark btn-sm"
                style={{
                  height: 38,
                  padding: '0 14px',
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                aria-expanded={userMenuOpen}
                aria-haspopup="true"
              >
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: role === 'rm'
                      ? 'linear-gradient(135deg, var(--primary) 0%, #7c3aed 100%)'
                      : 'linear-gradient(135deg, #00a87e 0%, #0284c7 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    color: '#fff',
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {displayName.slice(0, 2).toUpperCase()}
                </div>
                <span>{displayName}</span>
                <ChevronDown size={13} style={{ opacity: 0.6 }} />
              </button>

              {userMenuOpen && (
                <>
                  {/* Backdrop to close menu */}
                  <div
                    style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                    onClick={() => setUserMenuOpen(false)}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: 'calc(100% + 8px)',
                      background: 'var(--surface-elevated)',
                      border: '1px solid var(--hairline-dark)',
                      borderRadius: 10,
                      padding: '8px 0',
                      minWidth: 200,
                      zIndex: 100,
                      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                    }}
                  >
                    {/* User info header */}
                    <div style={{ padding: '10px 16px 10px', borderBottom: '1px solid var(--hairline-dark)', marginBottom: 4 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 2 }}>
                        {role === 'rm' ? <Building2 size={12} style={{ display: 'inline', marginRight: 4 }} /> : <User size={12} style={{ display: 'inline', marginRight: 4 }} />}
                        {displayName}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--stone)' }}>
                        {role === 'rm' ? `${user?.institution || ''} · ${user?.access_tier || ''}` : `Case ID: ${user?.case_id || ''}`}
                      </div>
                    </div>

                    {/* Logout */}
                    <button
                      id="navbar-logout-btn"
                      onClick={handleLogout}
                      style={{
                        width: '100%',
                        background: 'none',
                        border: 'none',
                        padding: '10px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 13,
                        color: 'var(--accent-danger)',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <LogOut size={14} /> Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <NavLink
              to="/login"
              className="btn btn-primary"
              style={{ height: 40, padding: '10px 22px', fontSize: 15 }}
              aria-label="Log in"
            >
              Log In
            </NavLink>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
