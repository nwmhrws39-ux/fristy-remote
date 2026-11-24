# Wake-on-LAN

FRISTY Remote can switch on a sleeping, hibernating or powered-off PC by sending a standard
"magic packet" (6 × `0xFF`, then the MAC address 16 times) to UDP ports 9 and 7 on the LAN
broadcast address. Whether the PC wakes depends **entirely on its hardware and settings**.
The app cannot change these for you.

## Requirements

1. **Wired Ethernet.** Most Wi-Fi adapters cannot wake a PC (Wake-on-WLAN is rare and
   unreliable). FRISTY Remote picks the wired adapter's MAC automatically when one exists.
2. **BIOS/UEFI:** enable the option named *Wake on LAN*, *Power On By PCI-E/PCI*,
   *Resume by LAN* or similar. On some boards you must also disable *ErP / EuP Ready /
   Deep Sleep*, because that cuts power to the network card in S5.
3. **Windows Device Manager → your Ethernet adapter → Properties:**
   - *Power Management*: tick **Allow this device to wake the computer** and
     **Only allow a magic packet to wake the computer**.
   - *Advanced*: set **Wake on Magic Packet** = Enabled (and *Shutdown Wake-On-Lan* =
     Enabled if present).
4. **Waking from full shutdown:** disable **Fast Startup**
   (Control Panel → Power Options → Choose what the power buttons do → uncheck
   *Turn on fast startup*). Fast Startup is a hybrid hibernate that many NICs do not wake from.
5. **Same network.** The phone must be on the same LAN/subnet. Routers do not forward
   broadcast packets from the internet, so the relay cannot wake a PC. (Advanced users can
   configure their router for directed broadcast or use a LAN device as a WoL proxy; this is
   outside FRISTY Remote's scope.)
6. **Phone build:** WoL uses a native UDP module, so it needs the FRISTY development or
   release build, not Expo Go. **iOS** requires Apple's multicast networking entitlement
   (`com.apple.developer.networking.multicast`) to send broadcast packets. Request it from
   Apple for App Store builds.

## How the phone learns the MAC address

When a device with the *System monitor* permission connects, the PC reports the MAC and
broadcast address of its best adapter. The phone stores them, so it can send the packet
later while the PC is off.

## Troubleshooting

- Check the Power screen: it shows the stored MAC/broadcast address.
- Test from another tool (e.g. `wakeonlan` on Linux) to separate hardware issues from app issues.
- Some laptops only support WoL while plugged into AC power.
- Check that the link LEDs on the network port stay lit while the PC is off. If they don't,
  the NIC has no standby power (see BIOS ErP setting).
