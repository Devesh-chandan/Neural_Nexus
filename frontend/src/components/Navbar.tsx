import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LogOut, ChevronDown, User, Building2, Menu, X } from 'lucide-react';
import Wordmark from './Wordmark';
import { useAuth } from '../hooks/useAuth';

interface NavbarProps {}

const Navbar: React.FC<NavbarProps> = () => {
  const navigate = useNavigate();
  const { user, role, loading, logout } = useAuth();
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

  const links = [
    { to: '/', label: 'Home', end: true },
    ...(role === 'client'
      ? [
          { to: '/client', label: 'Client Portal', end: true },
          { to: '/client/profile', label: 'My Profile', end: true },
        ]
      : []),
    ...(role === 'rm' ? [{ to: '/rm', label: 'RM Workspace', end: true }] : []),
  ];

  return (
    <nav className="navbar" role="navigation" aria-label="Main navigation">
      <div className="navbar-inner">
        <NavLink to="/" className="navbar-logo" aria-label="Neural Nexus home">
          <Wordmark />
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
                  <div className={`navbar-menu ${role === 'rm' ? 'navbar-menu-wide' : ''}`} role="menu">
                    {role === 'rm' ? (
                      <div className="navbar-menu-header">
                        <div className="rm-menu-identity">
                          <span className="navbar-avatar rm rm-menu-avatar" aria-hidden="true">
                            {displayName.slice(0, 2).toUpperCase()}
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <div className="navbar-menu-name">{displayName}</div>
                            <div className="navbar-menu-meta">
                              <Building2 size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
                              {user?.institution || '—'}
                            </div>
                          </div>
                        </div>

                        <dl className="rm-menu-details">
                          <div><dt>RM ID</dt><dd className="mono">{user?.rm_id || '—'}</dd></div>
                          <div><dt>Branch</dt><dd className="mono">{user?.branch_code || '—'}</dd></div>
                          <div>
                            <dt>Clearance</dt>
                            <dd><span className="rm-menu-chip">{(user?.access_tier || '—').replace(/_/g, ' ')}</span></dd>
                          </div>
                          <div><dt>Jurisdiction</dt><dd className="mono">{user?.operating_jurisdiction || '—'}</dd></div>
                          <div>
                            <dt>Products</dt>
                            <dd className="rm-menu-products">
                              {(user?.authorised_product_types?.length ? user.authorised_product_types : ['ELN', 'CPN', 'DCD']).map((p) => (
                                <span key={p} className="rm-menu-chip mono">{p}</span>
                              ))}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    ) : (
                      <div className="navbar-menu-header">
                        <div className="navbar-menu-name">
                          <User size={13} />
                          {displayName}
                        </div>
                        {user?.case_id && <div className="navbar-menu-meta">Case ID: {user.case_id}</div>}
                      </div>
                    )}

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
            // Don't flash "Log In" at a signed-in user while the stored session is still being validated.
            !loading && (
              <NavLink to="/login" className="btn btn-primary btn-sm" aria-label="Log in">
                Log In
              </NavLink>
            )
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
