import os from 'node:os';
import si from 'systeminformation';
import type { SystemInfo, SystemStats } from '@fristy/protocol';
import { broadcastAddress, normalizeMac } from '@fristy/shared';

/*
 * Hardware monitoring via `systeminformation`.
 * Any value the OS/hardware cannot report is returned as null and shown as
 * "N/A" in the apps – we never synthesize readings.
 *
 * Windows notes:
 *  - CPU temperature usually requires a vendor driver/WMI provider; without it
 *    the reading is N/A.
 *  - GPU load/temperature are available for NVIDIA GPUs (via nvidia-smi).
 *    Other GPUs report N/A.
 */

type Cached<T> = { at: number; value: T };

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

export class HardwareMonitor {
  private gpu: Cached<{ load: number | null; temp: number | null; name: string | null; models: string[] }> | null = null;
  private disk: Cached<{ free: number | null; total: number | null }> | null = null;
  private gpuPending: Promise<void> | null = null;
  private diskPending: Promise<void> | null = null;
  private battery: Cached<{ percent: number; charging: boolean } | null> | null = null;

  private async refreshBattery() {
    try {
      const b = await si.battery();
      this.battery = {
        at: Date.now(),
        value: b.hasBattery && typeof b.percent === 'number' ? { percent: Math.round(b.percent), charging: !!b.isCharging } : null
      };
    } catch {
      this.battery = { at: Date.now(), value: null };
    }
  }

  private refreshGpu(): Promise<void> {
    if (this.gpuPending) return this.gpuPending;
    this.gpuPending = si
      .graphics()
      .then((g) => {
        const ctrls = g.controllers ?? [];
        // Prefer a controller that reports utilization (discrete GPU), else the first.
        const main = ctrls.find((c) => num(c.utilizationGpu) !== null) ?? ctrls[0];
        this.gpu = {
          at: Date.now(),
          value: {
            load: num(main?.utilizationGpu),
            temp: num(main?.temperatureGpu),
            name: main?.model || null,
            models: ctrls.map((c) => c.model).filter(Boolean)
          }
        };
      })
      .catch(() => {
        this.gpu = { at: Date.now(), value: { load: null, temp: null, name: null, models: [] } };
      })
      .finally(() => {
        this.gpuPending = null;
      });
    return this.gpuPending;
  }

  private refreshDisk(): Promise<void> {
    if (this.diskPending) return this.diskPending;
    this.diskPending = si
      .fsSize()
      .then((list) => {
        const local = list.filter((d) => d.size > 0 && !/^\\\\/.test(d.fs) && d.type !== 'Network');
        this.disk = {
          at: Date.now(),
          value: local.length
            ? { free: local.reduce((n, d) => n + d.available, 0), total: local.reduce((n, d) => n + d.size, 0) }
            : { free: null, total: null }
        };
      })
      .catch(() => {
        this.disk = { at: Date.now(), value: { free: null, total: null } };
      })
      .finally(() => {
        this.diskPending = null;
      });
    return this.diskPending;
  }

  async stats(): Promise<Omit<SystemStats, 'ts' | 'runningGame'>> {
    const now = Date.now();
    // Slow probes are cached and refreshed in the background.
    if (!this.gpu) await this.refreshGpu();
    else if (now - this.gpu.at > 2000) void this.refreshGpu();
    if (!this.disk) await this.refreshDisk();
    else if (now - this.disk.at > 30_000) void this.refreshDisk();

    if (!this.battery || now - this.battery.at > 30_000) await this.refreshBattery();
    const [load, temp, net] = await Promise.all([
      si.currentLoad().catch(() => null),
      si.cpuTemperature().catch(() => null),
      si.networkStats().catch(() => [])
    ]);
    const active = net.filter((n) => n.operstate === 'up' || n.rx_sec !== null);
    const sum = (k: 'rx_sec' | 'tx_sec') => {
      const vals = active.map((n) => n[k]).filter((v): v is number => typeof v === 'number' && v >= 0);
      return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
    };
    return {
      cpuLoad: num(load?.currentLoad),
      cpuTemp: num(temp?.main) && temp!.main! > 0 ? temp!.main : null,
      gpuLoad: this.gpu?.value.load ?? null,
      gpuTemp: this.gpu?.value.temp ?? null,
      gpuName: this.gpu?.value.name ?? null,
      memUsed: os.totalmem() - os.freemem(),
      memTotal: os.totalmem(),
      diskFree: this.disk?.value.free ?? null,
      diskTotal: this.disk?.value.total ?? null,
      netRx: sum('rx_sec'),
      netTx: sum('tx_sec'),
      uptime: Math.round(os.uptime()),
      battery: this.battery?.value ?? null
    };
  }

  async info(): Promise<SystemInfo> {
    if (!this.gpu) await this.refreshGpu();
    const cpus = os.cpus();
    return {
      computerName: os.hostname(),
      os: `${os.type()} ${os.release()}`,
      cpuModel: cpus[0]?.model?.trim() ?? null,
      gpuModels: this.gpu?.value.models ?? [],
      memTotal: os.totalmem(),
      wol: wakeOnLanInfo()
    };
  }
}

/** Picks the most likely wake-capable adapter (wired Ethernet preferred). */
export function wakeOnLanInfo(): SystemInfo['wol'] {
  const ifaces = os.networkInterfaces();
  const candidates: { name: string; mac: string; broadcast: string | null; wired: boolean }[] = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs ?? []) {
      if (a.internal || a.family !== 'IPv4') continue;
      const mac = normalizeMac(a.mac);
      if (!mac) continue;
      candidates.push({
        name,
        mac,
        broadcast: broadcastAddress(a.address, a.netmask),
        wired: /ethernet|^eth|^en[op]/i.test(name) && !/wi-?fi|wlan|wireless/i.test(name)
      });
    }
  }
  const best = candidates.find((c) => c.wired) ?? candidates[0];
  if (!best) return { supported: false, mac: null, broadcast: null, note: 'No active IPv4 network adapter found.' };
  return {
    supported: true,
    mac: best.mac,
    broadcast: best.broadcast,
    note: best.wired
      ? `Adapter "${best.name}". Wake-on-LAN also requires BIOS/UEFI and adapter settings to be enabled.`
      : `Adapter "${best.name}" looks wireless – most Wi-Fi adapters cannot wake a PC. Use wired Ethernet.`
  };
}
