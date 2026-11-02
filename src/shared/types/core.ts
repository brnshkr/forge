export type Maybe<TValue> = TValue | undefined;
export type StringRecord = Readonly<Record<string, Maybe<string>>>;
export type ValueOf<TObject> = TObject[keyof TObject];

export type Simplify<TValue> = {
  [TKey in keyof TValue]: TValue[TKey];
};
