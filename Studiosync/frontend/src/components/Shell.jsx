import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth.jsx";

export default function Shell({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="mark">▮</span>
          StudioSync
        </div>
        <nav className="nav">
          <NavLink to="/" end>
            Estudios
          </NavLink>
          <NavLink to="/reservas">Reservas</NavLink>
        </nav>
        <div className="user-chip">
          <span>{user?.name}</span>
          <button
            type="button"
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
          >
            Salir
          </button>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
