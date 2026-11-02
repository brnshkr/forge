export const DIGEST_SOURCE = String.raw`sha256:[\da-f]{64}`;
export const readDigest = (reference: string): string => reference.slice(reference.indexOf('@') + 1);
export const shortenDigest = (value: string): string => /sha256:[\da-f]{12}/v.exec(value)?.[0] ?? value;
