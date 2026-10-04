import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { Search } from 'lucide-react';
import Navbar from './components/Navbar';
import LandingPage from './pages/LandingPage';
import ClientPage from './pages/ClientPage';
import ClientPortalPage from './pages/ClientPortalPage';
import ClientRegisterPage from './pages/ClientRegisterPage';
import RMPage from './pages/RMPage';
import RMRegisterPage from './pages/RMRegisterPage';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import ProtectedRoute from './components/ProtectedRoute';
import { AuthProvider } from './hooks/useAuth';
import { useLocation } from 'react-router-dom';

function AppRoutes() {
  const location = useLocation();
  // Hide navbar on login page
  const hideNavbar = location.pathname === '/login';

  return (
    <>
      {!hideNavbar && <Navbar />}
      <main id="main-content" role="main">
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />

          {/* Client registration is public (you register to get an account) */}
          <Route path="/client/register" element={<ClientRegisterPage />} />

          {/* RM registration is public (RMs onboard themselves) */}
          <Route path="/rm/register" element={<RMRegisterPage />} />

          {/* Protected: RM routes */}
          <Route
            path="/rm"
            element={
              <ProtectedRoute requiredRole="rm">
                <RMPage />
              </ProtectedRoute>
            }
          />

          {/* Protected: Client routes */}
          <Route
            path="/client"
            element={
              <ProtectedRoute requiredRole="client">
                <ClientPortalPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/client/profile"
            element={
              <ProtectedRoute requiredRole="client">
                <ClientPage />
              </ProtectedRoute>
            }
          />

          {/* Dashboard is accessible to authenticated users of either role */}
          <Route path="/dashboard/:runId" element={<DashboardPage />} />

          {/* 404 fallback */}
          <Route
            path="*"
            element={
              <div
                className="band-dark"
                style={{ minHeight: '80vh', display: 'flex', alignItems: 'center' }}
              >
                <div
                  className="page-container"
                  style={{ textAlign: 'center', paddingTop: 80, paddingBottom: 80 }}
                >
                  <div
                    style={{ fontSize: 48, marginBottom: 24, opacity: 0.3, display: 'flex', justifyContent: 'center' }}
                    aria-hidden="true"
                  >
                    <Search size={48} strokeWidth={1.5} style={{ color: 'var(--stone)' }} />
                  </div>
                  <h1
                    style={{
                      fontFamily: 'Inter, sans-serif',
                      fontSize: 48,
                      fontWeight: 700,
                      color: 'var(--on-dark)',
                      marginBottom: 12,
                      letterSpacing: '-0.48px',
                    }}
                  >
                    Page Not Found
                  </h1>
                  <p
                    style={{
                      color: 'var(--on-dark-mute)',
                      fontSize: 16,
                      marginBottom: 32,
                    }}
                  >
                    The route <code className="mono">{location.pathname}</code> doesn't exist.
                  </p>
                  <Link to="/" className="btn btn-primary">
                    Go Home
                  </Link>
                </div>
              </div>
            }
          />
        </Routes>
      </main>
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
