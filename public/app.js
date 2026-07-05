// app.js - vanilla JS frontend for the Hot-Desk Booking app

const WEEKDAY_FULL = {
  0: "יום ראשון",
  1: "יום שני",
  2: "יום שלישי",
  3: "יום רביעי",
  4: "יום חמישי",
};

let state = null; // last fetched /api/state
let session = null; // { name, code, role }
let busy = false; // simple lock to prevent double-click race on the client

// ---------------------------------------------------------------------
// Session persistence (per-tab only)
// ---------------------------------------------------------------------
function loadSession() {
  try {
    const raw = sessionStorage.getItem("hotdesk_session");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function saveSession(s) {
  session = s;
  if (s) sessionStorage.setItem("hotdesk_session", JSON.stringify(s));
  else sessionStorage.removeItem("hotdesk_session");
}

// ---------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------
async function api(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function showToast(message, kind = "info") {
  const el = document.getElementById("toast");
  const colors = {
    info: "bg-slate-800",
    error: "bg-rose-600",
    success: "bg-emerald-600",
  };
  el.className = `fixed top-4 left-1/2 -translate-x-1/2 z-50 fade-in text-white px-4 py-2 rounded-lg shadow-lg text-sm font-semibold ${colors[kind]}`;
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add("hidden"), 2800);
}

// ---------------------------------------------------------------------
// Data fetch
// ---------------------------------------------------------------------
async function refreshState() {
  const { ok, data } = await api("/api/state");
  if (ok) state = data;
  return ok;
}

// ---------------------------------------------------------------------
// Login card
// ---------------------------------------------------------------------
function renderLoginCard() {
  const card = document.getElementById("loginCard");
  const names = (state?.publicNames || []).map((u) => u.name);

  card.className = "max-w-sm mx-auto bg-white rounded-2xl shadow p-6 mt-10 fade-in";
  card.innerHTML = `
    <h2 class="text-lg font-bold mb-1">כניסה למערכת</h2>
    <p class="text-sm text-slate-500 mb-4">בחר/י את שמך והזן/י את הקוד האישי</p>
    <label class="block text-sm font-semibold mb-1">שם משתמש</label>
    <select id="loginName" class="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500">
      ${names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("")}
    </select>
    <label class="block text-sm font-semibold mb-1">קוד אישי</label>
    <input id="loginCode" type="password" class="w-full border border-slate-300 rounded-lg px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="הזן קוד" />
    <button id="loginBtn" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-lg transition">כניסה</button>
    <p id="loginError" class="text-rose-600 text-sm mt-2 hidden"></p>
  `;
  card.classList.remove("hidden");

  document.getElementById("loginBtn").addEventListener("click", doLogin);
  document.getElementById("loginCode").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLogin();
  });
}

async function doLogin() {
  const name = document.getElementById("loginName").value;
  const code = document.getElementById("loginCode").value.trim();
  const errEl = document.getElementById("loginError");
  errEl.classList.add("hidden");

  if (!code) {
    errEl.textContent = "יש להזין קוד";
    errEl.classList.remove("hidden");
    return;
  }

  const { ok, data } = await api("/api/login", { name, code });
  if (!ok || !data.ok) {
    errEl.textContent = data.error || "שגיאה בכניסה";
    errEl.classList.remove("hidden");
    return;
  }

  saveSession({ name: data.name, code, role: data.role });
  await boot();
}

function handleLogout() {
  saveSession(null);
  boot();
}

// ---------------------------------------------------------------------
// User box (top-right header area)
// ---------------------------------------------------------------------
function renderUserBox() {
  const box = document.getElementById("userBox");
  if (!session) {
    box.innerHTML = "";
    return;
  }
  const roleLabel = session.role === "admin" ? "אדמין" : "משתמש";
  box.innerHTML = `
    <span class="text-sm text-slate-600">שלום, <b>${escapeHtml(session.name)}</b> <span class="text-xs bg-slate-200 rounded-full px-2 py-0.5">${roleLabel}</span></span>
    <button id="logoutBtn" class="text-sm bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg font-semibold transition">התנתקות</button>
  `;
  document.getElementById("logoutBtn").addEventListener("click", handleLogout);
}

