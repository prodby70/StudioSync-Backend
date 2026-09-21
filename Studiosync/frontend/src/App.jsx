import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth.jsx";
import Login from "./pages/Login.jsx";
import Explore from "./pages/Explore.jsx";
import Studio from "./pages/Studio.jsx";
import Bookings from "./pages/Bookings.jsx";

function Guard({ children }) {
  const { user, ready } = useAuth();
  if (!ready) {
    return (
      <div className="boot">
        <div className="pulse-dot" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const { user, ready } = useAuth();

  if (!ready) {
    return (
      <div className="boot">
        <div className="pulse-dot" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route
        path="/"
        element={
          <Guard>
            <Explore />
          </Guard>
        }
      />
      <Route
        path="/studio/:id"
        element={
          <Guard>
            <Studio />
          </Guard>
        }
      />
      <Route
        path="/reservas"
        element={
          <Guard>
            <Bookings />
          </Guard>
        }
      />
      <Route path="*" element={<Navigate to={user ? "/" : "/login"} replace />} />
    </Routes>
  );
}
