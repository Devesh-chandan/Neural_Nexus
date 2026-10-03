import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Spinner } from './UIKit';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole: 'rm' | 'client';
}

/**
 * Wraps a route so it requires authentication.
 * - While the session is loading, shows a full-page spinner.
 * - If the user is not logged in, redirects to /login.
 * - If logged in but wrong role (e.g. client tries to access /rm), redirects to /login.
 */
const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requiredRole }) => {
  const { token, role, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          minHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          color: 'var(--stone)',
        }}
      >
        <Spinner size={32} />
        <span style={{ fontSize: 14 }}>Validating session…</span>
      </div>
    );
  }

  if (!token || !role) {
    return <Navigate to="/login" replace />;
  }

  if (role !== requiredRole) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
