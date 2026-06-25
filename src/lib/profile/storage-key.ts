export function generateStorageKey(source: string, id: string): string {
  return `${source}+${id}`;
}
