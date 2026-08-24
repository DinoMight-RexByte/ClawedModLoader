# CMM Unreal Decoder

Publish the CUE4Parse sidecar here with `npm run build:unreal-decoder`.

The Electron main process looks for `CmmUnrealDecoder.exe` in this directory during development and under `resources/unreal-decoder/` in packaged builds. `CMM_CUE4PARSE_DECODER_PATH` can point to a different sidecar during local testing.

Cooked Unreal packages with unversioned properties also need a matching `.usmap`. Set `CMM_CUE4PARSE_MAPPINGS`, place the file under `mappings/` beside the decoder, or leave a UE4SS-generated `Mappings.usmap` beside the Clawed executable or under its `ue4ss/` directory. Filenames containing `clawed` are preferred automatically in the decoder `mappings/` directory.
