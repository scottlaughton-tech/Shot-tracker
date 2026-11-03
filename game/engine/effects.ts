// Short-lived visual effects: dust puffs where a bullet hits the ground, hair/blood puffs on hits.
import * as THREE from "three";

function puffTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, "rgba(255,255,255,0.9)");
  grd.addColorStop(0.45, "rgba(255,255,255,0.45)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

type Puff = { sprite: THREE.Sprite; age: number; life: number; v: THREE.Vector3; grow: number; base: number };

export class Effects {
  private puffs: Puff[] = [];
  private tex = puffTexture();
  constructor(private scene: THREE.Scene) {}

  dust(p: THREE.Vector3, color = new THREE.Color("#9c8a6c")) {
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.tex, color, transparent: true, depthWrite: false, opacity: 0.85 });
      const s = new THREE.Sprite(mat);
      s.position.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.15 + Math.random() * 0.3, (Math.random() - 0.5) * 0.4));
      const base = 0.5 + Math.random() * 0.5;
      s.scale.setScalar(base);
      this.scene.add(s);
      this.puffs.push({
        sprite: s, age: 0, life: 1.6 + Math.random() * 1.2, base, grow: 1.4 + Math.random(),
        v: new THREE.Vector3((Math.random() - 0.5) * 1.2, 1.2 + Math.random() * 1.8, (Math.random() - 0.5) * 1.2),
      });
    }
  }

  hair(p: THREE.Vector3) {
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.tex, color: new THREE.Color("#8a7a68"), transparent: true, depthWrite: false, opacity: 0.7 });
      const s = new THREE.Sprite(mat);
      s.position.copy(p);
      s.scale.setScalar(0.15);
      this.scene.add(s);
      this.puffs.push({ sprite: s, age: 0, life: 0.6, base: 0.15, grow: 1.5, v: new THREE.Vector3((Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2) });
    }
  }

  update(dt: number) {
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        this.scene.remove(p.sprite);
        p.sprite.material.dispose();
        this.puffs.splice(i, 1);
        continue;
      }
      p.v.multiplyScalar(Math.exp(-2.5 * dt));
      p.v.y -= 0.3 * dt;
      p.sprite.position.addScaledVector(p.v, dt);
      p.sprite.scale.setScalar(p.base * (1 + p.grow * Math.sqrt(t) * 2));
      p.sprite.material.opacity = 0.85 * (1 - t) * (1 - t);
    }
  }
}
