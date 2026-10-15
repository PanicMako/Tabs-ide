import { exchangeErrorGuidance } from "@tabs/shared/exchangeErrors";
export function registryError(status: number, body: unknown): Error {
  const { code, message } = exchangeErrorGuidance(status, body);
  return new Error(`${code}: ${message}`);
}
