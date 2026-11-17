import { constants, openSync, closeSync, fstatSync, realpathSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import type { Controller } from '../session/controller';
import { AppError } from '../session/types';

/** Open only a finalized manifest file; caller owns the descriptor. */
export function openReadyFile(controller: Controller, sessionId: string, fileId: string) {
  const file = controller.getSession(sessionId)?.files.find(file => file.id === fileId && file.status === 'ready');
  if (!file || basename(file.name) !== file.name || file.name.includes('\\')) throw new AppError(404, 'File not found');
  let fd: number | undefined;
  try {
    const directory = realpathSync(controller.getSessionDirectory(sessionId));
    const path = join(directory, file.name);
    if (!realpathSync(path).startsWith(directory + sep)) throw Error();
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw Error();
    return { fd, file, size: stat.size };
  } catch {
    if (fd !== undefined) closeSync(fd);
    throw new AppError(404, 'File not found');
  }
}
