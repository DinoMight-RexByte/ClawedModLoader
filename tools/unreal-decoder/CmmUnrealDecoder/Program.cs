using System.Buffers.Binary;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using CUE4Parse.Compression;
using CUE4Parse.Encryption.Aes;
using CUE4Parse.FileProvider;
using CUE4Parse.MappingsProvider.Usmap;
using CUE4Parse.UE4.Assets;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Animation;
using CUE4Parse.UE4.Assets.Exports.Nanite;
using CUE4Parse.UE4.Assets.Exports.SkeletalMesh;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.UE4.Objects.Engine;
using CUE4Parse.UE4.Objects.UObject;
using CUE4Parse.UE4.Versions;
using CUE4Parse_Conversion;
using CUE4Parse_Conversion.Meshes;

var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
};

try
{
    var input = await Console.In.ReadToEndAsync();
    var request = JsonSerializer.Deserialize<DecodeRequest>(input, jsonOptions);
    var response = request is null
        ? DecodeResponse.Fail("decode-error", "CUE4PARSE_INVALID_REQUEST", "The decoder request was empty or invalid.")
        : await DecodeAsync(request);
    Console.Out.Write(JsonSerializer.Serialize(response, jsonOptions));
    return 0;
}
catch (Exception error)
{
    Console.Out.Write(JsonSerializer.Serialize(
        DecodeResponse.Fail("decode-error", "CUE4PARSE_DECODER_EXCEPTION", "The decoder failed before returning a result.", SafeDetail(error)),
        jsonOptions));
    return 0;
}

static async Task<DecodeResponse> DecodeAsync(DecodeRequest request)
{
    if (request.SchemaVersion != 1)
        return DecodeResponse.Fail("unsupported", "CUE4PARSE_SCHEMA_UNSUPPORTED", "The decoder request schema is not supported.", request.SchemaVersion.ToString());

    if (string.IsNullOrWhiteSpace(request.ArchiveRoot) || !Directory.Exists(request.ArchiveRoot))
        return DecodeResponse.Fail("dependency-missing", "CUE4PARSE_ARCHIVE_ROOT_MISSING", "The game archive directory could not be read.");

    if (string.IsNullOrWhiteSpace(request.OutputRoot))
        return DecodeResponse.Fail("decode-error", "CUE4PARSE_OUTPUT_ROOT_MISSING", "The decoder output directory was not provided.");

    Directory.CreateDirectory(request.OutputRoot);
    var outputRoot = Path.GetFullPath(request.OutputRoot);
    var loadPath = FirstText(request.ObjectPath, request.PackagePath, request.RelativePath);
    if (loadPath is null)
        return DecodeResponse.Fail("decode-error", "CUE4PARSE_ASSET_PATH_MISSING", "No Unreal object path was provided.");

    var mode = (request.Mode ?? "decode").Trim().ToLowerInvariant();
    if (mode is not "decode" and not "classify")
        return DecodeResponse.Fail("unsupported", "CUE4PARSE_MODE_UNSUPPORTED", "The requested decoder mode is not supported.", mode);

    var format = (request.Format ?? "").Trim().ToLowerInvariant();
    if (!IsSupportedRequest(format, request.AssetClass, mode))
        return DecodeResponse.Fail("unsupported", "CUE4PARSE_OUTPUT_FORMAT_UNSUPPORTED", "The requested output format is not supported for this asset class.", $"{request.AssetClass ?? "unknown"} -> {format}");

    PropertyUtil.SearchPropertyInTemplate = true;
    await ZlibHelper.InitializeAsync();
    await OodleHelper.InitializeAsync();
    using var provider = new DefaultFileProvider(
        request.ArchiveRoot,
        SearchOption.AllDirectories,
        new VersionContainer(ParseGame(request.UnrealVersion)),
        StringComparer.OrdinalIgnoreCase);

    if (!string.IsNullOrWhiteSpace(request.MappingsPath) && File.Exists(request.MappingsPath))
        provider.MappingsContainer = new FileUsmapTypeMappingsProvider(request.MappingsPath);

    provider.Initialize();
    var registeredArchives = RegisterVfsArchives(provider, request.ArchiveRoot);

    if (!string.IsNullOrWhiteSpace(request.AesKey))
        await provider.SubmitKeyAsync(new FGuid(), new FAesKey(request.AesKey));

    var mountedArchives = registeredArchives > 0 ? provider.Mount() : 0;
    provider.PostMount();
    provider.LoadVirtualPaths();

    UObject? asset;
    try
    {
        asset = LoadRequestedObject(provider, request, format);
    }
    catch (Exception error) when (IsMappingsMissing(error))
    {
        return DecodeResponse.Fail("dependency-missing", "CUE4PARSE_MAPPINGS_REQUIRED", "A Clawed .usmap mapping file is required before cooked Unreal models can be decoded.", SafeDetail(error));
    }
    catch (Exception error)
    {
        return DecodeResponse.Fail("decode-error", "CUE4PARSE_ASSET_LOAD_FAILED", "The Unreal asset could not be loaded.", SafeDetail(error));
    }

    if (asset is null)
        return DecodeResponse.Fail("dependency-missing", "CUE4PARSE_ASSET_NOT_FOUND", "The Unreal asset could not be found in the mounted game archives.", $"{loadPath}; mountedFiles={provider.Files.Count}; registeredArchives={registeredArchives}; mountedArchives={mountedArchives}");

    if (mode == "classify")
        return ClassifyAsset(asset);

    return asset switch
    {
        UStaticMesh mesh when format is "glb" or "obj" => await ExportMeshAsync(mesh, outputRoot, format, MeshMetadata(mesh)),
        USkeletalMesh mesh when format is "glb" or "obj" => await ExportMeshAsync(mesh, outputRoot, format, SkeletalMeshMetadata(mesh)),
        USkeleton skeleton when format == "gltf" => ExportSkeleton(skeleton, outputRoot),
        _ => DecodeResponse.Fail("unsupported", "CUE4PARSE_ASSET_CLASS_UNSUPPORTED", "The loaded Unreal asset class is not supported for viewport export.", asset.GetType().Name)
    };
}