// ---------------------------------------------------------------------
// Main app render
// ---------------------------------------------------------------------
function renderApp() {
  const app = document.getElementById("app");
  if (!session || !state) {
    app.classList.add("hidden");
    return;
  }
  app.classList.remove("hidden");

  const myBooking = state.window.find((d) => d.bookedBy === session.name && !d.isAdminDay);

  app.innerHTML = `
    ${renderDashboard(myBooking)}
    ${session.role === "admin" ? renderAdminPanelShell() : ""}
    ${renderCalendar()}
  `;

  // wire up calendar buttons
  state.window.forEach((d) => {
    const bookBtn = document.getElementById(`book-${d.date}`);
    if (bookBtn) bookBtn.addEventListener("click", () => handleBook(d.date));
    const cancelBtn = document.getElementById(`cancel-${d.date}`);
    if (cancelBtn) cancelBtn.addEventListener("click", () => handleCancel(d.date));
  });

  if (session.role === "admin") wireAdminPanel();
}

function renderDashboard(myBooking) {
  return `
    <div class="bg-white rounded-2xl shadow p-5 fade-in">
      <h2 class="font-bold text-slate-900 mb-2">ההזמנה שלי</h2>
      ${
        myBooking
          ? `<div class="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
               <div>
                 <div class="font-bold text-emerald-800">${WEEKDAY_FULL[myBooking.weekday]}</div>
                 <div class="text-sm text-emerald-700">${myBooking.date}</div>
               </div>
               <button id="cancel-${myBooking.date}" class="bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold px-4 py-2 rounded-lg transition">ביטול</button>
             </div>`
          : `<p class="text-slate-500 text-sm">אין לך הזמנה פעילה כרגע. בחר/י יום פנוי מהלוח למטה.</p>`
      }
    </div>
  `;
}

function renderCalendar() {
  const cards = state.window
    .map((d) => {
      let badge, actions, border;
      if (d.isAdminDay) {
        border = "border-blue-200";
        badge = `<span class="inline-block bg-blue-100 text-blue-700 text-xs font-bold px-2.5 py-1 rounded-full">שמור לאדמין</span>`;
        actions = "";
      } else if (d.bookedBy) {
        const isMine = d.bookedBy === session.name;
        border = "border-rose-200";
        badge = `<span class="inline-block bg-rose-100 text-rose-700 text-xs font-bold px-2.5 py-1 rounded-full">תפוס: ${escapeHtml(d.bookedBy)}</span>`;
        actions = isMine
          ? `<button id="cancel-${d.date}" class="mt-3 w-full bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold py-2 rounded-lg transition">ביטול</button>`
          : `<button disabled class="mt-3 w-full bg-slate-200 text-slate-400 text-sm font-bold py-2 rounded-lg cursor-not-allowed">תפוס</button>`;
      } else {
        const iHaveBooking = state.window.some(
          (x) => x.bookedBy === session.name && !x.isAdminDay
        );
        const disabledForMe = session.role !== "admin" && iHaveBooking;
        border = "border-emerald-200";
        badge = `<span class="inline-block bg-emerald-100 text-emerald-700 text-xs font-bold px-2.5 py-1 rounded-full">פנוי</span>`;
        actions = disabledForMe
          ? `<button disabled class="mt-3 w-full bg-slate-200 text-slate-400 text-sm font-bold py-2 rounded-lg cursor-not-allowed">יש כבר הזמנה פעילה</button>`
          : `<button id="book-${d.date}" class="mt-3 w-full bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold py-2 rounded-lg transition">קביעת תור</button>`;
      }

      return `
        <div class="bg-white rounded-xl shadow-sm border ${border} p-4 flex flex-col justify-between fade-in">
          <div>
            <div class="font-bold text-slate-900">${WEEKDAY_FULL[d.weekday]}</div>
            <div class="text-xs text-slate-500 mb-2">${d.date}</div>
            ${badge}
          </div>
          ${actions}
        </div>
      `;
    })
    .join("");

  return `
    <div class="bg-white rounded-2xl shadow p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="font-bold text-slate-900">לוח הזמנות פתוח (שבועיים קדימה)</h2>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        ${cards}
      </div>
    </div>
  `;
}

function renderAdminPanelShell() {
  return `
    <div id="adminPanel" class="bg-white rounded-2xl shadow p-5 border-2 border-indigo-100 fade-in">
      <h2 class="font-bold text-indigo-900 mb-4 flex items-center gap-2">⚙️ פאנל ניהול</h2>

      <div class="mb-5">
        <label class="block text-sm font-semibold mb-1">יום קבוע לאדמין</label>
        <select id="permanentDaySelect" class="border border-slate-300 rounded-lg px-3 py-2">
          <option value="0">ראשון</option>
          <option value="1">שני</option>
          <option value="2">שלישי</option>
          <option value="3">רביעי</option>
          <option value="4">חמישי</option>
        </select>
      </div>

      <div>
        <label class="block text-sm font-semibold mb-2">ניהול משתמשים מורשים</label>
        <div id="usersList" class="space-y-2 mb-3"></div>
        <div class="flex gap-2">
          <input id="newUserName" placeholder="שם" class="flex-1 border border-slate-300 rounded-lg px-3 py-2" />
          <input id="newUserCode" placeholder="קוד אישי" class="flex-1 border border-slate-300 rounded-lg px-3 py-2" />
          <button id="addUserBtn" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 rounded-lg transition">הוספה</button>
        </div>
      </div>
    </div>
  `;
}

