# VisionMitra — Frontend

The Expo / React Native client for VisionMitra, an accessibility-first AI
mobility assistant for visually impaired users.

For the full system overview, architecture, and API reference, see the
[repository README](../README.md) and the [setup guide](../SETUP.md).

## Requirements

- Node.js 18+
- Yarn 1.x (this package is yarn-managed; `packageManager` is pinned in
  `package.json`)
- Expo Go on a device, or an Android/iOS emulator

## Getting started

```bash
yarn install
yarn start
```

Then press `a` (Android emulator), `i` (iOS simulator), or scan the QR code with
Expo Go. The backend URL is read from `EXPO_PUBLIC_BACKEND_URL`; copy
`.env.example` to `.env` and set it to an address your device can reach
(`10.0.2.2` for the Android emulator, `127.0.0.1` for the iOS simulator, or your
LAN IP for a physical device).

## Scripts

| Command | Description |
| --- | --- |
| `yarn start` | Start the Expo dev server |
| `yarn android` / `yarn ios` / `yarn web` | Start for a specific platform |
| `yarn typecheck` | Run `tsc --noEmit` |
| `yarn lint` | Run ESLint (`expo lint`) |
| `yarn reset-project` | Reset to the bare Expo starter (template utility) |

## Structure

```text
frontend/
├── app/                 # Screens (file-based routing via expo-router)
│   ├── index.tsx        # Home menu
│   ├── camera.tsx       # Live obstacle detection + segment navigation
│   ├── navigate.tsx     # Destination entry + journey planning
│   ├── emergency.tsx    # Emergency contacts + SOS
│   └── settings.tsx     # Preferences and device info
├── utils/
│   ├── api.ts           # Backend base URL + request helper (with fallback)
│   ├── types.ts         # Shared API payload types
│   ├── journeyPlanner.ts# Journey planning + Overpass/Nominatim access
│   └── sosService.ts    # Emergency SMS/location flow
├── scripts/             # Manual smoke scripts
└── store.ts             # Global Zustand state
```

The backend base URL is resolved centrally in `utils/api.ts`; avoid reading
`process.env.EXPO_PUBLIC_BACKEND_URL` directly in screens.
