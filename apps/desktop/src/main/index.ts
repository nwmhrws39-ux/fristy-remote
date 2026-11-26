import path from 'node:path';
import { BrowserWindow, Menu, Notification, Tray, app, clipboard, desktopCapturer, globalShortcut, nativeImage, safeStorage, screen, session, shell } from 'electron';
import type { DesktopBridge } from '../core/bridge';
import { cursorOn, grabFrame, isCaptureContents, stopCapture } from './capture';
import { Updater } from './updater';
import { FristyCore } from '../core';
import { SecretStore, loadIdentity, type SecretCipher } from '../core/identity';
import { createUnsupportedPlatform } from '../core/platform/unsupported';
import { createWindowsPlatform } from '../core/platform/windows';
import type { Platform } from '../core/platform/types';
import { registerIpc } from './ipc';
import { DEFAULT_ADMIN_API_URL } from '@fristy/shared';

/*
 * FRISTY Remote – Electron main process.
 * Security posture:
 *  - renderer: contextIsolation, sandbox, no nodeIntegration, strict CSP,
 *    navigation and new windows blocked, all permission requests denied
 *  - one IPC entry point with channel allow-list + schema validation + sender check
 *  - runs as the current (standard) user; never requests elevation
 *  - a visible tray icon and on-screen indicator whenever remote input is active
 */

const EMERGENCY_SHORTCUT = 'Control+Alt+Shift+F12';
const DEV_URL = process.env.FRISTY_DEV_URL;
const startHidden = process.argv.includes('--hidden');

let core: FristyCore;
let mainWindow: BrowserWindow | null = null;
let indicator: BrowserWindow | null = null;
let indicatorTimer: NodeJS.Timeout | null = null;
let tray: Tray | null = null;
let quitting = false;
let platform: Platform & { dispose?: () => void };
const updater = new Updater();

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.setAppUserModelId('com.fristy.remote');

const resources = () => (app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..', 'resources'));
const rendererFile = (page: string) => path.join(__dirname, '..', 'renderer', page);
const trusted = (url: string) =>
  DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('file://') && decodeURIComponent(new URL(url).pathname).includes('/renderer/');

const cipher: SecretCipher = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (b) => safeStorage.encryptString(b.toString('base64')),
  decrypt: (b) => Buffer.from(safeStorage.decryptString(b), 'base64')
};

function hardenWebContents(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!trusted(url)) e.preventDefault();
  });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
}

function createMainWindow() {
  const s = core.settings.get();
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'FRISTY Remote',
    backgroundColor: s.theme === 'dark' ? '#07070B' : '#F5F4FA',
    icon: path.join(resources(), 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: s.theme === 'dark' ? '#A9A6C2' : '#5C5970', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  });
  hardenWebContents(mainWindow);
  void (DEV_URL ? mainWindow.loadURL(DEV_URL) : mainWindow.loadFile(rendererFile('index.html')));
  mainWindow.once('ready-to-show', () => {
    if (!(startHidden || s.startMinimized)) mainWindow?.show();
  });
  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showMain() {
  if (!mainWindow) createMainWindow();
  mainWindow!.show();
  mainWindow!.focus();
}

function send(event: string, data: unknown) {
  mainWindow?.webContents.send(`fristy:${event}`, data);
}

/* -------------------- remote input indicator -------------------- */

