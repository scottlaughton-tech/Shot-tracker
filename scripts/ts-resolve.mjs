// Lets `node --test` load game modules that import each other without the ".ts" extension
// (the app's bundler resolves those; plain Node doesn't). Used by `npm test`.
import { register } from "node:module";

register("data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx); } catch (e) {
    if ((spec.startsWith(".") || spec.startsWith("/")) && !spec.endsWith(".ts")) return next(spec + ".ts", ctx);
    throw e;
  }
}`));
