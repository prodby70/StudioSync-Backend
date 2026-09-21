import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../auth.jsx";

export default function Shell({ children }) {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="nav">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true" />
          StudioSync
        </Link>
        <nav>
          <NavLink to="/" end>
            Explorar
          </NavLink>
          <NavLink to="/reservas">Reservas</NavLink>
        </nav>
        <div className="nav-user">
          <span>{user?.name}</span>
          <button type="button" className="text-btn" onClick={logout}>
            Salir
          </button>
        </div>
      </header>
      {children}
    </div>
  );
}
