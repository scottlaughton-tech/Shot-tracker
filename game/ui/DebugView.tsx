"use client";
// Developer-only previews (textures, single models). Not linked from the app.
import { useEffect, useRef } from "react";

export default function DebugView() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const show = new URLSearchParams(location.search).get("show") ?? "atlas";
    (async () => {
      const el = ref.current!;
      if (show === "atlasraw") {
        // used by scripts/bake-atlas.cjs to save the drawn atlas
        const ft = await import("../world/foliageTextures");
        const c = ft.drawFoliageAtlas();
        (window as unknown as { __atlas: string }).__atlas = c.toDataURL("image/png");
      } else if (show === "atlas" || show === "bark") {
        const ft = await import("../world/foliageTextures");
        const toCanvas = (im: { data: Uint8Array; width: number; height: number }) => {
          const c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
          const id = c.getContext("2d")!.createImageData(im.width, im.height);
          for (let y = 0; y < im.height; y++) id.data.set(im.data.subarray((im.height - 1 - y) * im.width * 4, (im.height - y) * im.width * 4), y * im.width * 4);
          c.getContext("2d")!.putImageData(id, 0, 0);
          return c;
        };
        const imgs = show === "atlas" ? [toCanvas((await ft.foliageAtlas()).image as { data: Uint8Array; width: number; height: number })] : (["maple", "birch", "pine", "spruce", "oak"] as const).map((k) => ft.barkTexture(k).image);
        for (const im of imgs) { const c = im as HTMLCanvasElement; c.style.cssText = "width:" + (show === "atlas" ? "100%" : "18%") + ";background:#7a8a6a;margin:2px"; el.appendChild(c); }
      } else {
        const { mountPreview } = await import("../engine/preview");
        await mountPreview(el, show);
      }
      el.dataset.ready = "1";
    })();
  }, []);
  return <div ref={ref} id="debug" style={{ background: "#7a8a6a", minHeight: "100vh" }} />;
}
