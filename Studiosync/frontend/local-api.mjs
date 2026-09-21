import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ADMIN_EMAIL = "test@studiosync.app";
const ADMIN_PASSWORD = "test123";
const USER_EMAIL = "user@studiosync.app";
const USER_PASSWORD = "user123";
const SERVICE_FEE = 0.99;

const SEED_STUDIOS = [
  { name: "Sonic Vault Studios", type: "recording", city: "Madrid", country: "Spain", address: "Calle de la Cabeza 12", lat: 40.4114, lng: -3.7038, price_per_hour: 45, rating: 4.9, review_count: 128, equipment: ["SSL Console", "Neumann U87", "Pro Tools", "Vintage Preamps"], photos: ["https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200"], description: "Sala de grabación premium en el centro de Madrid con consola analógica y cabina aislada." },
  { name: "La Cueva Rehearsal", type: "rehearsal", city: "Madrid", country: "Spain", address: "Calle de Embajadores 45", lat: 40.4055, lng: -3.7025, price_per_hour: 18, rating: 4.6, review_count: 87, equipment: ["Backline", "Batería Pearl", "PA System", "Amplis Marshall"], photos: ["https://images.pexels.com/photos/8197342/pexels-photo-8197342.jpeg?auto=compress&cs=tinysrgb&w=1200"], description: "Local de ensayo insonorizado con backline completo. Ideal para bandas." },
  { name: "Retiro Sound Lab", type: "recording", city: "Madrid", country: "Spain", address: "Av. Menéndez Pelayo 3", lat: 40.4189, lng: -3.6836, price_per_hour: 60, rating: 4.8, review_count: 64, equipment: ["API 1608", "Analog Tape", "Mac Studio", "Genelec Monitors"], photos: ["https://images.pexels.com/photos/8197364/pexels-photo-8197364.jpeg?auto=compress&cs=tinysrgb&w=1200"], description: "Estudio boutique junto al Retiro con cinta analógica y monitores Genelec." },
  { name: "Gràcia Records", type: "recording", city: "Barcelona", country: "Spain", address: "Carrer de Verdi 20", lat: 41.4036, lng: 2.1580, price_per_hour: 50, rating: 4.7, review_count: 92, equipment: ["Neve 1073", "Logic Pro", "Adam Monitors"], photos: ["https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200"], description: "Estudio con vibra creativa en Gràcia. Preamps Neve y control acústico." },
  { name: "Poblenou Jam Room", type: "rehearsal", city: "Barcelona", country: "Spain", address: "Carrer de Pujades 100", lat: 41.4008, lng: 2.1990, price_per_hour: 15, rating: 4.5, review_count: 56, equipment: ["Batería", "Amplis", "Micros", "PA"], photos: ["https://images.pexels.com/photos/8197342/pexels-photo-8197342.jpeg?auto=compress&cs=tinysrgb&w=1200"], description: "Sala de ensayo económica y espaciosa en Poblenou." },
  { name: "Kreuzberg Klang", type: "recording", city: "Berlin", country: "Germany", address: "Oranienstraße 40", lat: 52.5010, lng: 13.4180, price_per_hour: 55, rating: 4.9, review_count: 143, equipment: ["SSL", "Modular Synths", "Ableton", "Analog Outboard"], photos: ["https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200"], description: "Techno & electronic focused studio in the heart of Kreuzberg." },
  { name: "Camden Live Rooms", type: "rehearsal", city: "London", country: "United Kingdom", address: "Chalk Farm Rd 22", lat: 51.5416, lng: -0.1465, price_per_hour: 22, rating: 4.6, review_count: 78, equipment: ["Full Backline", "Drum Kit", "PA System"], photos: ["https://images.pexels.com/photos/8197342/pexels-photo-8197342.jpeg?auto=compress&cs=tinysrgb&w=1200"], description: "Iconic rehearsal rooms in Camden with full backline." },
  { name: "Marais Analog", type: "recording", city: "Paris", country: "France", address: "Rue de Bretagne 15", lat: 48.8632, lng: 2.3620, price_per_hour: 65, rating: 4.8, review_count: 51, equipment: ["Vintage Neve", "Tape Machine", "Grand Piano"], photos: ["https://images.pexels.com/photos/8197364/pexels-photo-8197364.jpeg?auto=compress&cs=tinysrgb&w=1200"], description: "Analog paradise in Le Marais with a grand piano and tape machine." },
];

