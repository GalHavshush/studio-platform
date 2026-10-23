# Studio app

Expo (React Native, TypeScript) client for the studio API. Screens live in `src/app` (file-based routing with expo-router).

```bash
npm install            # first time
npx expo start         # dev server; press i for the iOS simulator
npm run typecheck      # tsc --noEmit (also runs in CI)
npx expo-doctor        # checks the project's dependencies against the SDK
```

Expo changes between SDK releases: check the docs for the SDK in `package.json` before using an API (see `AGENTS.md`).
