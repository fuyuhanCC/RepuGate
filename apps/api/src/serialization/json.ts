export function toJsonCompatible<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  ) as unknown;
}

export function stringifyInternalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint"
      ? { __repugateBigInt: item.toString() }
      : item,
  );
}

export function parseInternalJson<T>(value: string): T {
  return JSON.parse(value, (_key, item: unknown) => {
    if (
      typeof item === "object" &&
      item !== null &&
      Object.keys(item).length === 1 &&
      "__repugateBigInt" in item &&
      typeof item.__repugateBigInt === "string"
    ) {
      return BigInt(item.__repugateBigInt);
    }

    return item;
  }) as T;
}
