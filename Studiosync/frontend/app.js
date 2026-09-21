const TOKEN_KEY = "studiosync_token";
const root = document.getElementById("root");

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function consumeSessionId() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const search = new URLSearchParams(window.location.search);
  const sessionId = hash.get("session_id") || search.get("session_id");
  if (sessionId) window.history.replaceState({}, "", "/");
  return sessionId;
}

function startGoogleLogin() {
  const redirect = `${window.location.origin}/`;
  window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirect)}`;
}

function fileUrl(path) {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `/api/files/${path}`;
}

async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((d) => d.msg || d).join(", ")
          : res.statusText;
    throw new Error(message || "Error de red");
  }
  return data;
}

const state = { user: null, ready: false, error: "" };

function pathOf() {
  return window.location.pathname;
}

function go(pathname) {
  window.history.pushState({}, "", pathname);
  render();
}

window.addEventListener("popstate", render);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function bootScreen() {
  return `<div class="boot"><div class="pulse-dot"></div></div>`;
}

function loginView() {
  return `
    <div class="login-shell">
      <div class="login-glow" aria-hidden="true"></div>
      <div class="login-grid" aria-hidden="true"></div>
      <header class="login-top">
        <div class="brand"><span class="brand-mark" aria-hidden="true"></span>StudioSync</div>
        <span class="pill">Europa</span>
      </header>
      <main class="login-hero">
        <p class="kicker">Studios · ensayo · grabación</p>
        <h1>Reserva estudios por horas en Europa</h1>
        <p class="lede">Encuentra salas de grabación y ensayo cerca de ti</p>
        <div class="login-card">
          <button type="button" class="google-btn" id="google-btn">
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z"/>
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16.1 19 13 24 13c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"/>
              <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.3 3.8-4.6 6.6-8.6 7.5l6.3 5.3C36.9 38.3 44 33 44 24c0-1.2-.1-2.4-.4-3.5z"/>
            </svg>
            Continuar con Google
          </button>
          <div class="or"><span>o con email</span></div>
          <form class="auth-form" id="auth-form">
            <label>Nombre<input name="name" placeholder="Tu nombre" /></label>
            <label>Email<input type="email" name="email" placeholder="tu@email.com" required /></label>
            <label>Contraseña<input type="password" name="password" minlength="6" placeholder="Mínimo 6 caracteres" required /></label>
            <p class="form-error" id="auth-error" hidden></p>
            <button class="primary-btn" type="submit">Entrar</button>
          </form>
          <button type="button" class="ghost-link" id="user-login">Entrar como usuario de prueba</button>
          <button type="button" class="ghost-link" id="toggle-mode">¿No tienes cuenta? Regístrate</button>
        </div>
      </main>
    </div>
  `;
}

function tabbar() {
  const p = pathOf();
  return `
    <nav class="tabbar" aria-label="Principal">
      <a href="/" data-link class="${p === "/" ? "active" : ""}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/></svg>
        Inicio
      </a>
      <a href="/mapa" data-link class="${p === "/mapa" ? "active" : ""}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/></svg>
        Mapa
      </a>
      <a href="/reservas" data-link class="${p === "/reservas" ? "active" : ""}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v3H7zm-2 4h14a1 1 0 0 1 1 1v13H4V8a1 1 0 0 1 1-1zm3 4h10v2H8zm0 4h7v2H8z"/></svg>
        Reservas
      </a>
      <a href="/perfil" data-link class="${p === "/perfil" ? "active" : ""}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z"/></svg>
        Perfil
      </a>
      <a href="/contacto" data-link class="${p === "/contacto" ? "active" : ""}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v10H7l-3 3z"/></svg>
        Contacto
      </a>
    </nav>
  `;
}

function shell(inner, { map = false } = {}) {
  return `
    <div class="app-shell${map ? " map-mode" : ""}">
      ${
        map
          ? ""
          : `<header class="nav">
        <a href="/" class="brand" data-link><span class="brand-mark"></span>StudioSync</a>
        <nav>
          <a href="/" data-link class="${pathOf() === "/" ? "active" : ""}">Explorar</a>
          <a href="/mapa" data-link class="${pathOf() === "/mapa" ? "active" : ""}">Mapa</a>
          <a href="/reservas" data-link class="${pathOf() === "/reservas" ? "active" : ""}">Reservas</a>
          ${
            state.user?.is_admin
              ? `<a href="/admin" data-link class="${pathOf() === "/admin" ? "active" : ""}">Admin</a>`
              : ""
          }
        </nav>
        <div class="nav-user">
          ${state.user?.is_admin ? `<span class="pill">Admin</span>` : ""}
          <span>${escapeHtml(state.user?.name || "")}</span>
          <button type="button" class="text-btn" id="logout">Salir</button>
        </div>
      </header>`
      }
      ${inner}
      ${tabbar()}
    </div>
  `;
}

async function renderExplore() {
  root.innerHTML = shell(`<section class="page"><p class="muted">Cargando salas…</p></section>`);
  bindShell();
  let studios = [];
  let error = "";
  try {
    const data = await api("/api/studios", { auth: false });
    studios = data.studios || [];
  } catch (err) {
    error = err.message;
  }
  root.innerHTML = shell(`
    <section class="page">
      <div class="page-head">
        <div>
          <p class="kicker">Cerca de ti</p>
          <h2>Estudios en Europa</h2>
        </div>
        <div class="filters">
          <input id="q" placeholder="Buscar ciudad o estudio" />
          <div class="seg" id="type-seg">
            <button type="button" data-type="all" class="on">Todos</button>
            <button type="button" data-type="recording">Grabación</button>
            <button type="button" data-type="rehearsal">Ensayo</button>
          </div>
        </div>
      </div>
      <div class="home-map">${mapChrome()}</div>
      <p class="form-error" id="list-error" ${error ? "" : "hidden"}>${escapeHtml(error)}</p>
      <div class="cards" id="cards">${studioCards(studios)}</div>
    </section>
  `);
  bindShell();
  bindLeafletMap(studios);
  const q = document.getElementById("q");
  const seg = document.getElementById("type-seg");
  let type = "all";
  async function refresh() {
    const params = new URLSearchParams();
    if (q.value.trim()) params.set("q", q.value.trim());
    if (type !== "all") params.set("type", type);
    const errEl = document.getElementById("list-error");
    try {
      const data = await api(`/api/studios?${params}`, { auth: false });
      document.getElementById("cards").innerHTML = studioCards(data.studios || []);
      errEl.hidden = true;
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = err.message;
    }
  }
  q.addEventListener("input", () => refresh());
  seg.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    type = btn.dataset.type;
    seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
    refresh();
  });
}

function studioCards(studios) {
  if (!studios.length) {
    return `<p class="muted">No hay estudios todavía. Arranca también el backend para ver salas de ejemplo.</p>`;
  }
  return studios
    .map(
      (s) => `
      <a href="/studio/${escapeHtml(s.id)}" class="card" data-link>
        <div class="card-photo" style="background-image:url('${escapeHtml(fileUrl(s.photos?.[0]))}')"></div>
        <div class="card-body">
          <div class="card-meta"><span>${escapeHtml(s.city)}</span><span>★ ${escapeHtml(s.rating)}</span></div>
          <h3>${escapeHtml(s.name)}</h3>
          <p>${s.type === "rehearsal" ? "Ensayo" : "Grabación"} · ${escapeHtml(s.price_per_hour)} ${escapeHtml(s.currency)}/h</p>
        </div>
      </a>`
    )
    .join("");
}

async function renderStudio(id) {
  root.innerHTML = shell(`<section class="page"><p class="muted">Cargando estudio…</p></section>`);
  bindShell();
  let studio;
  try {
    studio = await api(`/api/studios/${id}`, { auth: false });
  } catch (err) {
    root.innerHTML = shell(`<section class="page"><p class="form-error">${escapeHtml(err.message)}</p></section>`);
    bindShell();
    return;
  }
  const date = new Date().toISOString().slice(0, 10);
  root.innerHTML = shell(`
    <section class="page studio-page">
      <div class="hero-photo" style="background-image:url('${escapeHtml(fileUrl(studio.photos?.[0]))}')"></div>
      <div class="studio-layout">
        <div>
          <p class="kicker">${escapeHtml(studio.city)} · ${escapeHtml(studio.country)}</p>
          <h2>${escapeHtml(studio.name)}</h2>
          <p class="lede tight">${escapeHtml(studio.description)}</p>
          <ul class="chips">${(studio.equipment || []).map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
        </div>
        <aside class="book-box">
          <p class="price">${escapeHtml(studio.price_per_hour)} ${escapeHtml(studio.currency)}<span>/hora</span></p>
          <label>Fecha<input type="date" id="bk-date" value="${date}" min="${date}" /></label>
          <label>Hora de inicio<select id="bk-hour"></select></label>
          <label>Horas<input type="number" id="bk-hours" min="1" max="8" value="1" /></label>
          <p class="form-error" id="bk-error" hidden></p>
          <button type="button" class="primary-btn" id="bk-btn">Reservar y pagar en el estudio</button>
        </aside>
      </div>
    </section>
  `);
  bindShell();
  const hourSel = document.getElementById("bk-hour");
  const dateInput = document.getElementById("bk-date");
  async function loadHours() {
    const avail = await api(`/api/studios/${id}/availability?date=${dateInput.value}`, { auth: false });
    const booked = new Set(avail.booked_hours || []);
    hourSel.innerHTML = "";
    for (let h = avail.open_hour; h < avail.close_hour; h += 1) {
      const opt = document.createElement("option");
      opt.value = h;
      opt.textContent = `${String(h).padStart(2, "0")}:00${booked.has(h) ? " (ocupada)" : ""}`;
      opt.disabled = booked.has(h);
      hourSel.appendChild(opt);
    }
  }
  dateInput.addEventListener("change", loadHours);
  await loadHours();
  document.getElementById("bk-btn").addEventListener("click", async () => {
    const errEl = document.getElementById("bk-error");
    try {
      await api("/api/bookings", {
        method: "POST",
        body: {
          studio_id: id,
          date: dateInput.value,
          start_hour: Number(hourSel.value),
          hours: Number(document.getElementById("bk-hours").value),
          payment_method: "pay_at_studio",
        },
      });
      go("/reservas");
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = err.message;
    }
  });
}

async function renderBookings() {
  root.innerHTML = shell(`<section class="page"><h2>Tus reservas</h2><p class="muted">Cargando…</p></section>`);
  bindShell();
  let bookings = [];
  let error = "";
  try {
    const data = await api("/api/bookings");
    bookings = data.bookings || [];
  } catch (err) {
    error = err.message;
  }
  root.innerHTML = shell(`
    <section class="page">
      <h2>Tus reservas</h2>
      <p class="form-error" ${error ? "" : "hidden"}>${escapeHtml(error)}</p>
      <div class="booking-list">
        ${
          bookings.length
            ? bookings
                .map(
                  (b) => `
            <article class="booking">
              <div class="booking-photo" style="background-image:url('${escapeHtml(fileUrl(b.studio_photo))}')"></div>
              <div>
                <h3>${escapeHtml(b.studio_name)}</h3>
                <p>${escapeHtml(b.date)} · ${String(b.start_hour).padStart(2, "0")}:00 · ${escapeHtml(b.hours)}h · ${escapeHtml(b.total_price)} ${escapeHtml(b.currency)}</p>
                <p class="muted">${b.status === "cancelled" ? "Cancelada" : "Confirmada"} · pago ${escapeHtml(b.payment_status)}</p>
              </div>
              ${b.status !== "cancelled" ? `<button type="button" class="text-btn" data-cancel="${escapeHtml(b.id)}">Cancelar</button>` : ""}
            </article>`
                )
                .join("")
            : `<p class="muted">Aún no tienes reservas.</p>`
        }
      </div>
    </section>
  `);
  bindShell();
  root.querySelectorAll("[data-cancel]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/bookings/${btn.dataset.cancel}/cancel`, { method: "POST" });
      renderBookings();
    });
  });
}

