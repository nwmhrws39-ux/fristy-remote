# Building the Android app (APK)

The mobile app is an Expo SDK 58 project that uses a native UDP module
(`react-native-udp`, for discovery and Wake-on-LAN). It therefore runs in a **development
build** or a release build, **not in Expo Go**.

## Option A – EAS Build (cloud, simplest)

```bash
npm ci
npm i -g eas-cli
cd apps/mobile
eas login
eas init                    # creates the EAS project and fills extra.eas.projectId
eas build -p android --profile preview      # installable .apk
# or: eas build -p android --profile production   # .aab for Google Play
```

Profiles are defined in `apps/mobile/eas.json`:

| Profile | Output | Use |
|---|---|---|
| `development` | APK with dev client | day-to-day development with `npm run mobile:start` |
| `preview` | release APK | side-loading / testers |
| `production` | AAB | Google Play |

## Option B – Local build

Requirements: JDK 17, Android Studio (SDK 35+, NDK), `ANDROID_HOME` set.

```bash
npm ci
cd apps/mobile
npx expo prebuild -p android
cd android
./gradlew assembleRelease        # APK: android/app/build/outputs/apk/release/app-release.apk
```

For a signed release, create a keystore and configure `android/app/build.gradle` signing
configs, or let EAS manage credentials. Keep the keystore private.

## Development loop

```bash
cd apps/mobile
npx expo run:android            # builds + installs the dev client on a device/emulator
npm run start                   # Metro with --dev-client
```

## Notes

- `usesCleartextTraffic` is enabled so the app can open `ws://` to the PC on the LAN. All
  payloads are end-to-end encrypted at the application layer (see SECURITY.md).
- Permissions: camera (QR only), notifications, network/Wi-Fi state, multicast (discovery).
  Microphone and location are explicitly blocked.
- The phone and PC must be on the same network for LAN mode. Enable the relay on the PC for
  access from mobile data.