static int RegisterVfsArchives(DefaultFileProvider provider, string archiveRoot)
{
    var count = 0;
    foreach (var file in Directory.EnumerateFiles(archiveRoot, "*", SearchOption.AllDirectories)
        .Where(IsVfsArchive)
        .OrderBy(VfsArchivePriority)
        .ThenBy(Path.GetFileName, StringComparer.OrdinalIgnoreCase))
    {
        try
        {
            provider.RegisterVfs(file);
            count++;
        }
        catch
        {
        }
    }
    return count;
}

static bool IsVfsArchive(string file) =>
    Path.GetExtension(file).Equals(".utoc", StringComparison.OrdinalIgnoreCase) ||
    Path.GetExtension(file).Equals(".pak", StringComparison.OrdinalIgnoreCase);

static int VfsArchivePriority(string file) =>
    Path.GetExtension(file).Equals(".utoc", StringComparison.OrdinalIgnoreCase) ? 0 : 1;

static UObject? LoadRequestedObject(DefaultFileProvider provider, DecodeRequest request, string format)
{
    foreach (var path in ObjectPathCandidates(request))
    {
        var asset = provider.SafeLoadPackageObject(path);
        if (asset is not null && IsSupportedAssetForFormat(asset, format))
            return asset;
    }

    foreach (var path in PackagePathCandidates(request))
    {
        UObject? asset;
        try
        {
            asset = SelectRequestedAsset(provider.LoadPackage(path).GetExports(), request, format);
        }
        catch (Exception error) when (!IsMappingsMissing(error))
        {
            continue;
        }
        if (asset is not null)
            return asset;
    }

    return null;
}

static UObject? SelectRequestedAsset(IEnumerable<UObject> assets, DecodeRequest request, string format)
{
    var supported = assets.Where(asset => IsSupportedAssetForFormat(asset, format)).ToArray();
    var requested = supported.Where(asset => IsRequestedAsset(asset, request.AssetClass)).ToArray();
    foreach (var name in ObjectNameCandidates(request))
    {
        var exact = requested.FirstOrDefault(asset =>
            string.Equals(asset.Name, name, StringComparison.OrdinalIgnoreCase)) ??
            supported.FirstOrDefault(asset =>
            string.Equals(asset.Name, name, StringComparison.OrdinalIgnoreCase));
        if (exact is not null)
            return exact;
    }
    return requested.FirstOrDefault() ?? supported.FirstOrDefault();
}

