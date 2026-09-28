/**
 * Best-effort recursive directory removal for tests.
 *
 * SQLite drivers (bun:sqlite, node:sqlite) finalize prepared statements
 * on garbage collection, and on Windows an unfinalized statement keeps a
 * file lock that makes immediate deletion fail with EBUSY. Force a GC
 * cycle when available and retry a few times before giving up.
 */
export async function removeDirectory(
  path: string,
  attempts = 10,
): Promise<void> {
  const { rmSync } = await import('node:fs');

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? (error as { code: unknown }).code
          : undefined;
      if ((code !== 'EBUSY' && code !== 'EPERM') || attempt === attempts - 1) {
        throw error;
      }
      const bun = (globalThis as { Bun?: { gc: (force: boolean) => void } })
        .Bun;
      try {
        bun?.gc(true);
      } catch {
        // GC is best-effort only.
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 25 * (attempt + 1));
      });
    }
  }
}
