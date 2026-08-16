# Android native build setup (Windows + Google Drive)

This project's source lives inside a Google Drive-synced folder. Building the
native Android app there hits two problems Google Drive itself causes:

1. **File locking** — Drive's sync client locks files it's actively
   uploading/hashing, and Gradle/CMake write huge numbers of files during a
   native build. A locked file mid-write breaks the build non-deterministically.
2. **Windows `MAX_PATH` (260 chars)** — CMake's `.cxx` staging directory path
   gets long fast once it's nested inside a deeply-pathed Google Drive folder,
   and Windows silently truncates/fails on paths past 260 characters.

The fix is redirecting Gradle/CMake build output to `D:/build/paldrivy/`
(outside Drive, same drive as the source for speed) instead of the default
locations inside the project. Because of that, this project deviates from a
pure Expo "continuous native generation" setup: `android/` is normally fully
regenerable from `app.json` via `npx expo prebuild`, but three specific files
inside it are hand-maintained and are **not** safe to lose.

## The three tracked files

`android/` is gitignored (it's expected to be regenerable), but these three
are explicit exceptions in `.gitignore` and ARE committed:

- **`android/build.gradle`** — root-level Gradle config. Redirects
  `subprojects` buildDir to `D:/build/paldrivy/libs/<name>` (deliberately
  `subprojects`, not `allprojects` — see the comment in the file for why
  that distinction caused a real production crash on 2026-08-15).
- **`android/app/build.gradle`** — the app module's Gradle config. Holds the
  real `versionCode`/`versionName` (the actual source of truth Gradle reads —
  `app.json`'s `expo.android.versionCode`/`expo.version` must be kept in sync
  with it by hand, they've drifted before), the release signing config
  (reads the keystore password from `local.properties`, never hardcoded),
  and its own `buildDir` redirect to `D:/build/paldrivy/app`.
- **`android/init.d/redirect-build.gradle`** — **reference copy only**. Gradle
  init scripts are inherently machine/user-level, not project-level, so this
  file is not read by Gradle from here — see the setup step below.

## One-time setup on any machine (fresh clone, or after `expo prebuild --clean`)

1. Clone/prebuild normally. The two `build.gradle` files above already exist
   in the checkout (git-tracked) or need to be restored if `expo prebuild`
   overwrote them — diff against git and reapply if so.
2. Copy the Gradle init script to its real, global location — Gradle reads
   `~/.gradle/init.d/*.gradle` for every build on the machine, project or not:

   ```powershell
   Copy-Item "android\init.d\redirect-build.gradle" "$env:USERPROFILE\.gradle\init.d\paldrivy-redirect.gradle"
   ```

   This step has no automated enforcement — nothing will warn you if this
   file is missing or stale on a given machine. If a native module gets
   added and its build starts failing with a CMake "not an existing
   directory" error, or a module crashes at runtime with
   `TurboModuleRegistry.getEnforcing(...): '<Module>' could not be found`,
   check this file is present and up to date with the in-repo copy first.
3. Build as usual: `$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"`,
   then `gradlew bundleRelease --no-daemon --console=plain` from `android/`.

## If a new native module needs the same buildDir-redirect exception

`@react-native-community/datetimepicker` is excluded from the redirect in
**both** `android/build.gradle`'s `subprojects` block and
`android/init.d/redirect-build.gradle`'s node_modules check, because its own
Gradle codegen writes output relative to `project.buildDir` while React
Native's autolinking hardcodes CMake to look for that output at the
*default*, unredirected path. Any future native dependency with its own
Gradle-level codegen (not just a precompiled native library) could hit the
same failure mode — if a new module's build fails with a CMake
"add_subdirectory ... which is not an existing directory" error, add it to
the exclusion in both files, matching the existing `datetimepicker` pattern.
