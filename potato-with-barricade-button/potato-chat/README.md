# POTATO — realtime private chat for your squad

A standalone installable web app (PWA) with realtime messages, image sharing, emoji reactions, editing/deleting messages, five-character private invite codes, typing indicators, unread counts, browser/phone push notifications, and optional Barricade game link. Built with Node.js, Express, Socket.IO, Web Push, Supabase database + private Storage in production. No Base44 credits.

## Recommendation: keep POTATO and Barricade as **two websites**

Use your existing Barricade site for gameplay. Deploy POTATO as a **separate Render web service** and GitHub repo. This avoids a chat bug or deployment restarting an ongoing match, and keeps chats/auth/security independent of game logic. Optionally set `GAME_URL` in POTATO's Render environment to link to your Barricade site. Eventually share navigation and single sign-on if you want.

## Test locally in two minutes

1. Install Node.js LTS.
2. Extract this ZIP, open the `relay-chat` folder, and double-click `start-windows.bat` (or run `npm install`, `npm start`).
3. Visit `http://localhost:3000`.
4. Enter a nickname, create a room, and test another account in a private browser window. For different devices in the same home, use your computer's local IP address with port 3000 (may need Windows Firewall allowance). **Push notifications require HTTPS in production or localhost**, and VAPID keys.

**WARNING:** local test mode uses `data/` on your own computer for messages and images. It is NOT suitable for permanent Render hosting: Render's free disk is temporary and gets wiped on sleep, restart, redeploy. Production starts will refuse to run without persistent Supabase configuration.

## Real online deployment, saved messages and images

1. Create a new free Supabase project at https://supabase.com (a separate service from Render). Supabase Dashboard → **SQL Editor** → paste/run `supabase.sql`.
2. Supabase Dashboard → **Storage** → **New bucket** → name **`relay-images`** → **private** (public toggle OFF). Do not make it public.
3. Supabase Dashboard → **Project Settings → API** (or API Keys) → copy the **Project URL** and the **service_role/secret API key**. **Keep the key secret: never put it in your `public` files, GitHub, or screenshots**. This server needs the service-role key to access your private tables and storage. Only use a trusted private backend.
4. Run `npm install`, then `npm run vapid` ONCE on your PC. This prints your **VAPID_PUBLIC_KEY** and **VAPID_PRIVATE_KEY**. Keep the private key secret. Use the same keys across redeploys or push subscriptions will break.
5. Create a **new** GitHub repository, e.g. `relay-chat`, and upload the files INSIDE this ZIP's `relay-chat` folder. DO NOT upload `node_modules`, `.env`, or `data`. Keep it separate from your `barricade67` repository. 
6. In Render, **New → Web Service** → connect `relay-chat`. Set Language Node, Build `npm install`, Start `npm start`, Instance Free if available, Root Directory **blank** if you uploaded the files at repo root. Choose your closest region.
7. **Render → Environment**: add the following **environment variables** (don't put quotation marks around values):
    - `NODE_ENV=production`
    - `SUPABASE_URL=` your Supabase project URL
    - `SUPABASE_SERVICE_ROLE_KEY=` your Supabase service-role/secret key
    - `VAPID_PUBLIC_KEY=` the output from `npm run vapid`
    - `VAPID_PRIVATE_KEY=` the output from `npm run vapid`
    - `VAPID_SUBJECT=mailto:your-email@example.com` (a real address under your control)
    - optional `GAME_URL=` your confirmed Barricade game website link
8. Deploy and wait for **Live**. Visit your Render `https://...onrender.com` site, create a chat, and share its invite link with friends. You don't need to run Node.js on your friends' computers.
9. Open the site on your phone and **Settings → Enable push**. Grant permission. iPhone/iPad: first Safari → Share → **Add to Home Screen**, launch POTATO from the icon, then enable notifications inside the app. Android: Chrome → Install/Add to Home screen, and allow notifications. On desktop: click Enable and accept the browser prompt.

### Notification limitations

Push arrives on supported browsers and installed PWAs over HTTPS, **when permission is allowed, internet is available, the device hasn't blocked notifications and the push provider delivers**. Not guaranteed to be instantaneous; do not use for emergencies. Browser/service worker support varies. On iPhone, web push requires an installed Home Screen web app (iOS 16.4+). Not all browsers/platform configurations support it. Free Render instances sleep after 15 minutes of no traffic. A sender's next request can wake them, but messages and notification delivery may be delayed during wake-up. Supabase keeps messages and images even when the server sleeps. Free quotas apply.

### Account recovery

No email/signup needed. After first login, **Settings → Show recovery key**, and keep it private. This 64-character string acts as a **password** for your account; anyone who has it can access your rooms and messages. If you clear your browser's storage or switch devices, use **Restore with your account key**. There is no email-based recovery. Room invite codes are not secret passwords for your account: anyone with an invite code can join that room. Don't post room links publicly if you want the room private.

### Security and scaling notes

This is a functional starter application for a small group, not a Discord replacement or audited messaging product. Transport is encrypted by HTTPS on Render, but messages are **not end-to-end encrypted**. The server can read them; the owner of the Supabase project can access them. The service-role key must be stored ONLY in server environment variables. Private bucket images are downloaded through authenticated membership checks. There is basic rate limiting, small image size limits, output-safe rendering, protected membership endpoints, and no open room browser. No account blocks, moderation tools, message reporting, anti-abuse service, virus scanning, or mature production security controls. Reactions on the same message could race with very frequent edits. Room memberships never expire automatically. For large-scale public use, use stronger authentication, transactional updates, moderation, abuse prevention, audit logs, backups and server monitoring.

### Helpful commands

- `npm install` — install dependencies
- `npm start` — run server
- `npm run vapid` — generate a new VAPID key pair (don't regenerate after users subscribe)
- `npm test` — run unit tests
- `GET /health` — check the server is running

