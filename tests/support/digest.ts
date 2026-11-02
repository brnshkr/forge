const DIGEST_HEX_LENGTH = 64;

export const createDigest = (character: string): string => `sha256:${character.repeat(DIGEST_HEX_LENGTH)}`;
