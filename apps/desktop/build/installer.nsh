; FRISTY Remote – custom NSIS steps.
; Adds an inbound Windows Firewall rule restricted to PRIVATE networks only, so
; phones on the home network can connect without the user disabling the firewall.
; Public networks (cafés, airports) stay blocked. A second rule admits only
; Tailscale peers (100.64.0.0/10) on any profile, for access away from home.
; Removed on uninstall.

!macro customInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="FRISTY Remote"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="FRISTY Remote" dir=in action=allow program="$INSTDIR\FRISTY Remote.exe" enable=yes profile=private protocol=TCP localport=47800'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="FRISTY Remote" dir=in action=allow program="$INSTDIR\FRISTY Remote.exe" enable=yes profile=private protocol=UDP localport=47801'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="FRISTY Remote" dir=in action=allow program="$INSTDIR\FRISTY Remote.exe" enable=yes profile=any protocol=TCP localport=47800 remoteip=100.64.0.0/10'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="FRISTY Remote"'
!macroend