static bool IsRequestedAsset(UObject asset, string? assetClass) =>
    assetClass switch
    {
        "StaticMesh" => asset is UStaticMesh,
        "SkeletalMesh" => asset is USkeletalMesh,
        "Skeleton" => asset is USkeleton,
        _ => true
    };

static bool IsSupportedAssetForFormat(UObject asset, string format) =>
    format switch
    {
        "glb" or "obj" => asset is UStaticMesh or USkeletalMesh,
        "gltf" => asset is USkeleton,
        _ => asset is UStaticMesh or USkeletalMesh or USkeleton
    };

static IEnumerable<string> ObjectPathCandidates(DecodeRequest request) =>
    UniqueText([
        request.ObjectPath,
        ObjectPathFromRelativePath(request.RelativePath)
    ]);

static IEnumerable<string> PackagePathCandidates(DecodeRequest request)
{
    foreach (var path in UniqueText([
        request.PackagePath,
        PackagePathFromObjectPath(request.ObjectPath),
        PackagePathFromRelativePath(request.RelativePath),
        MountedPackagePath(request.PackagePath),
        MountedPackagePath(PackagePathFromObjectPath(request.ObjectPath)),
        request.RelativePath,
        WithoutCookedExtension(request.RelativePath)
    ]))
        yield return path;
}

static IEnumerable<string> ObjectNameCandidates(DecodeRequest request) =>
    UniqueText([
        ObjectNameFromObjectPath(request.ObjectPath),
        ObjectNameFromPackagePath(request.PackagePath),
        ObjectNameFromPackagePath(request.RelativePath)
    ]);

static IEnumerable<string> UniqueText(IEnumerable<string?> values) =>
    values.Select(value => value?.Trim())
        .Where(value => !string.IsNullOrWhiteSpace(value))
        .Select(value => value!)
        .Distinct(StringComparer.OrdinalIgnoreCase);

static string? PackagePathFromObjectPath(string? path)
{
    if (string.IsNullOrWhiteSpace(path))
        return null;
    var dot = path.LastIndexOf('.');
    return dot > 0 ? path[..dot] : path;
}

static string? PackagePathFromRelativePath(string? path)
{
    var withoutExtension = WithoutCookedExtension(path);
    if (withoutExtension is null)
        return null;
    if (withoutExtension.StartsWith("Clawed/Content/", StringComparison.OrdinalIgnoreCase))
        return "/Game/" + withoutExtension["Clawed/Content/".Length..];
    if (withoutExtension.StartsWith("Engine/Content/", StringComparison.OrdinalIgnoreCase))
        return "/Engine/" + withoutExtension["Engine/Content/".Length..];
    return withoutExtension;
}

static string? MountedPackagePath(string? path)
{
    if (string.IsNullOrWhiteSpace(path))
        return null;
    var packagePath = PackagePathFromObjectPath(path) ?? path;
    if (packagePath.StartsWith("/Game/", StringComparison.OrdinalIgnoreCase))
        return "Clawed/Content/" + packagePath["/Game/".Length..] + ".uasset";
    if (packagePath.StartsWith("/Engine/", StringComparison.OrdinalIgnoreCase))
        return "Engine/Content/" + packagePath["/Engine/".Length..] + ".uasset";
    return path.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase) ||
        path.EndsWith(".umap", StringComparison.OrdinalIgnoreCase)
        ? path
        : path + ".uasset";
}

static string? WithoutCookedExtension(string? path)
{
    if (string.IsNullOrWhiteSpace(path))
        return null;
    var extension = Path.GetExtension(path);
    return extension.Equals(".uasset", StringComparison.OrdinalIgnoreCase) ||
        extension.Equals(".umap", StringComparison.OrdinalIgnoreCase)
        ? path[..^extension.Length].Replace('\\', '/')
        : path.Replace('\\', '/');
}

static string? ObjectPathFromRelativePath(string? path)
{
    var packagePath = PackagePathFromRelativePath(path);
    var name = ObjectNameFromPackagePath(path);
    return packagePath is null || name is null ? null : $"{packagePath}.{name}";
}

static string? ObjectNameFromObjectPath(string? path)
{
    if (string.IsNullOrWhiteSpace(path))
        return null;
    var dot = path.LastIndexOf('.');
    return dot >= 0 && dot + 1 < path.Length ? path[(dot + 1)..] : ObjectNameFromPackagePath(path);
}