function showIndicator(deviceName: string, kind: 'input' | 'screen' = 'input') {
  if (!indicator) {
    indicator = new BrowserWindow({
      width: 300,
      height: 56,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    indicator.setAlwaysOnTop(true, 'screen-saver');
    indicator.setIgnoreMouseEvents(true);
    hardenWebContents(indicator);
    const area = screen.getPrimaryDisplay().workArea;
    indicator.setPosition(area.x + area.width - 316, area.y + 16);
  }
  const q = new URLSearchParams({ device: deviceName.slice(0, 40), lang: core.settings.get().language, kind });
  const target = DEV_URL ? `${DEV_URL}/indicator.html?${q}` : `file://${rendererFile('indicator.html').replace(/\\/g, '/')}?${q}`;
  if (indicator.webContents.getURL() !== target) void indicator.loadURL(target);
  if (!indicator.isVisible()) indicator.showInactive();
  if (indicatorTimer) clearTimeout(indicatorTimer);
  indicatorTimer = setTimeout(() => indicator?.hide(), 4000);
}

/* -------------------- desktop bridge (screen, clipboard, shell) -------------------- */

function displayById(id: string) {
  return screen.getAllDisplays().find((d) => String(d.id) === id);
}

const desktopBridge: DesktopBridge = {
  displays() {
    const primary = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d, i) => ({
      id: String(d.id),
      name: d.label || `Display ${i + 1}`,
      width: Math.round(d.size.width * d.scaleFactor),
      height: Math.round(d.size.height * d.scaleFactor),
      primary: d.id === primary
    }));
  },
  grab: (displayId, maxWidth, quality) => grabFrame(displayId, maxWidth, quality, path.join(__dirname, '..', 'renderer'), DEV_URL),
  cursor: (displayId) => cursorOn(displayId),
  toScreenPoint(displayId, nx, ny) {
    const d = displayById(displayId);
    if (!d) throw new Error('display not found');
    const dip = { x: Math.round(d.bounds.x + nx * (d.bounds.width - 1)), y: Math.round(d.bounds.y + ny * (d.bounds.height - 1)) };
    // Windows: convert DIP to physical pixels (correct across mixed-DPI monitors).
    return process.platform === 'win32' ? screen.dipToScreenPoint(dip) : dip;
  },
  clipboardRead: () => clipboard.readText(),
  clipboardWrite: (text) => clipboard.writeText(text),
  notify(title, body) {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  },
  openPath: (file) => shell.openPath(file)
};

/* -------------------- tray -------------------- */

