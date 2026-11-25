# Using FRISTY Remote away from home (free)

The easiest free way is **Tailscale**, a private encrypted network between your own devices.
It needs no router setup, no open ports and no server of your own. (Alternatively you can host
the FRISTY relay, see [RELAY.md](RELAY.md).)

## One-time setup

1. **Install Tailscale on the PC** (tailscale.com/download) and sign in.
2. **Install Tailscale on the iPhone** (App Store) and sign in with **the same account**.
   Allow the VPN configuration when iOS asks.
3. **Install FRISTY Remote 0.1.0+ from the latest CI build** on the PC. The installer adds a
   firewall rule that accepts connections only from Tailscale peers (`100.64.0.0/10`). If you
   installed an older build, reinstall it, or run this once in an **administrator** command prompt:

   ```bat
   netsh advfirewall firewall add rule name="FRISTY Remote" dir=in action=allow program="C:\Program Files\FRISTY Remote\FRISTY Remote.exe" enable=yes profile=any protocol=TCP localport=47800 remoteip=100.64.0.0/10
   ```

4. **At home, open the phone app once while it is connected.** The PC reports its Tailscale
   address, and the phone remembers it. On the PC, **Settings → Diagnostics → Tailscale** shows
   the address it advertises.

## Daily use

Turn on Tailscale on the iPhone (it can stay on). Open FRISTY Remote: it first tries the home
addresses, then the Tailscale address. The dashboard shows **Tailscale** as the route. The PC
must be on, with FRISTY Remote and Tailscale running.

## Notes

- Security is unchanged. Every connection still uses FRISTY's end-to-end encryption, device
  authentication and permissions; Tailscale adds a second encrypted layer.
- Wake-on-LAN does not work through Tailscale. A sleeping/off PC cannot be woken from outside.
- Expo Go loads the app from the PC's development server, so it is not suitable away from
  home. Install the real app ([BUILD_IOS.md](BUILD_IOS.md)).
