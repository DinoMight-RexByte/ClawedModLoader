# UE4SS Runtime Bundle

Bundled runtime: UE4SS v3.0.1 long-term support release

Source archive:

```text
UE4SS_v3.0.1.zip
```

Source release:

```text
https://github.com/UE4SS-RE/RE-UE4SS/releases/tag/v3.0.1
```

Source archive SHA-256:

```text
4b47d4bceddd2f561a4e395bfa00924ccfc945af576a2d0c613e6537846c57ec
```

UE4SS is distributed by the UE4SS-RE project under the MIT License. The
provided release archive contains `README.md` and `Changelog.md`; CMM keeps
this notice with the packaged runtime for source, hash, and validation scope.

Included for first-run convenience as the packaged default runtime source.
CMM copies this directory into Electron `userData/runtime/ue4ss/<version>/`
before deployment when packaged runtime updates are enabled or explicitly
requested.

This bundled v3.0.1 runtime is structurally packaged but has not been live
validated as CMM's current default against the current Clawed build in this
revision. CMM must surface that boundary as unvalidated and must not block
Launch Modded solely because the installed runtime is different from this
packaged default or lacks current validation evidence.

CMM's packaged baseline `Mods/mods.txt` intentionally disables the universal
cheat manager, console command, console enabler, actor dumper, trace,
split-screen, and profiler modules. Blueprint mod loader support remains
enabled so packaged mods can be tested without enabling debug or cheat-oriented
universal modules by default.
