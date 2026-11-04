// Instanced meshes are rebuilt for every view, but only their first `n` instances are drawn.
// Re-sending the whole buffer to the GPU each time (tens of thousands of trees and grass clumps,
// ~10 MB per rebuild) made sweeping the scope stutter on phones, so only the used part goes up.
import type * as THREE from "three";

export function uploadUsed(attr: THREE.BufferAttribute | null | undefined, n: number) {
  if (!attr || n <= 0) return;
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, n * attr.itemSize);
  attr.needsUpdate = true;
}

/** Mark the first `n` instances of a mesh (matrices, colours, and any per-instance attributes) for upload. */
export function uploadInstances(mesh: THREE.InstancedMesh, n: number, extra: (THREE.BufferAttribute | null | undefined)[] = []) {
  uploadUsed(mesh.instanceMatrix, n);
  uploadUsed(mesh.instanceColor, n);
  for (const a of extra) uploadUsed(a, n);
}
