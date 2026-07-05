// server.js
// מערכת ניהול עמדה חמה - Hot-Desk Booking Application
// Plain Node.js + Express backend. Serves a static vanilla-JS frontend
// and owns all business logic + the private users file.

const express = require("express");
const fs = require("fs/promises");
const path = require("path");

const app = express();
app.use(express.json());

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const BOOKINGS_FILE = path.join(DATA_DIR, "bookings.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");

// -----------------------------------------------------------------------
// Simple in-memory write queue per file, to prevent race conditions when
// two requests try to read-modify-write the same JSON file at once.
// -----------------------------------------------------------------------
const queues = new Map();
function serialize(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(
    key,
    next.catch(() => {})
  );
  return next;
}

async function readJSON(file, fallback) {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

async function writeJSON(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

// -----------------------------------------------------------------------
// Bootstrap: make sure data files exist on first run.
// This is what lets a fresh `git clone` + Railway deploy come up alive
// even though the real data files are gitignored.
// -----------------------------------------------------------------------
async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const usersExists = await fs
    .access(USERS_FILE)
    .then(() => true)
    .catch(() => false);

  if (!usersExists) {
    const adminCode =
      process.env.ADMIN_CODE ||
      Math.random().toString(36).slice(2, 8).toUpperCase();
    const seedUsers = [
      { name: process.env.ADMIN_NAME || "גבריאל", code: adminCode, role: "admin" },
    ];
    await writeJSON(USERS_FILE, seedUsers);
    console.log("=".repeat(60));
    console.log("No data/users.json found - created a fresh one.");
    console.log(`Admin name: ${seedUsers[0].name}`);
    console.log(`Admin code: ${adminCode}`);
    console.log("Save this code! Log in as admin and add your users.");
    console.log("(Set ADMIN_CODE env var to control this on next deploy.)");
    console.log("=".repeat(60));
  }

  const bookingsExists = await fs
    .access(BOOKINGS_FILE)
    .then(() => true)
    .catch(() => false);
  if (!bookingsExists) await writeJSON(BOOKINGS_FILE, []);

  const configExists = await fs
    .access(CONFIG_FILE)
    .then(() => true)
    .catch(() => false);
  if (!configExists) await writeJSON(CONFIG_FILE, { permanentDay: 1 }); // 1 = Monday
}

// -----------------------------------------------------------------------
// Date / window logic
// Work week shown: Sunday(0) - Thursday(4). Friday/Saturday excluded.
// A fresh 2-week window "opens" every Thursday: the window always runs
// from the Sunday right after the most recent Thursday through the
// Thursday exactly two weeks after that same anchor Thursday.
// -----------------------------------------------------------------------
function toDateOnly(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fmt(d) {
  const x = toDateOnly(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getMostRecentThursday(today) {
  const t = toDateOnly(today);
  const day = t.getDay(); // 0=Sun..6=Sat, Thursday=4
  const diff = (day - 4 + 7) % 7;
  const thursday = new Date(t);
  thursday.setDate(t.getDate() - diff);
  return thursday;
}

function getWindowDates(today = new Date()) {
  const anchorThursday = getMostRecentThursday(today);
  const windowEnd = new Date(anchorThursday);
  windowEnd.setDate(anchorThursday.getDate() + 14); // Thursday, 2 weeks later

  const dates = [];
  const cursor = new Date(anchorThursday);
  cursor.setDate(cursor.getDate() + 1); // start the day after anchor Thursday
  while (cursor <= windowEnd) {
    const dow = cursor.getDay();
    if (dow >= 0 && dow <= 4) {
      dates.push(fmt(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates; // array of "YYYY-MM-DD" strings, Sun-Thu only
}

const WEEKDAY_HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

function dateInfo(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return { weekday: d.getDay(), weekdayLabel: WEEKDAY_HE[d.getDay()] };
}

// -----------------------------------------------------------------------
// User helpers
// -----------------------------------------------------------------------
async function getUsers() {
  return readJSON(USERS_FILE, []);
}

async function findAuthorizedUser(name, code) {
  const users = await getUsers();
  return (
    users.find(
      (u) => u.name === name && String(u.code) === String(code)
    ) || null
  );
}

async function findAdminByCode(code) {
  const users = await getUsers();
  return users.find((u) => u.role === "admin" && String(u.code) === String(code)) || null;
}

// -----------------------------------------------------------------------
// Public state endpoint - safe to expose (no codes, ever).
// -----------------------------------------------------------------------
app.get("/api/state", async (req, res) => {
  try {
    const [users, bookings, config] = await Promise.all([
      getUsers(),
      readJSON(BOOKINGS_FILE, []),
      readJSON(CONFIG_FILE, { permanentDay: 1 }),
    ]);

    const publicNames = users.map((u) => ({ name: u.name, role: u.role }));
    const adminNames = users.filter((u) => u.role === "admin").map((u) => u.name);
    const windowDates = getWindowDates();

    const window = windowDates.map((date) => {
      const info = dateInfo(date);
      const isAdminDay = info.weekday === config.permanentDay;
      const booking = bookings.find((b) => b.date === date) || null;
      return {
        date,
        weekday: info.weekday,
        weekdayLabel: info.weekdayLabel,
        isAdminDay,
        bookedBy: isAdminDay ? adminNames[0] || null : booking ? booking.name : null,
      };
    });

    res.json({
      publicNames,
      permanentDay: config.permanentDay,
      adminNames,
      window,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "שגיאת שרת" });
  }
});

// -----------------------------------------------------------------------
// Login - just verifies credentials, no session/token (internal tool).
// -----------------------------------------------------------------------
app.post("/api/login", async (req, res) => {
  const { name, code } = req.body || {};
  if (!name || !code) return res.status(400).json({ ok: false, error: "חסרים פרטים" });
  const user = await findAuthorizedUser(name, code);
  if (!user) return res.status(401).json({ ok: false, error: "שם או קוד שגויים" });
  res.json({ ok: true, role: user.role, name: user.name });
});

// -----------------------------------------------------------------------
// Book a day
// -----------------------------------------------------------------------
app.post("/api/book", async (req, res) => {
  const { name, code, date } = req.body || {};
  if (!name || !code || !date) {
    return res.status(400).json({ ok: false, error: "חסרים פרטים" });
  }

  try {
    const result = await serialize("bookings", async () => {
      const user = await findAuthorizedUser(name, code);
      if (!user) return { status: 401, body: { ok: false, error: "שם או קוד שגויים" } };

      const windowDates = getWindowDates();
      if (!windowDates.includes(date)) {
        return { status: 400, body: { ok: false, error: "התאריך מחוץ לטווח ההזמנות הפתוח" } };
      }

      const config = await readJSON(CONFIG_FILE, { permanentDay: 1 });
      const info = dateInfo(date);
      const isAdminDay = info.weekday === config.permanentDay;

      if (isAdminDay && user.role !== "admin") {
        return { status: 403, body: { ok: false, error: "יום זה שמור לאדמין" } };
      }

      const bookings = await readJSON(BOOKINGS_FILE, []);

      const existingForDate = bookings.find((b) => b.date === date);
      if (existingForDate) {
        return { status: 409, body: { ok: false, error: "התאריך כבר תפוס" } };
      }

      if (user.role !== "admin") {
        const hasActiveBooking = bookings.some(
          (b) => b.name === user.name && windowDates.includes(b.date)
        );
        if (hasActiveBooking) {
          return {
            status: 409,
            body: { ok: false, error: "כבר יש לך הזמנה פעילה. בטל אותה כדי לבחור יום אחר." },
          };
        }
      }

      bookings.push({ date, name: user.name });
      await writeJSON(BOOKINGS_FILE, bookings);
      return { status: 200, body: { ok: true } };
    });

    res.status(result.status).json(result.body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "שגיאת שרת" });
  }
});

// -----------------------------------------------------------------------
// Cancel a booking
// -----------------------------------------------------------------------
app.post("/api/cancel", async (req, res) => {
  const { name, code, date } = req.body || {};
  if (!name || !code || !date) {
    return res.status(400).json({ ok: false, error: "חסרים פרטים" });
  }

  try {
    const result = await serialize("bookings", async () => {
      const user = await findAuthorizedUser(name, code);
      if (!user) return { status: 401, body: { ok: false, error: "שם או קוד שגויים" } };

      const bookings = await readJSON(BOOKINGS_FILE, []);
      const idx = bookings.findIndex((b) => b.date === date);
      if (idx === -1) {
        return { status: 404, body: { ok: false, error: "לא נמצאה הזמנה" } };
      }

      const booking = bookings[idx];
      if (booking.name !== user.name && user.role !== "admin") {
        return { status: 403, body: { ok: false, error: "אין הרשאה לבטל הזמנה זו" } };
      }

      bookings.splice(idx, 1);
      await writeJSON(BOOKINGS_FILE, bookings);
      return { status: 200, body: { ok: true } };
    });

    res.status(result.status).json(result.body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "שגיאת שרת" });
  }
});

// -----------------------------------------------------------------------
// Admin-only endpoints. All require adminCode matched against the
// private users.json file. This file is NEVER served statically and
// full contents (incl. codes) are only ever returned here, to an
// already-verified admin.
// -----------------------------------------------------------------------
app.post("/api/admin/users/list", async (req, res) => {
  const { adminCode } = req.body || {};
  const admin = await findAdminByCode(adminCode);
  if (!admin) return res.status(403).json({ ok: false, error: "קוד אדמין שגוי" });
  const users = await getUsers();
  res.json({ ok: true, users });
});

app.post("/api/admin/users/add", async (req, res) => {
  const { adminCode, name, code } = req.body || {};
  if (!name || !code) return res.status(400).json({ ok: false, error: "חסרים פרטים" });

  try {
    const result = await serialize("users", async () => {
      const admin = await findAdminByCode(adminCode);
      if (!admin) return { status: 403, body: { ok: false, error: "קוד אדמין שגוי" } };

      const users = await getUsers();
      if (users.some((u) => u.name === name)) {
        return { status: 409, body: { ok: false, error: "משתמש עם שם זה כבר קיים" } };
      }
      users.push({ name, code: String(code), role: "user" });
      await writeJSON(USERS_FILE, users);
      return { status: 200, body: { ok: true, users } };
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "שגיאת שרת" });
  }
});

app.post("/api/admin/users/remove", async (req, res) => {
  const { adminCode, name } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: "חסר שם" });

  try {
    const result = await serialize("users", async () => {
      const admin = await findAdminByCode(adminCode);
      if (!admin) return { status: 403, body: { ok: false, error: "קוד אדמין שגוי" } };

      const users = await getUsers();
      const target = users.find((u) => u.name === name);
      if (!target) return { status: 404, body: { ok: false, error: "משתמש לא נמצא" } };
      if (target.role === "admin") {
        return { status: 400, body: { ok: false, error: "לא ניתן להסיר אדמין" } };
      }
      const updated = users.filter((u) => u.name !== name);
      await writeJSON(USERS_FILE, updated);

      // cascade: remove this user's active bookings too
      await serialize("bookings", async () => {
        const bookings = await readJSON(BOOKINGS_FILE, []);
        const filtered = bookings.filter((b) => b.name !== name);
        await writeJSON(BOOKINGS_FILE, filtered);
      });

      return { status: 200, body: { ok: true, users: updated } };
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "שגיאת שרת" });
  }
});

app.post("/api/admin/permanent-day", async (req, res) => {
  const { adminCode, day } = req.body || {};
  const dayNum = Number(day);
  if (Number.isNaN(dayNum) || dayNum < 0 || dayNum > 4) {
    return res.status(400).json({ ok: false, error: "יום לא תקין" });
  }
  const admin = await findAdminByCode(adminCode);
  if (!admin) return res.status(403).json({ ok: false, error: "קוד אדמין שגוי" });

  await writeJSON(CONFIG_FILE, { permanentDay: dayNum });
  res.json({ ok: true, permanentDay: dayNum });
});

// -----------------------------------------------------------------------
// Static frontend
// -----------------------------------------------------------------------
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
ensureDataFiles().then(() => {
  app.listen(PORT, () => {
    console.log(`Hot-desk app running on port ${PORT}`);
  });
});
