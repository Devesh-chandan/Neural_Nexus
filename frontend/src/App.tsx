import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Search } from 'lucide-react';
import Navbar from './components/Navbar';
import LandingPage from './pages/LandingPage';
import ClientPage from './pages/ClientPage';
import RMPage from './pages/RMPage';
import DashboardPage from './pages/DashboardPage';
import { useLocation } from 'react-router-dom';

function AppRoutes() {
  const location = useLocation();
  const mode =
    location.pathname.startsWith('/rm')
      ? 'rm'
      : location.pathname.startsWith('/client')
      ? 'client'
      : null;

  return (
    <>
      <Navbar mode={mode} />
      <main id="main-content" role="main">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/client" element={<ClientPage />} />
          <Route path="/rm" element={<RMPage />} />
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
                  <a href="/" className="btn btn-primary">
                    Go Home
                  </a>
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
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
