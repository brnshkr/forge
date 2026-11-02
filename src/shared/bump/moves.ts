import { shortenDigest } from '#src/shared/pins/digests';

export interface Move {
  readonly from: string;
  readonly pin: string;
  readonly to: string;
}

const print = (
  move: Move,
  separators: readonly [string, string],
): string => `${move.pin}${separators[0]}${shortenDigest(move.from)}${separators[1]}${shortenDigest(move.to)}\n`;

const DEFAULT_MOVE_FORMAT = 'human';

const MOVE_FORMATS = <const>{
  human: (move) => print(move, [': ', ' -> ']),
  tsv: (move) => print(move, ['\t', '\t']),
} satisfies Record<typeof DEFAULT_MOVE_FORMAT | string & {}, (move: Move) => string>;

export type MoveFormat = keyof typeof MOVE_FORMATS;

const isMoveFormat = (format: string): format is MoveFormat => Object.hasOwn(MOVE_FORMATS, format);

/**
 * @throws {Error}
 */
export const readMoveFormat = (value: string): MoveFormat => {
  const format = value === '' ? DEFAULT_MOVE_FORMAT : value;

  if (!isMoveFormat(format)) {
    throw new Error(`Unsupported format "${value}".`);
  }

  return format;
};

export const writeMoves = (moves: readonly Move[], format: MoveFormat): void => {
  const printMove = Reflect.get(MOVE_FORMATS, format);

  for (const move of moves) {
    process.stdout.write(printMove(move));
  }
};
