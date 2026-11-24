import * as Notifications from 'expo-notifications';
import { translate, type Language, type StringKey } from '@fristy/shared';
import type { NotificationPrefs } from './store/prefs';

/*
 * Local notifications raised from events received over the live encrypted
 * connection. No push server is involved, so notifications arrive while the
 * app is running (foreground or recently backgrounded). See docs/FEATURES.md.
 */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false
  })
});

let permission: boolean | null = null;

export async function ensureNotificationPermission(): Promise<boolean> {
  if (permission !== null) return permission;
  const current = await Notifications.getPermissionsAsync();
  permission = current.granted || (await Notifications.requestPermissionsAsync()).granted;
  return permission;
}

const TITLES: Record<keyof NotificationPrefs, StringKey> = {
  startup: 'notif.startup',
  shutdown: 'notif.shutdown',
  cpuTemp: 'notif.cpuTemp',
  gpuTemp: 'notif.gpuTemp',
  lowStorage: 'notif.lowStorage',
  gameLaunched: 'notif.gameLaunched',
  transferComplete: 'notif.transferComplete',
  unauthorizedAttempt: 'notif.unauthorized',
  deviceDisconnected: 'notif.disconnected'
};

export async function notify(type: string, message: string, prefs: NotificationPrefs, lang: Language) {
  if (!(type in TITLES) || !prefs[type as keyof NotificationPrefs]) return;
  if (!(await ensureNotificationPermission())) return;
  await Notifications.scheduleNotificationAsync({
    content: { title: translate(lang, TITLES[type as keyof NotificationPrefs]), body: message.slice(0, 200) },
    trigger: null
  });
}