function bindShell() {
  root.querySelectorAll("[data-link]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      go(a.getAttribute("href"));
    });
  });
  document.getElementById("logout")?.addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      setToken(null);
      state.user = null;
      go("/login");
    }
  });
}

function bindLogin() {
  let mode = "login";
  const form = document.getElementById("auth-form");
  const nameLabel = form.querySelector("label");
  nameLabel.hidden = true;
  document.getElementById("google-btn").addEventListener("click", startGoogleLogin);
  async function demoLogin(email, password, dest) {
    const errEl = document.getElementById("auth-error");
    try {
      const res = await api("/api/auth/login", {
        method: "POST",
        body: { email, password },
        auth: false,
      });
      setToken(res.session_token);
      state.user = res.user;
      go(dest);
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = err.message;
    }
  }
  document.getElementById("user-login").addEventListener("click", () => {
    demoLogin("user@studiosync.app", "user123", "/");
  });
  document.getElementById("toggle-mode").addEventListener("click", (e) => {
    mode = mode === "login" ? "register" : "login";
    nameLabel.hidden = mode === "login";
    e.target.textContent =
      mode === "login" ? "¿No tienes cuenta? Regístrate" : "¿Ya tienes cuenta? Inicia sesión";
    form.querySelector(".primary-btn").textContent = mode === "login" ? "Entrar" : "Crear cuenta";
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = document.getElementById("auth-error");
    const data = Object.fromEntries(new FormData(form));
    try {
      const path = mode === "register" ? "/api/auth/register" : "/api/auth/login";
      const body =
        mode === "register"
          ? { name: data.name, email: data.email, password: data.password }
          : { email: data.email, password: data.password };
      const res = await api(path, { method: "POST", body, auth: false });
      setToken(res.session_token);
      state.user = res.user;
      go("/");
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = err.message;
    }
  });
}

