// Photo textures (CC0, Poly Haven) served from /public/game/tex. If any fail to load
// (offline, slow network) the game falls back to its code-drawn textures.
import * as THREE from "three";

export type Photos = {
  floor: THREE.Texture; floorN: THREE.Texture;
  field: THREE.Texture;
  ground: THREE.Texture; groundN: THREE.Texture;
  barkHw: THREE.Texture; barkPine: THREE.Texture; barkPineN: THREE.Texture;
  rock: THREE.Texture; rockN: THREE.Texture;
};

const FILES: Record<keyof Photos, [string, boolean]> = {
  floor: ["floor.jpg", true], floorN: ["floor_n.jpg", false],
  field: ["field.jpg", true],
  ground: ["ground.jpg", true], groundN: ["ground_n.jpg", false],
  barkHw: ["bark_hw.jpg", true], barkPine: ["bark_pine.jpg", true], barkPineN: ["bark_pine_n.jpg", false],
  rock: ["rock.jpg", true], rockN: ["rock_n.jpg", false],
};

export async function loadPhotos(maxAnisotropy: number, onEach?: (done: number, total: number) => void): Promise<Photos | null> {
  const loader = new THREE.TextureLoader();
  const keys = Object.keys(FILES) as (keyof Photos)[];
  let done = 0;
  try {
    const list = await Promise.all(keys.map(async (k) => {
      const [file, color] = FILES[k];
      const t = await loader.loadAsync(`/game/tex/${file}`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = Math.min(8, maxAnisotropy);
      t.minFilter = THREE.LinearMipmapLinearFilter;
      onEach?.(++done, keys.length);
      return [k, t] as const;
    }));
    return Object.fromEntries(list) as Photos;
  } catch (e) {
    console.warn("photo textures unavailable, using drawn ones", e);
    return null;
  }
}