export function createLocalApi(dataFile) {
  let db = load(dataFile);
  if (!db.users.length) {
    db = seed(db);
  }
  const seeded = ensureDemoUsers(db) | ensureStaffAndActivity(db);
  if (seeded) save(dataFile, db);

  function persist() {
    save(dataFile, db);
  }

  function publicUser(user) {
    return {
      user_id: user.user_id,
      email: user.email,
      name: user.name,
      picture: user.picture || null,
      is_owner: !!user.is_owner,
      is_admin: !!user.is_admin || user.email === ADMIN_EMAIL,
      email_verified: !!user.email_verified,
      payout_configured: !!user.payout_configured,
      favorites: user.favorites || 0,
    };
  }

  function tokenOf(req) {
    const h = req.headers.authorization || "";
    if (!h.startsWith("Bearer ")) return null;
    return h.slice(7).trim();
  }

  function userFrom(req) {
    const token = tokenOf(req);
    if (!token) return null;
    const session = db.sessions.find((s) => s.session_token === token);
    if (!session) return null;
    return db.users.find((u) => u.user_id === session.user_id) || null;
  }

  function sessionFor(user) {
    const session_token = crypto.randomBytes(24).toString("hex");
    db.sessions.push({ session_token, user_id: user.user_id });
    persist();
    return { session_token, user: publicUser(user) };
  }

  return async function handle(req, url, body) {
    const p = url.pathname;
    const method = req.method.toUpperCase();

    if (method === "GET" && p === "/api/") {
      return json(200, { message: "StudioSync API" });
    }

    if (method === "POST" && p === "/api/auth/login") {
      const email = String(body.email || "").toLowerCase();
      const user = db.users.find((u) => u.email === email && u.password === body.password);
      if (!user) return json(401, { detail: "Invalid credentials" });
      return json(200, sessionFor(user));
    }

    if (method === "POST" && p === "/api/auth/register") {
      const email = String(body.email || "").toLowerCase();
      if (db.users.some((u) => u.email === email)) return json(400, { detail: "Email already registered" });
      const user = {
        user_id: `user_${crypto.randomBytes(6).toString("hex")}`,
        email,
        name: body.name || email.split("@")[0],
        password: body.password,
        is_owner: false,
        is_admin: email === ADMIN_EMAIL,
        email_verified: false,
        picture: null,
      };
      db.users.push(user);
      persist();
      return json(200, sessionFor(user));
    }

    if (method === "GET" && p === "/api/auth/me") {
      const user = userFrom(req);
      if (!user) return json(401, { detail: "Not authenticated" });
      return json(200, { user: publicUser(user) });
    }

    if (method === "POST" && p === "/api/auth/logout") {
      const token = tokenOf(req);
      db.sessions = db.sessions.filter((s) => s.session_token !== token);
      persist();
      return json(200, { ok: true });
    }

    if (method === "GET" && p === "/api/studios") {
      const q = (url.searchParams.get("q") || "").toLowerCase();
      const type = url.searchParams.get("type");
      let items = db.studios.filter((s) => !s.deleted_at && s.verified);
      if (type && type !== "all") items = items.filter((s) => s.type === type);
      if (q) {
        items = items.filter((s) =>
          [s.name, s.city, s.description].join(" ").toLowerCase().includes(q)
        );
      }
      return json(200, { studios: items });
    }

    if (method === "GET" && p === "/api/studios/mine") {
      const user = userFrom(req);
      if (!user) return json(401, { detail: "Not authenticated" });
      return json(200, { studios: db.studios.filter((s) => s.owner_id === user.user_id && !s.deleted_at) });
    }

    const studioGet = p.match(/^\/api\/studios\/([^/]+)$/);
    if (method === "GET" && studioGet) {
      const studio = db.studios.find((s) => s.id === studioGet[1] && !s.deleted_at);
      if (!studio) return json(404, { detail: "Studio not found" });
      return json(200, studio);
    }

    const avail = p.match(/^\/api\/studios\/([^/]+)\/availability$/);
    if (method === "GET" && avail) {
      const studio = db.studios.find((s) => s.id === avail[1] && !s.deleted_at);
      if (!studio) return json(404, { detail: "Studio not found" });
      const date = url.searchParams.get("date");
      const booked = db.bookings
        .filter((b) => b.studio_id === studio.id && b.date === date && b.status === "confirmed")
        .flatMap((b) => Array.from({ length: b.hours }, (_, i) => b.start_hour + i));
      return json(200, {
        date,
        open_hour: studio.open_hour || 8,
        close_hour: studio.close_hour || 24,
        booked_hours: [...new Set(booked)].sort((a, b) => a - b),
      });
    }

    if (method === "POST" && p === "/api/studios") {
      const user = userFrom(req);
      if (!user) return json(401, { detail: "Not authenticated" });
      const studio = {
        ...body,
        id: `studio_${crypto.randomBytes(6).toString("hex")}`,
        owner_id: user.user_id,
        owner_name: user.name,
        rating: 0,
        review_count: 0,
        verified: false,
        verification_status: "pending",
        deleted_at: null,
        open_hour: body.open_hour ?? 8,
        close_hour: body.close_hour ?? 24,
      };
      db.studios.push(studio);
      persist();
      return json(200, studio);
    }

    if (method === "POST" && p === "/api/bookings") {
      const user = userFrom(req);
      if (!user) return json(401, { detail: "Not authenticated" });
      const studio = db.studios.find((s) => s.id === body.studio_id && !s.deleted_at);
      if (!studio) return json(404, { detail: "Studio not found" });
      const hours = Number(body.hours || 1);
      const staff = (studio.staff || []).find((p) => p.id === body.staff_id) || null;
      const room = round(studio.price_per_hour * hours);
      const staff_extra = staff ? round(Number(staff.extra_per_hour) * hours) : 0;
      const service_fee = SERVICE_FEE;
      const method = body.payment_method === "card" ? "card" : "pay_at_studio";
      const booking = {
        id: `bk_${crypto.randomBytes(6).toString("hex")}`,
        studio_id: studio.id,
        studio_name: studio.name,
        studio_city: studio.city,
        studio_photo: studio.photos?.[0] || null,
        user_id: user.user_id,
        date: body.date,
        start_hour: Number(body.start_hour),
        hours,
        subtotal: round(room + staff_extra),
        room_price: room,
        staff_extra,
        staff_id: staff?.id || null,
        staff_name: staff?.name || null,
        staff_role: staff?.role || null,
        service_fee,
        total_price: round(room + staff_extra + service_fee),
        currency: studio.currency || "EUR",
        payment_method: method,
        payment_status: method === "card" ? "paid" : "onsite",
        card_last4: method === "card" ? String(body.card_number || "").replace(/\D/g, "").slice(-4) : null,
        status: "confirmed",
      };
      db.bookings.push(booking);
      persist();
      return json(200, booking);
    }

    if (method === "GET" && p === "/api/bookings") {
      const user = userFrom(req);
      if (!user) return json(401, { detail: "Not authenticated" });
      return json(200, { bookings: db.bookings.filter((b) => b.user_id === user.user_id).reverse() });
    }

    const cancel = p.match(/^\/api\/bookings\/([^/]+)\/cancel$/);
    if (method === "POST" && cancel) {
      const user = userFrom(req);
      if (!user) return json(401, { detail: "Not authenticated" });
      const booking = db.bookings.find((b) => b.id === cancel[1] && b.user_id === user.user_id);
      if (!booking) return json(404, { detail: "Booking not found" });
      booking.status = "cancelled";
      persist();
      return json(200, { ok: true });
    }

    if (method === "POST" && p === "/api/me/payout") {
      const user = userFrom(req);
      if (!user) return json(401, { detail: "Not authenticated" });
      if (!user.is_owner && !publicUser(user).is_admin) return json(403, { detail: "Solo dueños" });
      user.payout_configured = true;
      user.payout_method = body.method || "bank";
      persist();
      return json(200, { user: publicUser(user) });
    }

    const addStaff = p.match(/^\/api\/studios\/([^/]+)\/staff$/);
    if (method === "POST" && addStaff) {
      const user = userFrom(req);
      if (!user) return json(401, { detail: "Not authenticated" });
      const studio = db.studios.find((s) => s.id === addStaff[1] && !s.deleted_at);
      if (!studio) return json(404, { detail: "Studio not found" });
      if (studio.owner_id !== user.user_id && !publicUser(user).is_admin) {
        return json(403, { detail: "Not your studio" });
      }
      studio.staff = studio.staff || [];
      const person = {
        id: `pro_${crypto.randomBytes(4).toString("hex")}`,
        name: body.name,
        role: body.role === "productor" ? "productor" : "ingeniero",
        photo: body.photo || "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400",
        extra_per_hour: Number(body.extra_per_hour || 25),
      };
      studio.staff.push(person);
      persist();
      return json(200, person);
    }

    if (method === "GET" && p === "/api/admin/studios/pending") {
      const user = userFrom(req);
      if (!user) return json(401, { detail: "Not authenticated" });
      if (!publicUser(user).is_admin) return json(403, { detail: "Solo administradores" });
      return json(200, {
        studios: db.studios.filter((s) => s.verification_status === "pending" && !s.deleted_at),
      });
    }

    const verify = p.match(/^\/api\/admin\/studios\/([^/]+)\/verify$/);
    if (method === "POST" && verify) {
      const user = userFrom(req);
      if (!user) return json(401, { detail: "Not authenticated" });
      if (!publicUser(user).is_admin) return json(403, { detail: "Solo administradores" });
      const studio = db.studios.find((s) => s.id === verify[1]);
      if (!studio) return json(404, { detail: "Studio not found" });
      const approve = url.searchParams.get("approve") !== "false";
      studio.verified = approve;
      studio.verification_status = approve ? "approved" : "rejected";
      persist();
      return json(200, { ok: true, verified: approve });
    }

    return json(404, { detail: "Not found" });
  };
}

