import { onTestFinished, vi } from 'vitest';

export const captureWrites = (stream: NodeJS.WriteStream): string[] => {
  const writes: string[] = [];

  vi.spyOn(stream, 'write').mockImplementation((chunk) => {
    writes.push(String(chunk));

    return true;
  });

  onTestFinished(() => {
    vi.restoreAllMocks();
  });

  return writes;
};