function starsLabel(studio) {
  const value = Number(studio.rating ?? 5);
  const shown = studio.name === "Sonic Vault Studios" ? "5.0" : value.toFixed(1);
  return `★ ${shown}`;
}

function priceLabel(studio) {
  const symbol = studio.currency === "GBP" ? "£" : "€";
  return `${symbol}${Math.round(Number(studio.price_per_hour))}/h`;
}

function matchesStudio(studio, q, type) {
  if (type !== "all" && studio.type !== type) return false;
  const query = q.trim().toLowerCase();
  if (!query) return true;
  const blob = [studio.name, ...(studio.equipment || [])].join(" ").toLowerCase();
  return blob.includes(query);
}

function selectedCardHtml(studio) {
  if (!studio) {
    return `<article class="map-studio-card empty"><p class="muted">Toca un precio en el mapa</p></article>`;
  }
  return `
    <article class="map-studio-card">
      <div class="map-studio-photo" style="background-image:url('${escapeHtml(fileUrl(studio.photos?.[0]))}')"></div>
      <div class="map-studio-copy">
        <h3>${escapeHtml(studio.name)}</h3>
        <p class="map-stars">${starsLabel(studio)}</p>
      </div>
      <a class="primary-btn map-book" href="/studio/${escapeHtml(studio.id)}" data-link>Reservar</a>
    </article>
  `;
}

