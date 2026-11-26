# Updates (PC: one click · iPhone: mandatory)

Builds are published to a **public, binaries-only** repository,
`<owner>/fristy-remote-releases`. The source code stays private.

- **PC** – FRISTY Remote checks for a new version every hour (and on demand in
  Settings → Updates). As soon as one exists it downloads it and **stops accepting
  phone connections** until you click **Update now** (Windows asks for permission once,
  because the app is installed for all users).
- **iPhone** – sideloaded apps cannot replace themselves. When a newer iPhone build
  is published, older versions show **"Update required"** with a link to the new
  `.ipa`; install it with Sideloadly over the existing app (settings and pairings stay).
- Friends can download both installers from the releases page.

Versions are `0.2.<build number>`; the PC and iPhone have separate build numbers.

## One-time setup

1. **Create the releases repository** – github.com/new → name `fristy-remote-releases`
   → **Public** → tick **Add a README file** (releases need at least one commit) → Create.
2. **Create a token** – GitHub → Settings → Developer settings → Personal access tokens
   → **Fine-grained tokens** → Generate new token:
   - Repository access: **Only select repositories** → `fristy-remote-releases`
   - Permissions → Repository permissions → **Contents: Read and write**
   - Expiration: your choice (renew it before it expires)
3. **Add it as a secret** in the private `fristy-remote` repository → Settings → Secrets
   and variables → Actions → New repository secret → `RELEASES_TOKEN`.
4. Re-run the **CI** and **iOS app** workflows (or push any change). Each run on `main`
   now publishes a release.
5. Install the published PC version **once manually** (versions before 0.2 have no
   updater). From then on, updates are one click.
