import { useEffect, useState } from "react";
import { api, fileUrl } from "../api.js";
import Shell from "./Shell.jsx";

export default function Bookings() {
  const [bookings, setBookings] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/bookings")
      .then((data) => setBookings(data.bookings || []))
      .catch((e) => setError(e.message));
  }, []);

  async function cancel(id) {
    await api(`/api/bookings/${id}/cancel`, { method: "POST" });
    setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, status: "cancelled" } : b)));
  }

  return (
    <Shell>
      <section className="page">
        <h2>Tus reservas</h2>
        {error && <p className="form-error">{error}</p>}
        <div className="booking-list">
          {bookings.map((b) => (
            <article className="booking" key={b.id}>
              <div
                className="booking-photo"
                style={{ backgroundImage: `url(${fileUrl(b.studio_photo)})` }}
              />
              <div>
                <h3>{b.studio_name}</h3>
                <p>
                  {b.date} · {String(b.start_hour).padStart(2, "0")}:00 · {b.hours}h · {b.total_price}{" "}
                  {b.currency}
                </p>
                <p className="muted">
                  {b.status === "cancelled" ? "Cancelada" : "Confirmada"} · pago {b.payment_status}
                </p>
              </div>
              {b.status !== "cancelled" && (
                <button type="button" className="text-btn" onClick={() => cancel(b.id)}>
                  Cancelar
                </button>
              )}
            </article>
          ))}
        </div>
        {bookings.length === 0 && <p className="muted">Aún no tienes reservas.</p>}
      </section>
    </Shell>
  );
}
