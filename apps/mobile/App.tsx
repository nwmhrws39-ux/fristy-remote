import './src/store/secure'; // installs the secure RNG before any crypto runs
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AppWindow, FolderSync, Gamepad2, LayoutDashboard, LayoutGrid, Monitor, MousePointer2, Power, Settings, Volume2, Wrench, Zap, type LucideIcon } from 'lucide-react-native';
import type { StringKey } from '@fristy/shared';
import { font, radius, spacing } from '@fristy/ui';
import { AppProvider, useApp } from './src/theme';
import { connection } from './src/connection/manager';
import { useConnection } from './src/connection/hooks';
import { notify } from './src/notifications';
import { getActiveHostKey, loadHosts, type PairedHost } from './src/store/hosts';
import { Button, Logo, Muted, StatusDot } from './src/components/ui';
import { PairScreen } from './src/screens/PairScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { PowerScreen } from './src/screens/PowerScreen';
import { GamesScreen } from './src/screens/GamesScreen';
import { AppsScreen } from './src/screens/AppsScreen';
import { TouchpadScreen } from './src/screens/TouchpadScreen';
import { AudioScreen } from './src/screens/AudioScreen';
import { FilesScreen } from './src/screens/FilesScreen';
import { MacrosScreen } from './src/screens/MacrosScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { AdminScreen } from './src/screens/AdminScreen';
import { ownerEnabled, startOwner } from './src/admin/owner';
import { LegalScreen, useLegal } from './src/legal/LegalScreen';
import { legalStore, loadLegal } from './src/legal/legal';
import { isAccepted } from '@fristy/shared';
import { LockScreen, OwnerBanners, UpdateRequiredScreen, WelcomeName, useOwner, useUpdate } from './src/admin/OwnerUi';
import { startUpdateChecks, updatesEnabled } from './src/admin/updates';
import { ScreenScreen } from './src/screens/ScreenScreen';
import { ToolsScreen } from './src/screens/ToolsScreen';

type Tab = 'dashboard' | 'games' | 'input' | 'screen' | 'power' | 'more' | 'apps' | 'audio' | 'files' | 'macros' | 'tools' | 'settings' | 'admin';

const MAIN_TABS: { id: Tab; icon: LucideIcon; label: StringKey }[] = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'nav.dashboard' },
  { id: 'games', icon: Gamepad2, label: 'nav.games' },
  { id: 'screen', icon: Monitor, label: 'screen.title' },
  { id: 'input', icon: MousePointer2, label: 'nav.input' },
  { id: 'more', icon: LayoutGrid, label: 'nav.macros' }
];

const MORE: { id: Tab; icon: LucideIcon; label: StringKey }[] = [
  { id: 'power', icon: Power, label: 'nav.power' },
  { id: 'tools', icon: Wrench, label: 'nav.tools' },
  { id: 'macros', icon: Zap, label: 'nav.macros' },
  { id: 'apps', icon: AppWindow, label: 'nav.apps' },
  { id: 'audio', icon: Volume2, label: 'nav.audio' },
  { id: 'files', icon: FolderSync, label: 'nav.files' },
  { id: 'settings', icon: Settings, label: 'nav.settings' }
];

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <Root />
      </AppProvider>
    </SafeAreaProvider>
  );
}

function Root() {
  const { c, prefs, ready, setPrefs } = useApp();
  const owner = useOwner();
  const update = useUpdate();
  const legal = useLegal();
  const [legalLoaded, setLegalLoaded] = useState(legalStore.loaded());
  useEffect(() => {
    void loadLegal().then(() => setLegalLoaded(true));
  }, []);
  const accepted = isAccepted(legal);
  useEffect(() => {
    void startUpdateChecks();
  }, []);
  const nameRef = useRef(prefs.userName);
  nameRef.current = prefs.userName;
  useEffect(() => {
    if (ready) void startOwner(() => nameRef.current);
  }, [ready]);
  const [hosts, setHosts] = useState<PairedHost[] | null>(null);
  const [pairing, setPairing] = useState(false);

  const refreshHosts = async () => {
    const list = await loadHosts();
    setHosts(list);
    return list;
  };

  useEffect(() => {
    void (async () => {
      const list = await refreshHosts();
      if (!accepted) return; // no connections before the terms are accepted
      const active = await getActiveHostKey();
      const host = list.find((h) => h.pk === active) ?? list[0];
      if (host) void connection.connect(host);
    })();
  }, [accepted]);

  // Route server alerts to local notifications according to the user's preferences.
  useEffect(() => {
    connection.onAlert = (a) => void notify(a.type, a.message, prefs.notifications, prefs.language);
  }, [prefs.notifications, prefs.language]);

  if (!ready || hosts === null || !legalLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Logo size={64} />
        <ActivityIndicator color={c.accent} style={{ marginTop: spacing.lg }} />
      </View>
    );
  }

  // Mandatory legal onboarding (again whenever the document version changes).
  if (!accepted) return <LegalScreen />;

  // Mandatory updates: an outdated iPhone version stops working.
  if (updatesEnabled && update.required) return <UpdateRequiredScreen />;

  // Owner service: ask for a name once (with a clear notice), and honour the owner's lock.
  if (ownerEnabled && !prefs.userName) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <WelcomeName onDone={(name) => setPrefs({ userName: name })} />
      </View>
    );
  }
  const inMaintenance = !!owner.maintenance && Date.now() >= owner.maintenance.start && Date.now() < owner.maintenance.end;
  if (ownerEnabled && (owner.locked || inMaintenance) && !owner.admin) return <LockScreen />;

  const content =
    pairing || hosts.length === 0 ? (
      <PairScreen
        onCancel={hosts.length ? () => setPairing(false) : undefined}
        onPaired={(h) => {
          setPairing(false);
          void refreshHosts();
          void connection.connect(h);
        }}
      />
    ) : (
      <Main onAddComputer={() => setPairing(true)} onHostsChanged={() => void refreshHosts()} />
    );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <StatusBar style={prefs.theme === 'dark' ? 'light' : 'dark'} />
      {content}
    </View>
  );
}