let leafletMap = null;
let leafletMarkers = [];

function teardownMap() {
  leafletMarkers = [];
  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
  }
}

async function bindLeafletMap(studios) {
  const Lref = window.L;
  const canvas = document.getElementById("map-canvas");
  const selectedWrap = document.getElementById("map-selected");
  if (!canvas) return;
  if (!Lref) {
    if (selectedWrap) {
      selectedWrap.innerHTML =
        `<article class="map-studio-card empty"><p class="form-error">No se pudo cargar el mapa</p></article>`;
    }
    return;
  }
  teardownMap();
  leafletMap = Lref.map("map-canvas", {
    zoomControl: false,
    attributionControl: true,
  }).setView([40.4168, -3.7038], 12);
  Lref.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap",
    maxZoom: 19,
  }).addTo(leafletMap);
  Lref.control.zoom({ position: "topright" }).addTo(leafletMap);

  let type = "all";
  let selectedId = studios.find((s) => s.name === "Sonic Vault Studios")?.id || studios[0]?.id;
  const q = document.getElementById("map-q");
  const chips = document.getElementById("map-chips");

  function visibleStudios() {
    return studios.filter((s) => matchesStudio(s, q?.value || "", type));
  }

  function paintCard() {
    if (!selectedWrap) return;
    const studio = studios.find((s) => s.id === selectedId) || visibleStudios()[0] || null;
    if (studio) selectedId = studio.id;
    selectedWrap.innerHTML = selectedCardHtml(studio);
    selectedWrap.querySelectorAll("[data-link]").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        teardownMap();
        go(a.getAttribute("href"));
      });
    });
  }

  function drawMarkers() {
    leafletMarkers.forEach((m) => m.remove());
    leafletMarkers = [];
    const visible = visibleStudios();
    if (selectedId && !visible.some((s) => s.id === selectedId)) selectedId = visible[0]?.id;
    visible.forEach((studio) => {
      if (studio.lat == null || studio.lng == null) return;
      const on = studio.id === selectedId;
      const icon = Lref.divIcon({
        className: "price-pin-wrap",
        html: `<button type="button" class="price-pin${on ? " on" : ""}">${escapeHtml(priceLabel(studio))}</button>`,
        iconSize: [86, 38],
        iconAnchor: [43, 38],
      });
      const marker = Lref.marker([studio.lat, studio.lng], { icon, keyboard: true }).addTo(leafletMap);
      marker.on("click", () => {
        selectedId = studio.id;
        drawMarkers();
        leafletMap.panTo([studio.lat, studio.lng]);
      });
      leafletMarkers.push(marker);
    });
    paintCard();
    const selected = visible.find((s) => s.id === selectedId);
    if (selected) leafletMap.panTo([selected.lat, selected.lng]);
  }

  q?.addEventListener("input", drawMarkers);
  chips?.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    type = btn.dataset.type;
    chips.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
    drawMarkers();
  });
  drawMarkers();
  const first = studios.find((s) => s.id === selectedId);
  if (first) leafletMap.setView([first.lat, first.lng], 13);
  setTimeout(() => leafletMap.invalidateSize(), 80);
}

