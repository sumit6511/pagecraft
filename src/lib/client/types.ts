export interface Output {
  name: string;
  blob: Blob;
  /** Optional note shown next to the result, e.g. "already optimal". */
  note?: string;
}