function Main({ onAddComputer, onHostsChanged }: { onAddComputer: () => void; onHostsChanged: () => void }) {
  const { c, t, row } = useApp();
  const insets = useSafeAreaInsets();
  const conn = useConnection();
  const [tab, setTab] = useState<Tab>('dashboard');
  const online = conn.status === 'online';

  const screen = (() => {
    switch (tab) {
      case 'dashboard':
        return <DashboardScreen />;
      case 'games':
        return <GamesScreen />;
      case 'input':
        return <TouchpadScreen />;
      case 'power':
        return <PowerScreen />;
      case 'screen':
        return <ScreenScreen />;
      case 'tools':
        return <ToolsScreen />;
      case 'apps':
        return <AppsScreen />;
      case 'audio':
        return <AudioScreen />;
      case 'files':
        return <FilesScreen />;
      case 'macros':
        return <MacrosScreen />;
      case 'settings':
        return <SettingsScreen onAddComputer={onAddComputer} onHostsChanged={onHostsChanged} onOpenAdmin={() => setTab('admin')} />;
      case 'admin':
        return <AdminScreen onSignedOut={() => setTab('settings')} />;
      case 'more':
        return (
          <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
            {MORE.map((m) => (
              <Pressable key={m.id} onPress={() => setTab(m.id)} style={{ flexDirection: row, alignItems: 'center', gap: spacing.lg, backgroundColor: c.card, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: c.cardBorder }}>
                <m.icon color={c.accent} size={24} />
                <Text style={{ color: c.text, fontSize: font.h2, fontWeight: '700' }}>{t(m.label)}</Text>
              </Pressable>
            ))}
          </ScrollView>
        );
    }
  })();

  return (
    <View style={{ flex: 1, paddingTop: insets.top }}>
      {/* Header */}
      <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
        <Logo size={30} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.text, fontWeight: '900', letterSpacing: 3, fontSize: font.body }}>FRISTY</Text>
          <View style={{ flexDirection: row, alignItems: 'center', gap: 6 }}>
            <StatusDot online={online} />
            <Text style={{ color: c.textMuted, fontSize: font.tiny }} numberOfLines={1}>
              {conn.host?.name ?? ''} · {online ? `${t('common.online')}${conn.latency != null ? ` · ${conn.latency} ms` : ''}` : conn.status === 'unauthorized' ? t('common.offline') : t('common.connecting')}
            </Text>
          </View>
        </View>
        <Pressable onPress={() => setTab('settings')} hitSlop={10} accessibilityLabel={t('nav.settings')}>
          <Settings color={c.textMuted} size={22} />
        </Pressable>
      </View>

      <OwnerBanners />
      {conn.status === 'unauthorized' ? (
        <View style={{ flex: 1, padding: spacing.xl, justifyContent: 'center', gap: spacing.md }}>
          <Text style={{ color: c.text, fontSize: font.h1, fontWeight: '800', textAlign: 'center' }}>{t('notif.unauthorized')}</Text>
          <Muted center>{conn.error ?? ''}</Muted>
          <Button label={t('pair.title')} onPress={onAddComputer} />
        </View>
      ) : (
        <View style={{ flex: 1 }}>{screen}</View>
      )}

      {/* Tab bar */}
      <View
        style={{
          position: 'absolute',
          left: spacing.md,
          right: spacing.md,
          bottom: Math.max(insets.bottom, spacing.md),
          flexDirection: row,
          backgroundColor: c.bgElevated,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: c.cardBorder,
          paddingVertical: 8,
          shadowColor: '#000',
          shadowOpacity: 0.35,
          shadowRadius: 20,
          elevation: 12
        }}
      >
        {MAIN_TABS.map((m) => {
          const active = tab === m.id || (m.id === 'more' && MORE.some((x) => x.id === tab));
          return (
            <Pressable key={m.id} onPress={() => setTab(m.id)} style={{ flex: 1, alignItems: 'center', gap: 3 }} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={m.id === 'more' ? 'More' : t(m.label)}>
              <View style={{ backgroundColor: active ? c.accentSoft : 'transparent', paddingHorizontal: 14, paddingVertical: 5, borderRadius: radius.pill }}>
                <m.icon color={active ? c.accent : c.textFaint} size={22} />
              </View>
              <Text style={{ color: active ? c.text : c.textFaint, fontSize: 10, fontWeight: '700' }} numberOfLines={1}>
                {m.id === 'more' ? '•••' : t(m.label)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
