# Updates

Both apps update from the **GitHub Releases of this repository** (`fristy-remote`).
For that to work without any token, the repository must be **public**:
GitHub → repository → Settings → General → Danger Zone → Change visibility → Public.

## How it works

- Every push to `main` runs CI. The Windows job builds the NSIS installer with
  version `0.2.<run number>` and publishes it (plus `latest.yml`) as a GitHub Release
  using the built-in `GITHUB_TOKEN` (`permissions: contents: write`).
- The PC app (electron-updater) reads
  `https://github.com/<owner>/fristy-remote/releases/latest/download/latest.yml`.
  Settings → Updates → **Check / Update now** downloads and installs the new version.
- The iOS workflow publishes the unsigned `.ipa` as a pre-release `ios-v0.2.<run>`.
  The phone app compares its version with the newest release and shows an update banner;
  install the new `.ipa` with Sideloadly.
- Friends can download both installers from the repository's Releases page.

## Mandatory updates

In the admin panel set **Minimum version** (e.g. `0.2.40`). Older apps refuse to work
and show "update required" until updated.

## First time

A build made before releases existed cannot update itself: install the newest
`FRISTY-Remote-Setup-*.exe` from Releases once by hand. From then on use **Update now**.
