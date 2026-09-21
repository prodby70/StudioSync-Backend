import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, fileUrl } from "../api.js";
import Shell from "./Shell.jsx";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function Studio() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [studio, setStudio] = useState(null);
  const [date, setDate] = useState(todayISO());
  const [hours, setHours] = useState(1);
  const [startHour, setStartHour] = useState(10);
  const [availability, setAvailability] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/api/studios/${id}`, { auth: false }).then(setStudio).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (!id || !date) return;
    api(`/api/studios/${id}/availability?date=${date}`, { auth: false })
      .then(setAvailability)
      .catch(() => setAvailability(null));
  }, [id, date]);

  const slots = useMemo(() => {
    if (!availability) return [];
    const booked = new Set(availability.booked_hours || []);
    const list = [];
    for (let h = availability.open_hour; h < availability.close_hour; h += 1) {
      list.push({ hour: h, booked: booked.has(h) });
    }
    return list;
  }, [availability]);

  async function book() {
    setBusy(true);
    setError("");
    try {
      await api("/api/bookings", {
        method: "POST",
        body: {
          studio_id: id,
          date,
          start_hour: startHour,
          hours,
          payment_method: "pay_at_studio",
        },
      });
      navigate("/reservas");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!studio) {
    return (
      <Shell>
        <section className="page">
          <p className="muted">{error || "Cargando estudio…"}</p>
        </section>
      </Shell>
    );
  }

  return (
    <Shell>
      <section className="page studio-page">
        <div
          className="hero-photo"
          style={{ backgroundImage: `url(${fileUrl(studio.photos?.[0])})` }}
        />
        <div className="studio-layout">
          <div>
            <p className="kicker">
              {studio.city} · {studio.country}
            </p>
            <h2>{studio.name}</h2>
            <p className="lede tight">{studio.description}</p>
            <ul className="chips">
              {(studio.equipment || []).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <aside className="book-box">
            <p className="price">
              {studio.price_per_hour} {studio.currency}
              <span>/hora</span>
            </p>
            <label>
              Fecha
              <input type="date" value={date} min={todayISO()} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              Hora de inicio
              <select value={startHour} onChange={(e) => setStartHour(Number(e.target.value))}>
                {slots.map((slot) => (
                  <option key={slot.hour} value={slot.hour} disabled={slot.booked}>
                    {String(slot.hour).padStart(2, "0")}:00 {slot.booked ? "(ocupada)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Horas
              <input
                type="number"
                min="1"
                max="8"
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button type="button" className="primary-btn" onClick={book} disabled={busy}>
              {busy ? "Reservando…" : "Reservar y pagar en el estudio"}
            </button>
          </aside>
        </div>
      </section>
    </Shell>
  );
}
