# מערכת ניהול עמדה חמה — Hot-Desk Booking App

Plain Node.js/Express backend + vanilla HTML/CSS/JS frontend (Tailwind via CDN).
No build step, no framework — deploys as-is.

## How it works

- **Backend (`server.js`)** owns all logic: the rolling 2-week Sun–Thu booking
  window, the admin's permanent day, the 1-active-booking limit, and all
  reads/writes to the data files.
- **`data/users.json`** is the private file with names + personal access
  codes. It is:
  - never served as a static file,
  - never returned in full to non-admin requests,
  - excluded from git via `.gitignore` (only `users.example.json` is committed),
  - only readable/writable through the `/api/admin/*` routes, which require
    a valid admin code.
- The frontend never stores anyone's code except the currently logged-in
  user's own, in `sessionStorage` for that browser tab only.

## Run locally

```bash
npm install
npm start
```

First run with no `data/users.json` present will auto-create one and print
an admin name + one-time admin code to the console — **copy that code**,
you'll need it to log in as admin and add your real users. Or set it
yourself ahead of time:

```bash
ADMIN_CODE=yourSecretCode ADMIN_NAME="גבריאל" npm start
```

Then open `http://localhost:3000`, log in as admin, and use the "ניהול
משתמשים" panel to add your regular users (name + a code each).

## Deploy: GitHub + Railway

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Hot-desk booking app"
   git branch -M main
   git remote add origin https://github.com/<your-username>/hotdesk-app.git
   git push -u origin main
   ```
   Because `data/users.json` is gitignored, your real codes never touch GitHub.

2. **Create the Railway project**
   - Go to railway.app → New Project → Deploy from GitHub repo → pick this repo.
   - Railway detects Node.js automatically (`npm install` then `npm start`).

3. **Set the admin code as an environment variable**
   In Railway → your service → Variables, add:
   - `ADMIN_CODE` = a strong code only you know
   - `ADMIN_NAME` = your name (optional, defaults to "גבריאל")

   This only matters the *first* time the app boots with no `users.json` yet.

4. **Add a persistent volume (important)**
   Railway's filesystem is ephemeral on redeploys. Since `data/` holds your
   live users/bookings/config, attach a Railway **Volume** mounted at
   `/app/data` (Service → Settings → Volumes) so that data survives
   redeploys and restarts. Without a volume, every redeploy resets bookings
   and regenerates a fresh admin code.

5. **Deploy.** Railway gives you a public URL — that's your app.

6. Log in as admin with your `ADMIN_CODE`, add your users from the admin
   panel, and set the permanent day.

## Business rules implemented

- Booking window: Sunday–Thursday only, rolling 2 weeks, recalculated from
  the most recent Thursday on every request (always current, no manual reset).
- Regular users: max 1 active booking inside the open window; all other
  days show disabled/booked state for them until they cancel.
- Admin: one configurable recurring weekday is auto-reserved every week
  across the whole window; admin bypasses the 1-booking limit for other days
  and can cancel anyone's booking.
- Server-side write queue serializes booking writes so two people clicking
  the same day at the same time can't both win the slot.