async function wireAdminPanel() {
  const sel = document.getElementById("permanentDaySelect");
  sel.value = String(state.permanentDay);
  sel.addEventListener("change", async () => {
    const { ok, data } = await api("/api/admin/permanent-day", {
      adminCode: session.code,
      day: Number(sel.value),
    });
    if (ok && data.ok) {
      showToast("היום הקבוע עודכן", "success");
      await refreshState();
      renderApp();
    } else {
      showToast(data.error || "שגיאה", "error");
    }
  });

  document.getElementById("addUserBtn").addEventListener("click", async () => {
    const name = document.getElementById("newUserName").value.trim();
    const code = document.getElementById("newUserCode").value.trim();
    if (!name || !code) {
      showToast("יש למלא שם וקוד", "error");
      return;
    }
    const { ok, data } = await api("/api/admin/users/add", {
      adminCode: session.code,
      name,
      code,
    });
    if (ok && data.ok) {
      showToast("המשתמש נוסף", "success");
      await refreshState();
      renderApp();
      await loadUsersList();
    } else {
      showToast(data.error || "שגיאה", "error");
    }
  });

  await loadUsersList();
}

async function loadUsersList() {
  const listEl = document.getElementById("usersList");
  if (!listEl) return;
  const { ok, data } = await api("/api/admin/users/list", { adminCode: session.code });
  if (!ok || !data.ok) {
    listEl.innerHTML = `<p class="text-rose-600 text-sm">שגיאה בטעינת המשתמשים</p>`;
    return;
  }
  listEl.innerHTML = data.users
    .map((u) => {
      const isAdmin = u.role === "admin";
      return `
        <div class="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
          <div class="text-sm">
            <b>${escapeHtml(u.name)}</b>
            <span class="text-slate-400"> · קוד: ${escapeHtml(String(u.code))}</span>
            ${isAdmin ? `<span class="text-xs bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5 mr-1">אדמין</span>` : ""}
          </div>
          ${
            isAdmin
              ? ""
              : `<button data-name="${escapeHtml(u.name)}" class="removeUserBtn text-rose-600 hover:text-rose-800 text-sm font-bold">הסרה</button>`
          }
        </div>
      `;
    })
    .join("");

  listEl.querySelectorAll(".removeUserBtn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const name = btn.getAttribute("data-name");
      if (!confirm(`להסיר את ${name}?`)) return;
      const { ok, data } = await api("/api/admin/users/remove", {
        adminCode: session.code,
        name,
      });
      if (ok && data.ok) {
        showToast("המשתמש הוסר", "success");
        await refreshState();
        renderApp();
        await loadUsersList();
      } else {
        showToast(data.error || "שגיאה", "error");
      }
    });
  });
}

// ---------------------------------------------------------------------
// Booking actions (guarded against double-click race)
// ---------------------------------------------------------------------
async function handleBook(date) {
  if (busy) return;
  busy = true;
  try {
    const { ok, data } = await api("/api/book", {
      name: session.name,
      code: session.code,
      date,
    });
    if (ok && data.ok) {
      showToast("התור נקבע בהצלחה", "success");
    } else {
      showToast(data.error || "שגיאה בקביעת התור", "error");
    }
    await refreshState();
    renderApp();
  } finally {
    busy = false;
  }
}

async function handleCancel(date) {
  if (busy) return;
  busy = true;
  try {
    const { ok, data } = await api("/api/cancel", {
      name: session.name,
      code: session.code,
      date,
    });
    if (ok && data.ok) {
      showToast("ההזמנה בוטלה", "success");
    } else {
      showToast(data.error || "שגיאה בביטול", "error");
    }
    await refreshState();
    renderApp();
  } finally {
    busy = false;
  }
}

// ---------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------
async function boot() {
  session = loadSession();
  await refreshState();
  renderUserBox();

  if (!session) {
    document.getElementById("app").classList.add("hidden");
    renderLoginCard();
    return;
  }

  document.getElementById("loginCard").classList.add("hidden");
  renderApp();
}

boot();
