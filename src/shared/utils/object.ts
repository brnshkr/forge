import type { Maybe, Simplify, ValueOf } from '#src/shared/types/core';

export type AnyRecord = Record<PropertyKey, unknown>;
export type AnyObject<TObject = AnyRecord> = Simplify<Partial<Record<keyof TObject, ValueOf<TObject>>>>;
export type ObjectKeys<TObject = AnyRecord> = Simplify<(keyof TObject)[]>;
export type ObjectValues<TObject = AnyRecord> = Simplify<ValueOf<TObject>[]>;
export type ObjectEntries<TObject = AnyRecord> = Simplify<[keyof TObject, ValueOf<TObject>][]>;

interface ObjectKeysFunction {
  <TKey>(map: ReadonlyMap<TKey, unknown>): TKey[];
  <TObject extends AnyObject<TObject>>(object: TObject): ObjectKeys<TObject>;
}

interface ObjectValuesFunction {
  <TValue>(map: ReadonlyMap<unknown, TValue>): TValue[];
  <TObject extends AnyObject<TObject>>(object: TObject): ObjectValues<TObject>;
}

interface ObjectEntriesFunction {
  <TKey, TValue>(map: ReadonlyMap<TKey, TValue>): [TKey, TValue][];
  <TObject extends AnyObject<TObject>>(object: TObject): ObjectEntries<TObject>;
}

export const objectKeys = <ObjectKeysFunction>(
  (object: object): unknown[] => (object instanceof Map ? object.keys().toArray() : Object.keys(object))
);

export const objectValues = <ObjectValuesFunction>(
  (object: object): unknown[] => (object instanceof Map ? object.values().toArray() : Object.values(object))
);

export const objectEntries = <ObjectEntriesFunction>(
  (object: object): unknown[] => (object instanceof Map ? object.entries().toArray() : Object.entries(object))
);

export const objectFromEntries = <TKey extends PropertyKey, TValue>(
  entries: Iterable<readonly [TKey, TValue]>,
): Record<TKey, TValue> => <Record<TKey, TValue>>Object.fromEntries(entries);

interface ReadOwnValueFunction {
  <TKey, TValue>(map: ReadonlyMap<TKey, TValue>, key: TKey): Maybe<TValue>;
  <TObject extends object, TKey extends keyof TObject>(object: TObject, key: TKey): Maybe<TObject[TKey]>;
}

interface WriteOwnValueFunction {
  <TKey, TValue>(map: Map<TKey, TValue>, key: TKey, value: TValue): void;
  <TObject extends object, TKey extends keyof TObject>(object: TObject, key: TKey, value: TObject[TKey]): void;
}

export const readOwnValue = <ReadOwnValueFunction>((object: object, key: PropertyKey): unknown => {
  if (object instanceof Map) {
    return object.get(key);
  }

  return Object.hasOwn(object, key) ? Reflect.get(object, key) : undefined;
});

export const writeOwnValue = <WriteOwnValueFunction>((object: object, key: PropertyKey, value: unknown): void => {
  if (object instanceof Map) {
    object.set(key, value);

    return;
  }

  Object.defineProperty(object, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
});

export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || !value) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value) ?? Object.prototype;

  return prototype === Object.prototype;
};
