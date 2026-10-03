import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LogOut, ChevronDown, User, Building2, Menu, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

interface NavbarProps {
  mode?: 'rm' | 'client' | null;
}

const Navbar: React.FC<NavbarProps> = ({ mode }) => {
  const navigate = useNavigate();
  const { user, role, logout } = useAuth();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

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

  const links: { to: string; label: string; end?: boolean }[] = [
    { to: '/', label: 'Home', end: true },
    // Show nav links relevant to the logged-in role
    ...(role === 'client' ? [{ to: '/client', label: 'Client Portal', end: true }] : []),
    ...(role === 'rm' ? [{ to: '/rm', label: 'RM Workspace', end: true }] : []),
    // Registration links for unauthenticated users
    ...(!role
      ? [
          { to: '/client/register', label: 'Client KYC' },
          { to: '/rm/register', label: 'RM Onboarding' },
        ]
      : []),
  ];

  return (
    <nav className="navbar" role="navigation" aria-label="Main navigation">
      <div className="navbar-inner">
        <NavLink to="/" className="navbar-logo" aria-label="Neural Nexus home">
          <img src="/logo.png" alt="" aria-hidden="true" className="navbar-logo-img" />
          <span>Neural Nexus</span>
        </NavLink>

        <ul className="navbar-nav" role="list">
          {links.map((l) => (
            <li key={l.to}>
              <NavLink to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                {l.label}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          {mode && role && (
            <span
              className={`navbar-mode-badge ${mode}`}
              aria-label={`Current mode: ${mode === 'rm' ? 'Relationship Manager' : 'Client'}`}
            >
              <span className="rule-dot GREEN" style={{ width: 6, height: 6 }} aria-hidden="true" />
              {mode === 'rm' ? 'RM View' : 'Client View'}
            </span>
          )}

          {/* Logged-in user chip */}
          {displayName && role ? (
            <div style={{ position: 'relative' }}>
              <button
                id="navbar-user-menu-btn"
                className="navbar-user-btn"
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                aria-expanded={userMenuOpen}
                aria-haspopup="true"
              >
                <span className={`navbar-avatar ${role}`} aria-hidden="true">
                  {displayName.slice(0, 2).toUpperCase()}
                </span>
                <span className="navbar-user-name">{displayName}</span>
                <ChevronDown size={14} style={{ opacity: 0.6 }} />
              </button>

              {userMenuOpen && (
                <>
                  {/* Backdrop to close menu */}
                  <div
                    style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                    onClick={() => setUserMenuOpen(false)}
                  />
                  <div className="navbar-menu" role="menu">
                    {/* User info header */}
                    <div className="navbar-menu-header">
                      <div className="navbar-menu-name">
                        {role === 'rm' ? <Building2 size={13} /> : <User size={13} />}
                        {displayName}
                      </div>
                      <div className="navbar-menu-meta">
                        {role === 'rm'
                          ? [user?.institution, user?.access_tier].filter(Boolean).join(' · ')
                          : `Case ID: ${user?.case_id || ''}`}
                      </div>
                    </div>

                    {/* Logout */}
                    <button
                      id="navbar-logout-btn"
                      className="navbar-menu-item danger"
                      onClick={handleLogout}
                      role="menuitem"
                    >
                      <LogOut size={14} /> Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <NavLink to="/login" className="btn btn-primary btn-sm" aria-label="Log in">
              Log In
            </NavLink>
          )}

          <button
            type="button"
            className="navbar-burger"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            aria-controls="navbar-mobile-menu"
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <ul id="navbar-mobile-menu" className="navbar-mobile" role="list">
          {links.map((l) => (
            <li key={l.to}>
              <NavLink
                to={l.to}
                end={l.end}
                className={({ isActive }) => (isActive ? 'active' : '')}
                onClick={() => setMobileOpen(false)}
              >
                {l.label}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
};

export default Navbar;
