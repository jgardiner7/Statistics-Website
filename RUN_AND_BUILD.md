# StatsFish: Build, Run, and Verify

## 1. Prerequisites

- Node.js `18+` (`20+` recommended)
- npm (bundled with Node)
- Modern desktop browser (Chrome/Edge/Firefox)

## 2. Install Dependencies

From project root:

```bash
cd /path/to/StatsFish
npm install
```

## 3. Run Development Server

Default local run:

```bash
npm run dev
```

Vite prints local and (when enabled) network URLs.

## 4. Run So Other Devices on Your LAN Can Access It

```bash
npm run dev -- --host 0.0.0.0 --port 5173
```

Then open either:

- Local: `http://localhost:5173`
- LAN device: `http://<your-machine-LAN-IP>:5173`

Notes:

- Use the exact Network URL printed by Vite when possible.
- Ensure your firewall allows inbound connections on the selected port.
- Devices must be on the same network/subnet.

## 5. Build Production Bundle

```bash
npm run build
```

Output is written to `dist/`.

## 6. Preview Production Bundle Locally

```bash
npm run preview -- --host 0.0.0.0 --port 4173
```

Then open `http://localhost:4173` (or LAN URL on another device).

## 7. Run Tests

Run all tests once:

```bash
npm run test -- --run
```

Watch mode:

```bash
npm run test:watch
```

## 8. Recommended Verification Sequence

```bash
npm install
npm run test -- --run
npm run build
npm run dev -- --host 0.0.0.0 --port 5173
```

## 9. Common Issues

### Port already in use

Run on another port:

```bash
npm run dev -- --host 0.0.0.0 --port 5174
```

### Browser says OPFS unavailable

This is expected in environments without OPFS support. The app falls back to IndexedDB mode.

### Import rejected due V1 caps

The app shows an import-limit modal. You can cancel or import a sampled subset (`200,000` rows/file max).

### LAN URL not reachable

- Confirm Vite was started with `--host 0.0.0.0`
- Use your machine’s LAN IP (not loopback)
- Check firewall/network policy

