# LeoLauncher

Custom Electron launcher for Minecraft Forge 1.20.1. It synchronizes mods from a GitHub repository, ensures Forge is installed, runs an existing ForgeOptiFine build, packages into installers (EXE/DMG/AppImage), and checks GitHub Releases for updates.

## Features
- Syncs required mods from https://github.com/lywebdev/storage (storage-main/m_server/mods).
- Auto-installs/verifies Forge 1.20.1.
- Launches a preconfigured ForgeOptiFine instance via config/launcher.args.
- Builds installers through electron-builder and performs auto-updates with electron-updater.

## Requirements
- Node.js 18+
- npm 9+
- Java 17 available on the system (the custom launch points to %APPDATA%/.minecraft).

## Getting Started
```bash
npm install
npm run dev
```
`npm run dev` runs Electron with devtools; `npm start` launches production mode without hot reload.

## Configuration (config/launcher.config.json)
- `server`: name/address/port shown in the UI and used for quick connect.
- `modsRepo.zipUrl`: archive URL with all required JARs.
- `modsRepo.subfolder`: directory (inside the archive) that contains the `.jar` files.
- `forge`: Minecraft version, Forge version, installer URL, generated profile name.
- `java`: default min/max RAM and Java executable fallback.
- `customLaunch`: controls the external Java command. By default launcher.args is copied into `.minecraft/leo-launcher.args` and executed via `javaw.exe @leo-launcher.args`.

`src/main/modManager.js` downloads the archive into `.launcher/mods-repo` and mirrors its contents into `.minecraft/mods` while preserving existing user mods.

## Packaging Source Bundle
```bash
npm run package
```
Creates `release/leo-launcher/` and `release/leo-launcher.zip` with `src/`, `config/`, `package*.json`, and README for manual distribution.

## Desktop Builds (EXE/DMG/AppImage)
1. Place icons in `build/icon.ico` (Windows), `build/icon.icns` (macOS), and PNGs in `build/` for Linux.
2. Run `npm run dist`.
3. Installers land in `dist/` (e.g., `LeoLauncher Setup 0.1.0.exe`). Default install path is `C:\Program Files\LeoLauncher`, but the user can change it (`oneClick=false`, `perMachine=true`).

## Auto Updates via GitHub Releases
1. Update the `version` field in `package.json` (the value is also shown inside the launcher UI under the logo).
2. Create a GitHub token with `repo` scope and set `GH_TOKEN` in your shell (`setx GH_TOKEN <token>` on PowerShell, re-open the terminal).
3. Run one of the release scripts:
   - `npm run release:patch` — bump patch version (0.1.x → 0.1.x+1) and publish.
   - `npm run release:minor` — bump minor version (0.x.y → 0.(x+1).0) and publish.
   - `npm run release:major` — bump major version (x.y.z → (x+1).0.0) and publish.
   Each script updates `package.json`/`package-lock.json`, rebuilds installers, and uploads them via `npm run release`.
4. Review/publish the draft release on GitHub. Users who start the previous version will automatically download and install the new build after the launcher exits.

If you prefer to upload artifacts manually, take the generated `LeoLauncher Setup <version>.exe`, `LeoLauncher Setup <version>.exe.blockmap`, and `latest.yml` from `dist/` and attach them to a GitHub Release. `electron-updater` only needs those three files.

## Useful npm Scripts
| Script | Description |
|--------|-------------|
| `npm run dev` | Start Electron in development mode. |
| `npm start` | Launch Electron in production mode. |
| `npm run package` | Create `release/leo-launcher.zip` with sources/config. |
| `npm run dist` | Build installers via electron-builder (NSIS on Windows). |
| `npm run release` | Build and publish installers to GitHub Releases (requires `GH_TOKEN`). |
| `npm run release:patch` | Bump patch version and publish via auto-update. |
| `npm run release:minor` | Bump minor version and publish via auto-update. |
| `npm run release:major` | Bump major version and publish via auto-update. |

## Notes
- Ensure ForgeOptiFine resources already exist in `%APPDATA%/.minecraft` (paths referenced in `launcher.args`).
- Mods in GitHub should be updated whenever the server modpack changes.
- Launcher logs (including updater status) are sent to the renderer via the `launcher:log` IPC channel.
