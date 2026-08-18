# UE4SS Runtime Bundle

Bundled runtime: UE4SS `experimental-latest`

Source archive:

```text
UE4SS_v3.0.1-1021-g1c1a1497.zip
```

Source release:

```text
https://github.com/UE4SS-RE/RE-UE4SS/releases/tag/experimental-latest
```

Source archive SHA-256:

```text
eb7408f62b7ed9a62c1ce71eb2631980cb23f4d510d2a3eba8dc79fc35780fb6
```

Included for first-run convenience as the packaged default runtime source.
CMM copies this directory into Electron `userData/runtime/ue4ss/<version>/`
before deployment.

Release validation on 2026-08-13 against Clawed Steam build `24719259`
confirmed this candidate loads from the official nested layout, starts a
minimal read-only Lua mod, runs `ExecuteInGameThread`, and resolves
`FindFirstOf("GameEngine")`.

Runtime-feature revalidation on 2026-08-15 against Clawed Steam build
`24742251` confirmed the same packaged candidate reaches Lua startup and
single-client UE4SS hook callbacks.

The packaged `assets/runtime/ue4ss/default` copy was revalidated after bundling.
Evidence is under:

```text
.codex\live-validation\20260813-190009-packaged-default\
```

CMM's packaged baseline `ue4ss/Mods/mods.txt` intentionally disables the
universal cheat manager, console command, console enabler, trace, and
split-screen modules. Blueprint mod loader support remains enabled so packaged
mods can be tested without enabling debug or cheat-oriented universal modules
by default.

The `zDEV-UE4SS_v3.0.1-1021-g1c1a1497.zip`, `zCustomGameConfigs.zip`, and
`zMapGenBP.zip` archives were not bundled because they contain development
symbols/templates, configs for unrelated games, or MapGen assets that are not
required for the default Clawed runtime path.
