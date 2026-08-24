# UE4SS Runtime Bundle

Bundled runtime: UE4SS v3.0.1 latest release candidate `1028-gd7e7826d`

Source archive:

```text
UE4SS_v3.0.1-1028-gd7e7826d.zip
```

Source archive SHA-256:

```text
342d893c3f64cb36b88ac4d58cefc1dd8571b9e37b03f86b793f63955ccc2c0b
```

UE4SS is distributed by the UE4SS-RE project under the MIT License. The
provided release archive contains `ue4ss/LICENSE`; CMM keeps this notice with
the packaged runtime for source, hash, and validation scope.

Included for packaged runtime validation and first-run convenience as the
packaged default runtime source. CMM copies this directory into Electron
`userData/runtime/ue4ss/<version>/` before deployment when packaged runtime
updates are enabled or explicitly requested.

This bundled runtime is structurally packaged but has not been live validated as
CMM's current default against the current Clawed build in this revision. CMM
must surface that boundary as unvalidated and must not report `VALIDATED` until
the packaged-runtime validation flow records normal Clawed close, vanilla
restoration, and a matching UE4SS marker for the detected build or fingerprint.

CMM's packaged baseline `ue4ss/Mods/mods.txt` intentionally disables the
included universal cheat manager, console command, console enabler, trace, and
split-screen modules. Blueprint mod loader support remains enabled so packaged
mods can be tested without enabling debug or cheat-oriented universal modules by
default.