static string? ObjectNameFromPackagePath(string? path)
{
    var packagePath = WithoutCookedExtension(PackagePathFromObjectPath(path));
    return packagePath is null ? null : Path.GetFileName(packagePath.Replace('\\', '/'));
}

static bool IsMappingsMissing(Exception error)
{
    var detail = error.ToString();
    return detail.Contains("mapping file is missing", StringComparison.OrdinalIgnoreCase) ||
        detail.Contains("unversioned properties", StringComparison.OrdinalIgnoreCase);
}

static async Task<DecodeResponse> ExportMeshAsync(UObject asset, string outputRoot, string format, DecodeMetadata metadata)
{
    try
    {
        var options = new ExporterOptions
        {
            LodFormat = ELodFormat.FirstLod,
            MeshFormat = format == "obj" ? EMeshFormat.OBJ : EMeshFormat.Gltf2,
            NaniteMeshFormat = ENaniteMeshFormat.AllLayersNaniteFirst,
            ExportMaterials = false,
            ExportMorphTargets = false,
            SocketFormat = ESocketFormat.None
        };
        var exporter = asset switch
        {
            UStaticMesh mesh => new MeshExporter(mesh, options),
            USkeletalMesh mesh => new MeshExporter(mesh, options),
            _ => throw new NotSupportedException(asset.GetType().Name)
        };
        var exported = exporter.MeshLods.FirstOrDefault(mesh =>
            Path.GetExtension(mesh.FileName).Equals($".{format}", StringComparison.OrdinalIgnoreCase));

        if (exported is null || exported.FileData.Length == 0)
            return DecodeResponse.Fail("decode-error", "CUE4PARSE_MESH_EXPORT_EMPTY", "CUE4Parse did not produce a model file for this asset.");

        var relativePath = exported.FileName.Replace('/', Path.DirectorySeparatorChar).TrimStart(Path.DirectorySeparatorChar);
        var output = Path.Combine(outputRoot, relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(output)!);
        await File.WriteAllBytesAsync(output, exported.FileData);
        return DecodeResponse.Ready(format, Path.GetFileName(output), output, metadata);
    }
    catch (Exception error)
    {
        return DecodeResponse.Fail("decode-error", "CUE4PARSE_MESH_EXPORT_FAILED", "CUE4Parse failed while converting the Unreal model.", SafeDetail(error));
    }
}

static DecodeResponse ExportSkeleton(USkeleton skeleton, string outputRoot)
{
    try
    {
        var boneCount = skeleton.ReferenceSkeleton.FinalRefBoneInfo.Length;
        if (boneCount == 0)
            return DecodeResponse.Fail("unsupported", "CUE4PARSE_SKELETON_EMPTY", "The Unreal skeleton has no reference bones.");

        var fileName = SafeFileName(skeleton.Name) + ".gltf";
        var filePath = Path.Combine(outputRoot, fileName);
        File.WriteAllText(filePath, BuildSkeletonGltf(skeleton), Encoding.UTF8);
        return DecodeResponse.Ready("gltf", fileName, filePath, SkeletonMetadata(skeleton));
    }
    catch (Exception error)
    {
        return DecodeResponse.Fail("decode-error", "CUE4PARSE_SKELETON_GLTF_FAILED", "The Unreal skeleton could not be converted to glTF.", SafeDetail(error));
    }
}

static DecodeResponse ClassifyAsset(UObject asset) =>
    asset switch
    {
        UStaticMesh mesh => DecodeResponse.Ready(null, null, null, MeshMetadata(mesh)),
        USkeletalMesh mesh => DecodeResponse.Ready(null, null, null, SkeletalMeshMetadata(mesh)),
        USkeleton skeleton => DecodeResponse.Ready(null, null, null, SkeletonMetadata(skeleton)),
        _ => DecodeResponse.Fail("unsupported", "CUE4PARSE_ASSET_CLASS_UNSUPPORTED", "The loaded Unreal asset class is not supported for viewport export.", asset.GetType().Name)
    };

