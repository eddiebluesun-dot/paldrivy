# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Node version

Pinned to **Node 24.14.0** via `.nvmrc`, managed through `nvm4w` (`nvm use` in this directory picks it up). Do not build/run with an older Node on PATH — the Gradle Android build shells out to `node` directly, and Node 18 fails with `TypeError: parseEnv is not a function` because `@expo/env` requires Node ≥20.6's `util.parseEnv`. If `node`/`npm` aren't resolving, check that the `nvm4w` symlink at `C:\nvm4w\nodejs` points at 24.14.0, not an older version.
