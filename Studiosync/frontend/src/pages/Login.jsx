import { useState } from "react";
import { useAuth } from "../auth.jsx";
import { startGoogleLogin } from "../api.js";

export default function Login() {
  const { login, register, error, setError } = useAuth();
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setLocalError("");
    setError("");
    setBusy(true);
    try {
      if (mode === "register") await register(name, email, password);
      else await login(email, password);
    } catch (err) {
      setLocalError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const message = localError || error;

  return (
    <div className="login-shell">
      <div className="login-glow" aria-hidden="true" />
      <div className="login-grid" aria-hidden="true" />

      <header className="login-top">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          StudioSync
        </div>
        <span className="pill">Europa</span>
      </header>

      <main className="login-hero">
        <p className="kicker">Studios · ensayo · grabación</p>
        <h1>Reserva estudios por horas en Europa</h1>
        <p className="lede">Encuentra salas de grabación y ensayo cerca de ti</p>

        <div className="login-card">
          <button type="button" className="google-btn" onClick={startGoogleLogin}>
            <GoogleIcon />
            Continuar con Google
          </button>

          <div className="or">
            <span>o con email</span>
          </div>

          <form className="auth-form" onSubmit={onSubmit}>
            {mode === "register" && (
              <label>
                Nombre
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Tu nombre"
                  required
                />
              </label>
            )}
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                required
              />
            </label>
            <label>
              Contraseña
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                minLength={6}
                required
              />
            </label>
            {message && <p className="form-error">{message}</p>}
            <button className="primary-btn" type="submit" disabled={busy}>
              {busy ? "Entrando…" : mode === "register" ? "Crear cuenta" : "Entrar"}
            </button>
          </form>

          <button
            type="button"
            className="ghost-link"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setLocalError("");
            }}
          >
            {mode === "login" ? "¿No tienes cuenta? Regístrate" : "¿Ya tienes cuenta? Inicia sesión"}
          </button>
        </div>
      </main>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16.1 19 13 24 13c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-1.3 3.8-4.6 6.6-8.6 7.5l6.3 5.3C36.9 38.3 44 33 44 24c0-1.2-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}
