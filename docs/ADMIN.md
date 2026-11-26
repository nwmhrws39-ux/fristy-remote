# Owner admin panel (optional)

Lets the owner of this FRISTY Remote build see who uses the app, lock it for
everyone else, block single users and publish announcements. Runs free on
**Cloudflare Workers + D1** (no credit card). Builds without it configured work
exactly as before – the feature is simply off.

## What it can and cannot do

| Can | Cannot |
|---|---|
| See each install's chosen name, phone/PC, platform, app version, country, last seen | See IP addresses, files, screens, keystrokes or anything on users' computers |
| Lock FRISTY Remote for everyone except admins (phones show a lock screen, PCs refuse connections) | Control, view or wake anyone else's computer |
| Block / unblock a single install | Bypass the pairing and approval each PC requires |
| Show an announcement and an "update available" notice | – |

Users see a clear notice on first launch explaining what is reported.

The lock is enforced by the apps (phone lock screen + PCs refusing connections).
A determined user who rebuilds the app from source could remove it – it is an
owner control for builds you distribute, not DRM.

## One-time setup (about 10 minutes)

1. **Cloudflare account** – sign up free at dash.cloudflare.com. Open
   *Workers & Pages* once so Cloudflare creates your `workers.dev` subdomain.
2. **API token** – My Profile → API Tokens → Create Token → *Edit Cloudflare
   Workers* template → add permission **Account → D1 → Edit** → Create. Copy it.
3. **Account ID** – shown on the right side of *Workers & Pages*.
4. **GitHub secrets** – repository → Settings → Secrets and variables → Actions →
   *New repository secret*:
   - `CLOUDFLARE_API_TOKEN` – the token
   - `CLOUDFLARE_ACCOUNT_ID` – the account id
   - `ADMIN_CODE` – your admin code (long and unique; never share it or paste it in chat)
5. **Deploy** – Actions → *Admin server (Cloudflare)* → *Run workflow*. The run
   summary shows the URL, e.g. `https://fristy-admin.<you>.workers.dev`.
6. **Variable** – Settings → Secrets and variables → Actions → **Variables** tab →
   *New repository variable* `ADMIN_API_URL` = that URL.
7. **Rebuild the apps** – Actions → *CI* and *iOS app* → *Run workflow*. Install the new
   builds; on first launch the phone asks for a name.

## Using it

- Phone: Settings → bottom → small **🔑** → enter your code → **Admin panel**.
- PC: Settings → bottom right → small **🔑** → enter your code (exempts your PC from the lock).
- Wrong codes are limited to 5 per hour per network and per install.
- To change the code, update the `ADMIN_CODE` secret and re-run the deploy workflow.