static string BuildSkeletonGltf(USkeleton skeleton)
{
    var refSkeleton = skeleton.ReferenceSkeleton;
    var bones = refSkeleton.FinalRefBoneInfo;
    var poses = refSkeleton.FinalRefBonePose;
    var nodes = new List<Dictionary<string, object?>>(bones.Length + 1);
    var roots = new List<int>();

    for (var i = 0; i < bones.Length; i++)
    {
        var children = Enumerable.Range(0, bones.Length)
            .Where(candidate => bones[candidate].ParentIndex == i)
            .Cast<object>()
            .ToArray();
        var transform = poses[Math.Min(i, poses.Length - 1)];
        var node = new Dictionary<string, object?>
        {
            ["name"] = bones[i].Name.Text,
            ["translation"] = ToGltfTranslation(transform.Translation),
            ["rotation"] = ToGltfRotation(transform.Rotation),
            ["scale"] = ToGltfScale(transform.Scale3D)
        };
        if (children.Length > 0)
            node["children"] = children;
        nodes.Add(node);

        if (bones[i].ParentIndex < 0)
            roots.Add(i);
    }

    var meshNodeIndex = nodes.Count;
    nodes.Add(new Dictionary<string, object?>
    {
        ["name"] = "CMM_Skeleton_Preview_Surface",
        ["mesh"] = 0,
        ["skin"] = 0
    });

    var binary = BuildSkeletonPreviewBuffer();
    var rootNodes = roots.Count > 0 ? roots.Cast<object>().ToList() : [0];
    rootNodes.Add(meshNodeIndex);
    var json = new Dictionary<string, object?>
    {
        ["asset"] = new Dictionary<string, object?>
        {
            ["version"] = "2.0",
            ["generator"] = "Clawed Mod Manager CUE4Parse decoder"
        },
        ["scene"] = 0,
        ["scenes"] = new object[]
        {
            new Dictionary<string, object?> { ["nodes"] = rootNodes }
        },
        ["nodes"] = nodes,
        ["skins"] = new object[]
        {
            new Dictionary<string, object?>
            {
                ["skeleton"] = roots.FirstOrDefault(),
                ["joints"] = Enumerable.Range(0, bones.Length).Cast<object>().ToArray()
            }
        },
        ["meshes"] = new object[]
        {
            new Dictionary<string, object?>
            {
                ["name"] = skeleton.Name,
                ["primitives"] = new object[]
                {
                    new Dictionary<string, object?>
                    {
                        ["attributes"] = new Dictionary<string, object?>
                        {
                            ["POSITION"] = 0,
                            ["JOINTS_0"] = 1,
                            ["WEIGHTS_0"] = 2
                        },
                        ["indices"] = 3,
                        ["material"] = 0,
                        ["mode"] = 4
                    }
                }
            }
        },
        ["materials"] = new object[]
        {
            new Dictionary<string, object?>
            {
                ["name"] = "Skeleton Preview",
                ["pbrMetallicRoughness"] = new Dictionary<string, object?>
                {
                    ["baseColorFactor"] = new object[] { 0.08, 0.72, 1.0, 0.16 },
                    ["metallicFactor"] = 0,
                    ["roughnessFactor"] = 1
                },
                ["alphaMode"] = "BLEND",
                ["doubleSided"] = true
            }
        },
        ["buffers"] = new object[]
        {
            new Dictionary<string, object?>
            {
                ["uri"] = "data:application/octet-stream;base64," + Convert.ToBase64String(binary.Data),
                ["byteLength"] = binary.Data.Length
            }
        },
        ["bufferViews"] = binary.Views,
        ["accessors"] = new object[]
        {
            new Dictionary<string, object?>
            {
                ["bufferView"] = 0,
                ["componentType"] = 5126,
                ["count"] = 3,
                ["type"] = "VEC3",
                ["min"] = new object[] { -0.18, 0, -0.18 },
                ["max"] = new object[] { 0.18, 0.28, 0.18 }
            },
            new Dictionary<string, object?>
            {
                ["bufferView"] = 1,
                ["componentType"] = 5123,
                ["count"] = 3,
                ["type"] = "VEC4"
            },
            new Dictionary<string, object?>
            {
                ["bufferView"] = 2,
                ["componentType"] = 5126,
                ["count"] = 3,
                ["type"] = "VEC4"
            },
            new Dictionary<string, object?>
            {
                ["bufferView"] = 3,
                ["componentType"] = 5123,
                ["count"] = 3,
                ["type"] = "SCALAR"
            }
        }
    };

    return JsonSerializer.Serialize(json, new JsonSerializerOptions
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    });
}