function updateTray() {
  if (!tray) return;
  const st = core.state();
  const s = st.settings;
  const devices = st.sessions.length ? st.sessions.map((x) => ({ label: `• ${x.deviceName} (${x.kind === 'relay' ? 'internet' : 'LAN'})`, enabled: false })) : [{ label: 'No devices connected', enabled: false }];
  const status = !s.remoteEnabled ? 'Remote access off' : st.listening ? `Ready – port ${st.port}` : `Error: ${st.listenError ?? 'not listening'}`;
  tray.setToolTip(`FRISTY Remote – ${status}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open FRISTY Remote', click: showMain },
      { type: 'separator' },
      { label: status, enabled: false },
      { label: `Connected devices (${st.sessions.length})`, enabled: false },
      ...devices,
      { type: 'separator' },
      { label: 'Enable remote access', type: 'checkbox', checked: s.remoteEnabled, click: (i) => core.settings.update({ remoteEnabled: i.checked }) },
      { label: 'Allow remote mouse & keyboard', type: 'checkbox', checked: s.inputEnabled, click: (i) => core.settings.update({ inputEnabled: i.checked }) },
      { label: 'Disconnect all devices', click: () => core.server.disconnectAll() },
      {
        label: 'Start with Windows',
        type: 'checkbox',
        checked: s.startWithWindows,
        click: (i) => {
          core.settings.update({ startWithWindows: i.checked });
          app.setLoginItemSettings({ openAtLogin: i.checked, args: ['--hidden'] });
        }
      },
      { type: 'separator' },
      {
        label: 'Exit',
        click: () => {
          quitting = true;
          app.quit();
        }
      }
    ])
  );
}

/* -------------------- startup -------------------- */

app.on('second-instance', showMain);

app.whenReady().then(async () => {
  // Deny every web permission (camera, mic, notifications, geolocation …) to renderer content.
  // The only exception: the hidden capture window may use screen capture ("media").
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'media' && isCaptureContents(wc)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => perm === 'media' && !!wc && isCaptureContents(wc));

  const dataDir = app.getPath('userData');
  const { identity, persisted } = loadIdentity(dataDir, cipher);
  const secrets = new SecretStore(dataDir, cipher);
  const opener = { openExternal: (u: string) => shell.openExternal(u, { activate: true }) };
  platform =
    process.platform === 'win32'
      ? createWindowsPlatform(path.join(resources(), 'fristy-helper.ps1'), opener)
      : createUnsupportedPlatform(opener);

  core = await FristyCore.create({
    dataDir,
    platform,
    identity,
    identityPersisted: persisted,
    appVersion: app.getVersion(),
    sqlWasmPath: path.join(__dirname, 'sql-wasm.wasm'),
    desktop: desktopBridge,
    ownerApiUrl: process.env.FRISTY_ADMIN_API_URL || DEFAULT_ADMIN_API_URL,
    ownerTokenStore: {
      get: () => secrets.get('owner-token'),
      set: (t) => {
        try {
          secrets.set('owner-token', t);
        } catch {
          /* OS encryption unavailable – stay signed out */
        }
      }
    },
    launcherToken: () => secrets.get('launcher-token'),
    iconFor: async (exe) => {
      try {
        const img = await app.getFileIcon(exe, { size: 'large' });
        return img.isEmpty() ? null : img.toDataURL();
      } catch {
        return null;
      }
    }
  });

  registerIpc(core, secrets, trusted, updater);
  updater.on('state', (st) => {
    send('update', st);
    core.setUpdateRequired(updater.required ? `A new version of FRISTY Remote${'version' in st && st.version ? ` (${st.version})` : ''} is available. Open FRISTY Remote on the PC and click "Update now".` : null);
    updateTray();
  });

  core.on('state', (st) => {
    send('state', st);
    updateTray();
  });
  core.on('pairing-request', (req) => {
    send('pairing-request', req);
    showMain();
    if (Notification.isSupported()) {
      const n = new Notification({ title: 'FRISTY Remote – pairing request', body: `${req.deviceName} wants to control this PC. Code ${req.sas}` });
      n.on('click', showMain);
      n.show();
    }
  });
  core.on('input-activity', (a) => {
    send('input-activity', a);
    showIndicator(a.deviceName);
  });
  core.on('screen-activity', (a) => showIndicator(a.deviceName, 'screen'));
  core.on('security', (s) => {
    send('security', s);
    if (Notification.isSupported()) new Notification({ title: 'FRISTY Remote – security', body: s.message }).show();
  });

  await core.start();

  const trayIcon = nativeImage.createFromPath(path.join(resources(), process.platform === 'win32' ? 'tray.ico' : 'tray.png'));
  tray = new Tray(trayIcon.isEmpty() ? nativeImage.createEmpty() : trayIcon);
  tray.on('click', showMain);
  updateTray();

  const registered = globalShortcut.register(EMERGENCY_SHORTCUT, () => {
    core.emergencyStop();
    indicator?.hide();
    if (Notification.isSupported()) new Notification({ title: 'FRISTY Remote', body: 'Remote input and screen viewing disabled (emergency shortcut).' }).show();
  });
  if (!registered) core.store.log('warn', 'input', `Emergency shortcut ${EMERGENCY_SHORTCUT} is in use by another application`);

  createMainWindow();
  updater.start();
});

app.on('window-all-closed', () => {
  /* keep running in the tray */
});

app.on('before-quit', () => {
  quitting = true;
  stopCapture();
});

app.on('will-quit', (e) => {
  globalShortcut.unregisterAll();
  if (core) {
    e.preventDefault();
    void core
      .stop()
      .catch(() => undefined)
      .finally(() => {
        platform?.dispose?.();
        core = undefined as unknown as FristyCore;
        app.exit(0);
      });
  }
});