function mapChrome() {
  return `
      <div id="map-canvas" role="application" aria-label="Mapa de estudios"></div>
      <div class="map-float">
        <input id="map-q" type="search" placeholder="Buscar por nombre o equipo..." />
        <div class="map-chips" id="map-chips">
          <button type="button" data-type="all" class="on">Todos</button>
          <button type="button" data-type="recording">Grabación</button>
          <button type="button" data-type="rehearsal">Ensayo</button>
        </div>
      </div>
      <div id="map-selected">${selectedCardHtml(null)}</div>`;
}

async function renderMap() {
  root.innerHTML = shell(`<section class="map-screen">${mapChrome()}</section>`, { map: true });
  bindShell();
  let studios = [];
  try {
    studios = (await api("/api/studios", { auth: false })).studios || [];
  } catch {
    studios = [];
  }
  await bindLeafletMap(studios);
}

async function render() {
  if (!["/", "/mapa"].includes(pathOf())) teardownMap();
  if (!state.ready) {
    root.innerHTML = bootScreen();
    return;
  }
  const path = pathOf();
  if (!state.user) {
    if (path !== "/login") {
      window.history.replaceState({}, "", "/login");
    }
    root.innerHTML = loginView();
    bindLogin();
    return;
  }
  if (path === "/login") {
    window.history.replaceState({}, "", "/");
  }
  const studioMatch = pathOf().match(/^\/studio\/(.+)$/);
  if (pathOf() === "/reservas") return renderBookings();
  if (pathOf() === "/admin") return renderAdmin();
  if (pathOf() === "/mapa") return renderMap();
  if (pathOf() === "/perfil") return renderProfile();
  if (pathOf() === "/contacto") return renderContact();
  if (studioMatch) return renderStudio(studioMatch[1]);
  return renderExplore();
}

async function renderAdmin() {
  if (!state.user?.is_admin) {
    root.innerHTML = shell(`<section class="page"><p class="form-error">Solo administradores</p></section>`);
    bindShell();
    return;
  }
  root.innerHTML = shell(`<section class="page"><h2>Verificación de estudios</h2><p class="muted">Cargando…</p></section>`);
  bindShell();
  let studios = [];
  let error = "";
  try {
    const data = await api("/api/admin/studios/pending");
    studios = data.studios || [];
  } catch (err) {
    error = err.message;
  }
  root.innerHTML = shell(`
    <section class="page">
      <p class="kicker">Panel</p>
      <h2>Verificación de estudios</h2>
      <p class="muted">Sesión de ${escapeHtml(state.user.email)}</p>
      <p class="form-error" ${error ? "" : "hidden"}>${escapeHtml(error)}</p>
      <div class="booking-list">
        ${
          studios.length
            ? studios
                .map(
                  (s) => `
            <article class="booking">
              <div class="booking-photo" style="background-image:url('${escapeHtml(fileUrl(s.photos?.[0]))}')"></div>
              <div>
                <h3>${escapeHtml(s.name)}</h3>
                <p>${escapeHtml(s.city)} · ${escapeHtml(s.owner_name || "")}</p>
                <p class="muted">${escapeHtml(s.verification_status)}</p>
              </div>
              <div>
                <button type="button" class="primary-btn" data-approve="${escapeHtml(s.id)}">Aprobar</button>
                <button type="button" class="text-btn" data-reject="${escapeHtml(s.id)}">Rechazar</button>
              </div>
            </article>`
                )
                .join("")
            : `<p class="muted">No hay estudios pendientes. Los de ejemplo ya están verificados.</p>`
        }
      </div>
    </section>
  `);
  bindShell();
  root.querySelectorAll("[data-approve]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/admin/studios/${btn.dataset.approve}/verify?approve=true`, { method: "POST" });
      renderAdmin();
    });
  });
  root.querySelectorAll("[data-reject]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/admin/studios/${btn.dataset.reject}/verify?approve=false`, { method: "POST" });
      renderAdmin();
    });
  });
}

async function boot() {
  root.innerHTML = bootScreen();
  try {
    const sessionId = consumeSessionId();
    if (sessionId) {
      const data = await api("/api/auth/session", {
        method: "POST",
        body: { session_id: sessionId },
        auth: false,
      });
      setToken(data.session_token);
      state.user = data.user;
    } else if (getToken()) {
      const me = await api("/api/auth/me");
      state.user = me.user;
    }
  } catch {
    setToken(null);
    state.user = null;
  } finally {
    state.ready = true;
    render();
  }
}

boot();