function json(status, data) {
  return { status, data };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function load(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { users: [], sessions: [], studios: [], bookings: [] };
  }
}

function save(file, db) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(db, null, 2));
}

function seed(db) {
  const admin = {
    user_id: "user_admin_studiosync",
    email: ADMIN_EMAIL,
    name: "Admin StudioSync",
    password: ADMIN_PASSWORD,
    is_owner: true,
    is_admin: true,
    email_verified: true,
    picture: null,
  };
  const studios = SEED_STUDIOS.map((s, i) => ({
    ...s,
    id: `studio_seed_${i + 1}`,
    owner_id: admin.user_id,
    owner_name: admin.name,
    currency: s.country === "United Kingdom" ? "GBP" : "EUR",
    open_hour: 8,
    close_hour: 24,
    verified: true,
    verification_status: "approved",
    deleted_at: null,
  }));
  return { users: [admin, demoUser()], sessions: [], studios, bookings: [] };
}

function demoUser() {
  return {
    user_id: "user_demo_studiosync",
    email: USER_EMAIL,
    name: "Maya López",
    password: USER_PASSWORD,
    is_owner: false,
    is_admin: false,
    email_verified: true,
    picture: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400",
    favorites: 3,
  };
}

function ensureDemoUsers(db) {
  let changed = false;
  if (!db.users.some((u) => u.email === ADMIN_EMAIL)) {
    db.users.push({
      user_id: "user_admin_studiosync",
      email: ADMIN_EMAIL,
      name: "Admin StudioSync",
      password: ADMIN_PASSWORD,
      is_owner: true,
      is_admin: true,
      email_verified: true,
      picture: null,
    });
    changed = true;
  }
  if (!db.users.some((u) => u.email === USER_EMAIL)) {
    db.users.push(demoUser());
    changed = true;
  }
  return changed;
}

