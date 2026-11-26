import WebSocket from 'ws';
import { addressKind, isTailscaleIPv4 } from '@fristy/shared';
import type { FristyCore } from '../core';

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'error' | 'info';
  detail: string;
  /** addresses and other technical details, only shown on request */
  technical?: string;
}

/** Connection diagnostics shown in Settings → Diagnostics. Every check is real, nothing is assumed. */
export async function runDiagnostics(core: FristyCore): Promise<DiagnosticCheck[]> {
  const st = core.state();
  const checks: DiagnosticCheck[] = [];

  checks.push({
    id: 'platform',
    label: 'Platform',
    status: st.platform.supported ? 'ok' : 'warn',
    detail: st.platform.supported ? `Windows integration active (${st.platform.name})` : `Running on ${st.platform.name}: PC control features are unavailable`
  });

  checks.push({
    id: 'identity',
    label: 'Device identity',
    status: st.identityPersisted ? 'ok' : 'warn',
    detail: st.identityPersisted
      ? `Key protected by Windows secure storage. Fingerprint ${st.fingerprint}`
      : 'OS secure storage unavailable: identity is temporary and devices must re-pair after restart'
  });

  if (!st.settings.remoteEnabled) {
    checks.push({ id: 'server', label: 'Control server', status: 'info', detail: 'Remote access is turned off' });
  } else if (!st.listening) {
    checks.push({ id: 'server', label: 'Control server', status: 'error', detail: st.listenError ?? 'Not listening' });
  } else {
    // Real loopback probe of the WebSocket endpoint.
    const ok = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${st.port}/fristy`);
      const t = setTimeout(() => {
        ws.terminate();
        resolve(false);
      }, 3000);
      ws.once('open', () => {
        clearTimeout(t);
        ws.close();
        resolve(true);
      });
      ws.once('error', () => {
        clearTimeout(t);
        resolve(false);
      });
    });
    checks.push({
      id: 'server',
      label: 'Control server',
      status: ok ? 'ok' : 'error',
      detail: ok ? `Listening on port ${st.port}` : `Port ${st.port} did not respond to a local probe`
    });
  }

  checks.push({
    id: 'network',
    label: 'Network',
    status: st.addresses.some((a) => addressKind(a) === 'home') ? 'ok' : st.addresses.length ? 'warn' : 'error',
    detail: st.addresses.some((a) => addressKind(a) === 'home')
      ? 'Connected to the home network'
      : st.addresses.length
        ? 'No home network adapter found'
        : 'No network connection',
    technical: st.addresses.join(', ') || undefined
  });

  const ts = st.addresses.find(isTailscaleIPv4);
  checks.push({
    id: 'tailscale',
    label: 'Tailscale (away from home)',
    status: ts ? 'ok' : 'info',
    detail: ts
      ? 'Reachable from your Tailscale devices. Open the phone app once at home so it learns the route.'
      : 'Not detected. Install Tailscale on this PC and your phone (same account) to use FRISTY Remote away from home.',
    technical: ts ? `${ts}:${st.port}` : undefined
  });

  checks.push({
    id: 'firewall',
    label: 'Windows Firewall',
    status: 'info',
    detail:
      'The installer adds an inbound rule for Private networks only. If phones cannot connect, make sure your Wi-Fi is set to "Private network" in Windows settings.'
  });

  checks.push({
    id: 'relay',
    label: 'Internet relay',
    status: !st.settings.relayEnabled ? 'info' : st.relay.status === 'connected' ? 'ok' : 'error',
    detail: !st.settings.relayEnabled
      ? 'Disabled (LAN only)'
      : st.relay.status === 'connected'
        ? `Connected to ${st.settings.relayUrl}`
        : `Status: ${st.relay.status}${st.relay.error ? ` – ${st.relay.error}` : ''}`
  });

  const started = Date.now();
  try {
    const s = await core.stats();
    const na = Object.entries(s).filter(([k, v]) => v === null && !['runningGame', 'gpuName'].includes(k)).map(([k]) => k);
    checks.push({
      id: 'monitor',
      label: 'Hardware monitoring',
      status: na.length ? 'warn' : 'ok',
      detail: `Sampled in ${Date.now() - started} ms${na.length ? `. Not available on this hardware: ${na.join(', ')}` : ''}`
    });
  } catch (e) {
    checks.push({ id: 'monitor', label: 'Hardware monitoring', status: 'error', detail: (e as Error).message });
  }

  if (st.platform.supported) {
    try {
      const t = Date.now();
      const procs = await core.procs.list();
      checks.push({ id: 'helper', label: 'Native helper', status: procs.length ? 'ok' : 'warn', detail: `Responding (${procs.length} processes, ${Date.now() - t} ms)` });
    } catch (e) {
      checks.push({ id: 'helper', label: 'Native helper', status: 'error', detail: (e as Error).message });
    }
  }

  checks.push({
    id: 'sessions',
    label: 'Active connections',
    status: 'info',
    detail: st.sessions.length
      ? st.sessions.map((s) => `${s.deviceName} (${s.kind === 'relay' ? 'relay' : addressKind(s.remote) === 'remote' ? 'remote' : 'home'})`).join('; ')
      : 'None',
    technical: st.sessions.length ? st.sessions.map((s) => `${s.deviceName}: ${s.remote}`).join('; ') : undefined
  });
  return checks;
}
