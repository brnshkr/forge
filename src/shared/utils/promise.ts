import { getErrorMessage } from '#src/shared/utils/error';

import type { Maybe } from '#src/shared/types/core';

export const filterPassing = async <TItem>(
  items: readonly TItem[],
  isPassing: (item: TItem) => Promise<boolean>,
): Promise<TItem[]> => {
  const checkedItems = await Promise.all(items.map(async (item) => ({
    isPassing: await isPassing(item),
    item,
  })));

  return checkedItems
    .filter((checkedItem) => checkedItem.isPassing)
    .map((checkedItem) => checkedItem.item);
};

export const findFirstPassing = async <TItem>(
  items: readonly TItem[],
  isPassing: (item: TItem) => Promise<boolean>,
): Promise<Maybe<TItem>> => {
  const passingItems = await filterPassing(items, isPassing);

  return passingItems.at(0);
};

export const readRejectionMessages = (
  results: readonly PromiseSettledResult<unknown>[],
): string[] => results.flatMap(
  (result) => (result.status === 'rejected' ? [getErrorMessage(result.reason)] : []),
);
