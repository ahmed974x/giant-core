# Local HTTPS for the phone (Caddy)

Caddy 2.11.7 (Apache-2.0, one 53 MB binary, ~20 MB RAM) puts the OMEGA web app on the home Wi-Fi over HTTPS, so the
phone gets the full app including **My location** and **AR mode**, which browsers only allow on secure origins.

- The app stays on `127.0.0.1:3100`; only Caddy listens on the LAN (`:8443` HTTPS, `:8480` plain HTTP that serves only
  the public root certificate).
- Certificates come from Caddy's own local CA (`tls internal`); nothing is requested from the internet, and the Windows
  trust store is not touched (`skip_install_trust`).
- Binary: `OMEGA_PRIME_PROJECT/tools/caddy/bin/caddy.exe`, SHA-512 checked against the official release checksums.
  CA files live in `tools/caddy/data` (outside git; `root.key` never leaves the laptop).

## Start

```powershell
powershell -ExecutionPolicy Bypass -File ops\caddy\start-https.ps1
```

It prints the two phone URLs for the laptop's current Wi-Fi address.

## One-time setup on the laptop (Ahmad)

Windows Firewall blocks Caddy until you allow it. The Wi-Fi is currently marked **Public**, which blocks local devices:

1. Settings → Network & internet → Wi-Fi → your network → **Network profile type: Private**.
2. Windows Security → Firewall & network protection → **Allow an app through firewall** → Change settings →
   find **caddy.exe** → tick **Private** only (leave Public unticked).

## One-time setup on the phone

1. Open `http://<laptop-ip>:8480/omega-root.crt` and install it.
   - iPhone: Settings → General → VPN & Device Management → install the profile, then Settings → General → About →
     Certificate Trust Settings → enable **Caddy Local Authority**.
   - Android: Settings → Security → Encryption & credentials → Install a certificate → **CA certificate**.
2. Open `https://<laptop-ip>:8443` and add it to the home screen.

Trusting this root means the laptop can issue certificates your phone accepts; remove it from the phone if the laptop
is ever lost or shared.
