import { access, cp, unlink } from "node:fs/promises";
import path from "node:path";

// Next.js copies environment files into standalone output; deployment supplies its own environment.
const destination = path.resolve(".next/standalone");
for (const name of [
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
]) {
  await unlink(path.join(destination, name)).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    },
  );
}
if (
  await access(path.join(destination, ".data")).then(
    () => true,
    () => false,
  )
)
  throw new Error(
    "Private .data directory was traced into the build. Check outputFileTracingExcludes.",
  );
console.log(
  "Standalone output checked: no environment files or local data directory.",
);
await cp(path.resolve("public"), path.join(destination, "public"), {
  recursive: true,
});
await cp(path.resolve(".next/static"), path.join(destination, ".next/static"), {
  recursive: true,
});
