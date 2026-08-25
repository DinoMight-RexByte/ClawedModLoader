import {
  Color,
  DoubleSide,
  MeshStandardMaterial,
  type Material,
  type Object3D,
  type Texture
} from "three";

import type { CreatorViewportTextureLayer } from "../../shared/contracts/app";

export const creatorDiagnosticFrontColor = "#9ca3af";
export const creatorDiagnosticBackColor = "#ff00ff";

export interface CreatorViewportMaterialTexture {
  layer: CreatorViewportTextureLayer;
  texture: Texture;
}

export function applyCreatorViewportDiagnosticMaterials(
  root: Object3D,
  textures: CreatorViewportMaterialTexture[] = []
): void {
  root.traverse((object) => {
    const mesh = object as Object3D & {
      isMesh?: boolean;
      material?: Material | Material[];
    };
    if (!mesh.isMesh) {
      return;
    }

    disposeMaterials(mesh.material);
    const material = createCreatorViewportMaterial(textures);
    mesh.material = material;
  });
}

export function createCreatorViewportMaterial(
  textures: CreatorViewportMaterialTexture[] = []
): MeshStandardMaterial {
  const backFaceColor = new Color(creatorDiagnosticBackColor);
  const backFaceVector = `vec3(${backFaceColor.r.toFixed(6)}, ${backFaceColor.g.toFixed(6)}, ${backFaceColor.b.toFixed(6)})`;
  const material = new MeshStandardMaterial({
    color: creatorDiagnosticFrontColor,
    metalness: 0,
    roughness: 0.82,
    side: DoubleSide
  });
  applyCreatorViewportMaterialTextures(material, textures);
  material.name = "CMM Creator Diagnostic Material";
  material.userData.cmmCreatorDiagnosticMaterial = true;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `float cmmBackFaceViewWeight = abs( dot( normalize( vViewPosition ), normal ) );
if ( !gl_FrontFacing && cmmBackFaceViewWeight > 0.22 ) {
  outgoingLight = ${backFaceVector};
}
#include <opaque_fragment>`
    );
  };
  material.customProgramCacheKey = () => "cmm-creator-diagnostic-backfaces-0.22";
  return material;
}

function applyCreatorViewportMaterialTextures(
  material: MeshStandardMaterial,
  textures: CreatorViewportMaterialTexture[]
): void {
  textures.forEach(({ layer, texture }) => {
    if (layer === "baseColor" || layer === "unknown") {
      material.map = texture;
      material.color.set("#ffffff");
    }
    if (layer === "normal") {
      material.normalMap = texture;
    }
    if (layer === "lightMap") {
      material.lightMap = texture;
    }
    if (layer === "maskOrm") {
      material.aoMap = texture;
      material.roughnessMap = texture;
      material.metalnessMap = texture;
    }
    if (layer === "emissive") {
      material.emissive.set("#ffffff");
      material.emissiveMap = texture;
    }
  });
}

export function disposeMaterials(
  materials: Material | Material[] | null | undefined
): void {
  const seen = new Set<Material>();
  const list = Array.isArray(materials) ? materials : materials ? [materials] : [];
  list.forEach((material) => {
    if (seen.has(material)) {
      return;
    }
    seen.add(material);
    disposeMaterialTextures(material);
    material.dispose();
  });
}

function disposeMaterialTextures(material: Material): void {
  [
    "alphaMap",
    "aoMap",
    "bumpMap",
    "displacementMap",
    "emissiveMap",
    "envMap",
    "lightMap",
    "map",
    "metalnessMap",
    "normalMap",
    "roughnessMap"
  ].forEach((key) => {
    const texture = (material as Material & Record<string, Texture | null>)[key];
    texture?.dispose();
  });
}
