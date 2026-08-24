# Runtime Incompatible Validation Fix Plan

## Goal

Superseded: the LTS-only direction failed safely on the current Clawed build.
The packaged runtime now pivots to `ue4ss-v3.0.1-1028-gd7e7826d` and CMM
validation must produce a real `VALIDATED` state only when that pinned runtime
works against the detected Clawed build.

## Current Evidence

- The Play-page validation flow can launch the packaged runtime validation path
  and record scoped runtime evidence.
- A live validation just returned `runtime incompatible`.
- Historical project evidence indicates stock UE4SS v3.0.1 can fail Clawed
  startup before Lua markers are reached, so the next fix must start from the
  validation evidence rather than assuming this is only a UI/state bug.
- 2026-08-22 evidence
  `C:\Users\Jason\AppData\Roaming\clawed-mod-manager\logs\runtime-validation\2026-08-22T22-57-54-797Z`
  repeated the same scoped failure on Steam build `24782175`: UE4SS v3.0.1
  detected UE `5.5`, missed `GUObjectArray` and
  `FText::FText(FString&&)`, timed out the pattern scan, then CMM restored
  vanilla successfully.
- Static Clawed executable checks found later upstream GUObjectArray-style
  patterns that resolve to the same `.data` address, but no verified
  `FText::FText(FString&&)` target. A generic FText byte sequence appears
  inside a larger function and is not safe to return as a v3.0.1
  `FText_Constructor.lua` address.

## Fix Plan

1. Collect the latest validation evidence folder from CMM logs, especially
   `deployment-result.json`, `UE4SS-packaged-runtime-failure.log`, and
   `runtime-validation-recording.json` if present.
2. Identify the exact failure mode: marker timeout, UE4SS pattern scan failure,
   proxy/layout load failure, Clawed launch detection failure, or restore
   failure.
3. If v3.0.1 loads but fails UE4SS signatures or object discovery, test only
   pinned-runtime fixes first: UE4SS settings, supported custom game config,
   mappings placement, safe marker timing changes, or a newer pinned UE4SS
   release candidate. Do not mark any runtime `VALIDATED` without live evidence.
   - Do not ship guessed `FText_Constructor.lua` overrides. UE4SS v3.0.1
     verifies the returned FText address by calling it during scan setup, so an
     incorrect address can crash before marker evidence.
4. If the failure is caused by CMM staging or detection, patch the validation
   deployment path and add a mocked regression test that reproduces the failure.
5. If the failure is a real unsupported runtime limitation for the current
   Clawed build, keep Launch Modded non-blocking for unvalidated runtime
   structure, keep the runtime `UNVALIDATED` or `INCOMPATIBLE` based on scoped
   evidence, and surface the evidence path clearly instead of overstating
   validation.
6. Re-run the packaged runtime validation live flow and require normal Clawed
   close plus vanilla restoration before accepting `VALIDATED`.

## Implemented Direction

- The LTS-only direction was superseded after repeated validated-safe failures
  on build `24782175`.
- The packaged default is now `ue4ss-v3.0.1-1028-gd7e7826d` for validation.
- The old LTS scoped incompatibility remains historical evidence, but it is not
  carried forward as metadata for the new packaged runtime artifact.
- A passing live validation must still record normal Clawed close, vanilla
  restoration, and marker evidence before the new runtime can become
  `VALIDATED`.

## Acceptance

- The packaged runtime is `ue4ss-v3.0.1-1028-gd7e7826d`.
- Play still shows `Validate` while the packaged runtime is unvalidated.
- A passing live validation updates CMM runtime state to `VALIDATED` for the
  detected Steam build ID or fingerprint.
- A failing live validation shows the evidence path and does not block normal
  mod creator launch unless runtime structure is invalid or scoped evidence is
  explicitly incompatible.
