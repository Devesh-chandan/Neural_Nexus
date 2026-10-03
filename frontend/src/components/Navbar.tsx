import React from 'react';
import { NavLink } from 'react-router-dom';
import { Brain } from 'lucide-react';

interface NavbarProps {
  mode?: 'rm' | 'client' | null;
}

const Navbar: React.FC<NavbarProps> = ({ mode }) => {
  return (
    <nav className="navbar" role="navigation" aria-label="Main navigation">
      <div className="navbar-inner">
        <NavLink to="/" className="navbar-logo" aria-label="Neural Nexus home">
          <span className="logo-icon" aria-hidden="true">
            <Brain size={18} />
          </span>
          Neural Nexus
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
          <li>
            <NavLink
              to="/client"
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              Client
            </NavLink>
          </li>
          <li>
            <NavLink
              to="/rm"
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              RM
            </NavLink>
          </li>
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
          <NavLink
            to="/client"
            className="btn btn-primary"
            style={{ height: 40, padding: '10px 22px', fontSize: 15 }}
            aria-label="Open Client questionnaire"
          >
            Get Started
          </NavLink>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
