# Building the iOS app

Requirements: a Mac with Xcode 16+ (or EAS Build in the cloud), an Apple Developer account,
and Node 22.

## Free option – GitHub build + Sideloadly (no Mac, no paid account)

1. GitHub → **Actions → "iOS app (unsigned .ipa)"** → latest run → download the
   **FRISTY-Remote-iOS** artifact and unzip it (`FRISTY-Remote-unsigned.ipa`).
   (Run it manually with **Run workflow** if there is no run yet.)
2. On Windows install **iTunes** and **iCloud** from apple.com (not the Microsoft Store
   versions), then **Sideloadly** (sideloadly.io).
3. Connect the iPhone by cable, tap **Trust** on the phone, drag the `.ipa` into Sideloadly,
   enter your normal Apple ID and click **Start**.
4. On the iPhone: **Settings → General → VPN & Device Management** → trust your Apple ID;
   **Settings → Privacy & Security → Developer Mode** → on (restart).

Limits of a free Apple ID: the app must be **re-installed every 7 days** (Sideloadly can
refresh automatically while the PC is on) and you can have up to 3 such apps. Push
notifications are not available; FRISTY's local notifications still work.

## Option A – EAS Build

```bash
npm ci
npm i -g eas-cli
cd apps/mobile
eas login
eas init
eas build -p ios --profile development   # dev client for registered devices
eas build -p ios --profile production    # App Store / TestFlight
eas submit -p ios                         # upload to App Store Connect
```

EAS can create and manage certificates and provisioning profiles for you.

## Option B – Local Xcode build

```bash
npm ci
cd apps/mobile
npx expo prebuild -p ios
cd ios && pod install && cd ..
npx expo run:ios --device        # or open ios/FRISTYRemote.xcworkspace in Xcode
```

Set the signing team in Xcode (Signing & Capabilities). The bundle id is `com.fristy.remote`.

## iOS-specific requirements

| Topic | Details |
|---|---|
| Local network permission | iOS asks the first time the app contacts the PC (`NSLocalNetworkUsageDescription` is set). If denied, enable it in Settings → Privacy → Local Network |
| LAN discovery and Wake-on-LAN | Sending UDP broadcast needs the **multicast networking entitlement** `com.apple.developer.networking.multicast`. Request it from Apple, then add it to the app's entitlements (`ios.entitlements` in `app.json`). Without it, use QR pairing / manual IP; Wake-on-LAN will not work on iOS |
| ATS | `NSAllowsLocalNetworking` allows `ws://` to LAN addresses. Payloads are end-to-end encrypted; relay connections use `wss://` |
| Encryption export compliance | `ITSAppUsesNonExemptEncryption` is `true` (the app implements end-to-end encryption). Answer App Store Connect's export questions accordingly |
| Background | iOS suspends the WebSocket shortly after the app goes to the background; the app reconnects when it returns to the foreground. Alerts arrive while the app is active or briefly in the background |