static SkeletonBuffer BuildSkeletonPreviewBuffer()
{
    using var stream = new MemoryStream();
    var views = new List<Dictionary<string, object?>>();

    AddView(stream, views, WriteFloats, new float[]
    {
        0, 0.28f, 0,
        -0.18f, 0, 0.18f,
        0.18f, 0, 0.18f
    });
    AddView(stream, views, WriteUShorts, new ushort[]
    {
        0, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 0
    });
    AddView(stream, views, WriteFloats, new float[]
    {
        1, 0, 0, 0,
        1, 0, 0, 0,
        1, 0, 0, 0
    });
    AddView(stream, views, WriteUShorts, new ushort[] { 0, 1, 2 });
    return new SkeletonBuffer(stream.ToArray(), views);
}

static void AddView<T>(MemoryStream stream, List<Dictionary<string, object?>> views, Action<MemoryStream, IEnumerable<T>> write, IEnumerable<T> values)
{
    Align4(stream);
    var offset = (int)stream.Position;
    write(stream, values);
    var length = (int)stream.Position - offset;
    views.Add(new Dictionary<string, object?>
    {
        ["buffer"] = 0,
        ["byteOffset"] = offset,
        ["byteLength"] = length
    });
}

static void WriteFloats(MemoryStream stream, IEnumerable<float> values)
{
    Span<byte> bytes = stackalloc byte[4];
    foreach (var value in values)
    {
        BinaryPrimitives.WriteSingleLittleEndian(bytes, value);
        stream.Write(bytes);
    }
}

static void WriteUShorts(MemoryStream stream, IEnumerable<ushort> values)
{
    Span<byte> bytes = stackalloc byte[2];
    foreach (var value in values)
    {
        BinaryPrimitives.WriteUInt16LittleEndian(bytes, value);
        stream.Write(bytes);
    }
}

static void Align4(MemoryStream stream)
{
    while (stream.Position % 4 != 0)
        stream.WriteByte(0);
}

static object[] ToGltfTranslation(FVector value) => [Finite(value.X / 100f), Finite(value.Z / 100f), Finite(-value.Y / 100f)];

static object[] ToGltfRotation(FQuat value)
{
    var normalized = value.GetNormalized();
    return [Finite(normalized.X), Finite(normalized.Z), Finite(-normalized.Y), Finite(normalized.W)];
}

static object[] ToGltfScale(FVector value) => [Finite(value.X), Finite(value.Z), Finite(value.Y)];

static float Finite(float value) => float.IsFinite(value) ? value : 0;

static DecodeMetadata MeshMetadata(UStaticMesh mesh)
{
    var lods = mesh.RenderData?.LODs?.Select((lod, index) => new DecodeLod(index, ScreenSize(mesh, index), null, null)).ToArray() ?? [];
    var materials = mesh.StaticMaterials ?? [];
    return new DecodeMetadata(
        "staticMesh",
        null,
        PathName(mesh.BodySetup),
        StaticMaterials(materials),
        lods,
        [.. DependencyPaths(PathName(mesh.BodySetup))],
        lods.Length,
        null,
        null,
        materials.Length);
}

static DecodeMetadata SkeletalMeshMetadata(USkeletalMesh mesh)
{
    var lods = mesh.LODModels?.Select((_, index) => new DecodeLod(index, SkeletalScreenSize(mesh, index), null, null)).ToArray() ?? [];
    var materials = mesh.SkeletalMaterials ?? [];
    var skeleton = PathName(mesh.Skeleton);
    var physics = PathName(mesh.PhysicsAsset);
    return new DecodeMetadata(
        "skeletalMesh",
        skeleton,
        physics,
        SkeletalMaterials(materials),
        lods,
        [.. DependencyPaths(skeleton, physics)],
        lods.Length,
        null,
        null,
        materials.Length);
}

static DecodeMetadata SkeletonMetadata(USkeleton skeleton)
{
    return new DecodeMetadata(
        "skeleton",
        skeleton.GetPathName(),
        null,
        [],
        [],
        [skeleton.GetPathName()],
        0,
        0,
        0,
        0);
}

static DecodeMaterial[] StaticMaterials(FStaticMaterial[] materials) =>
    materials.Select((material, index) => new DecodeMaterial(
        FirstText(material.MaterialSlotName.Text, $"Material {index + 1}")!,
        ResolvedPathName(material.MaterialInterface))).ToArray();