function defaultStaff() {
  return [
    {
      id: "pro_nora",
      name: "Nora Vives",
      role: "ingeniero",
      photo: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400",
      extra_per_hour: 25,
    },
    {
      id: "pro_leo",
      name: "Leo Martins",
      role: "productor",
      photo: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400",
      extra_per_hour: 35,
    },
  ];
}

function ensureStaffAndActivity(db) {
  let changed = false;
  const demo = db.users.find((u) => u.email === USER_EMAIL);
  if (demo && !demo.picture) {
    demo.picture = "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400";
    demo.favorites = 3;
    changed = true;
  }
  for (const studio of db.studios) {
    if (!Array.isArray(studio.staff) || !studio.staff.length) {
      studio.staff = defaultStaff();
      changed = true;
    }
  }
  if (demo && !db.bookings.some((b) => b.user_id === demo.user_id)) {
    const first = db.studios[0];
    const dates = ["2026-09-12", "2026-09-14", "2026-09-18", "2026-09-21"];
    dates.forEach((date, i) => {
      const hours = 3;
      const room = round((first?.price_per_hour || 45) * hours);
      db.bookings.push({
        id: `bk_demo_${i + 1}`,
        studio_id: first?.id,
        studio_name: first?.name || "Sonic Vault Studios",
        studio_city: first?.city || "Madrid",
        studio_photo: first?.photos?.[0] || null,
        user_id: demo.user_id,
        date,
        start_hour: 10 + i,
        hours,
        room_price: room,
        staff_extra: 0,
        subtotal: room,
        service_fee: SERVICE_FEE,
        total_price: round(room + SERVICE_FEE),
        currency: "EUR",
        payment_method: i % 2 ? "card" : "pay_at_studio",
        payment_status: i % 2 ? "paid" : "onsite",
        status: "confirmed",
      });
    });
    changed = true;
  }
  return changed;
}
