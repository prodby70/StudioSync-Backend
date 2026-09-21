import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fileUrl } from "../api.js";
import Shell from "./Shell.jsx";

export default function Explore() {
  const [q, setQ] = useState("");
  const [type, setType] = useState("all");
  const [studios, setStudios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (q.trim()) params.set("q", q.trim());
        if (type !== "all") params.set("type", type);
        const data = await api(`/api/studios?${params.toString()}`, { auth: false });
        if (!cancelled) setStudios(data.studios || []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [q, type]);

  return (
    <Shell>
      <section className="page">
        <div className="page-head">
          <div>
            <p className="kicker">Cerca de ti</p>
            <h2>Estudios en Europa</h2>
          </div>
          <div className="filters">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar ciudad o estudio"
            />
            <div className="seg">
              {[
                ["all", "Todos"],
                ["recording", "Grabación"],
                ["rehearsal", "Ensayo"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={type === value ? "on" : ""}
                  onClick={() => setType(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <p className="form-error">{error}</p>}
        {loading && <p className="muted">Cargando salas…</p>}

        <div className="cards">
          {studios.map((studio) => (
            <Link to={`/studio/${studio.id}`} className="card" key={studio.id}>
              <div
                className="card-photo"
                style={{ backgroundImage: `url(${fileUrl(studio.photos?.[0])})` }}
              />
              <div className="card-body">
                <div className="card-meta">
                  <span>{studio.city}</span>
                  <span>★ {studio.rating}</span>
                </div>
                <h3>{studio.name}</h3>
                <p>
                  {studio.type === "rehearsal" ? "Ensayo" : "Grabación"} · {studio.price_per_hour}{" "}
                  {studio.currency}/h
                </p>
              </div>
            </Link>
          ))}
        </div>
        {!loading && studios.length === 0 && (
          <p className="muted">No hay estudios verificados todavía. Arranca el backend para sembrar datos de ejemplo.</p>
        )}
      </section>
    </Shell>
  );
}