static DecodeMaterial[] SkeletalMaterials(FSkeletalMaterial[] materials) =>
    materials.Select((material, index) => new DecodeMaterial(
        FirstText(material.MaterialSlotName.Text, $"Material {index + 1}")!,
        ResolvedPathName(material.Material))).ToArray();

static IEnumerable<string> DependencyPaths(params string?[] paths) =>
    paths.Where(path => !string.IsNullOrWhiteSpace(path)).Select(path => path!);

static string? PathName(FPackageIndex? index)
{
    if (index is null || index.IsNull)
        return null;

    try
    {
        return index.ResolvedObject?.GetPathName();
    }
    catch
    {
        return null;
    }
}

static string? ResolvedPathName(ResolvedObject? resolved)
{
    if (resolved is null)
        return null;

    try
    {
        return resolved.GetPathName();
    }
    catch
    {
        return null;
    }
}

static double? ScreenSize(UStaticMesh mesh, int index)
{
    if (mesh.RenderData?.ScreenSize is null || index >= mesh.RenderData.ScreenSize.Length)
        return null;
    return mesh.RenderData.ScreenSize[index];
}

static double? SkeletalScreenSize(USkeletalMesh mesh, int index)
{
    if (mesh.LODInfo is null || index >= mesh.LODInfo.Length)
        return null;
    return mesh.LODInfo[index].ScreenSize.Value;
}

static bool IsSupportedRequest(string format, string? assetClass, string mode) =>
    mode == "classify"
        ? string.IsNullOrWhiteSpace(format) || format is "glb" or "obj" or "gltf"
        : assetClass == "Skeleton"
            ? format == "gltf"
            : format is "glb" or "obj";

static EGame ParseGame(string? value)
{
    var text = FirstText(value, "GAME_UE5_5")!.Replace(".", "_", StringComparison.OrdinalIgnoreCase);
    if (!text.StartsWith("GAME_", StringComparison.OrdinalIgnoreCase))
        text = "GAME_" + text;
    return Enum.TryParse<EGame>(text, true, out var game) ? game : EGame.GAME_UE5_5;
}

static string? FirstText(params string?[] values) =>
    values.Select(value => value?.Trim()).FirstOrDefault(value => !string.IsNullOrWhiteSpace(value));

static string SafeFileName(string value)
{
    var invalid = Path.GetInvalidFileNameChars();
    var safe = new string(value.Select(ch => invalid.Contains(ch) ? '-' : ch).ToArray()).Trim('-', ' ', '.');
    return string.IsNullOrWhiteSpace(safe) ? "skeleton" : safe;
}

static string SafeDetail(Exception error) => $"{error.GetType().Name}: {error.Message}".ReplaceLineEndings(" ").Trim();

sealed record DecodeRequest(
    int SchemaVersion,
    string? Mode,
    string? ArchiveRoot,
    string? OutputRoot,
    string? ObjectPath,
    string? PackagePath,
    string? RelativePath,
    string? AssetClass,
    string? Format,
    string? UnrealVersion,
    string? MappingsPath,
    string? AesKey);

sealed record DecodeResponse(
    string Status,
    string? Format,
    string? FileName,
    string? FilePath,
    DecodeMetadata? Metadata,
    DecodeProblem[] Problems)
{
    public static DecodeResponse Ready(string? format, string? fileName, string? filePath, DecodeMetadata metadata) =>
        new("ready", format, fileName, filePath, metadata, []);

    public static DecodeResponse Fail(string status, string code, string message, string? detail = null) =>
        new(status, null, null, null, null, [new DecodeProblem(status == "unsupported" ? "info" : "warning", code, message, detail)]);
}

sealed record DecodeMetadata(
    string MeshType,
    string? Skeleton,
    string? PhysicsAsset,
    DecodeMaterial[] MaterialSlots,
    DecodeLod[] Lods,
    string[] DependencyPaths,
    int? LodCount,
    int? VertexCount,
    int? TriangleCount,
    int? MaterialSlotCount);

sealed record DecodeMaterial(string Name, string? MaterialPath);

sealed record DecodeLod(int Index, double? ScreenSize, int? TriangleCount, int? VertexCount);

sealed record DecodeProblem(string Severity, string Code, string Message, string? TechnicalDetail);

sealed record SkeletonBuffer(byte[] Data, List<Dictionary<string, object?>> Views);
