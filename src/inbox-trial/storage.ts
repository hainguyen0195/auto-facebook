import { readFile, rename, writeFile } from "node:fs/promises";
import { freshState, parseState, pruneState, type TrialState } from "./state";

export async function loadState(
  file: string,
  scope: string,
): Promise<TrialState> {
  try {
    return parseState(await readFile(file, "utf8"), scope);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return freshState(scope);
    // Corrupt or differently scoped state must not silently restart the baseline.
    throw error;
  }
}

export async function saveState(
  file: string,
  state: TrialState,
): Promise<void> {
  // Atomic replacement avoids truncated checkpoints after a container restart.
  await writeFile(`${file}.tmp`, JSON.stringify(pruneState(state)), {
    mode: 0o600,
  });
  await rename(`${file}.tmp`, file);
}
