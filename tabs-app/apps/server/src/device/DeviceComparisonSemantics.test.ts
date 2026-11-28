import { describe, expect, it } from "vitest";

import {
  isConsequentialDeviceAction,
  looksLikeCurrencyAmount,
  observeTotal,
  parseAmountMinor,
  type DeviceObservation,
  type ObservedControl,
} from "./DeviceComparisonSemantics.ts";

describe("consequential action labels", () => {
  it.each([
    "Continue to payment",
    "Complete order",
    "Place demo order",
    "Place your order",
    "Confirm purchase",
    "Pay now",
    "Book",
    "Subscribe",
    "Donate",
    "Transfer",
    "Authorize",
    "Complete checkout",
    "Place checkout order",
    "Delete account",
    "Remove item",
    "Send",
    "Submit",
    "Publish",
    "Cancel order",
    "Confirm",
  ])("treats %s as consequential", (label) => {
    expect(isConsequentialDeviceAction(label)).toBe(true);
  });

  it.each(["Checkout as guest", "Continue", "Order review", "Order summary", "Back", "Next"])(
    "does not treat %s as consequential",
    (label) => {
      expect(isConsequentialDeviceAction(label)).toBe(false);
    },
  );
});

const observation = (labels: string[]): DeviceObservation => ({
  identifierCounts: new Map(),
  controls: labels.map(
    (label, index) =>
      ({
        id: String(index),
        label,
        role: "text",
        canTap: false,
        ref: "",
        parentIndex: undefined,
        amountValue: undefined,
      }) satisfies ObservedControl,
  ),
});

describe("locale-aware totals", () => {
  it.each([
    ["1,234.56", 123456],
    ["1.234,56", 123456],
    ["12,50", 1250],
    ["12.50", 1250],
    ["1 234,56", 123456],
    ["1 234,56", 123456],
    ["1 234,56", 123456],
    ["1,234", 123400],
    ["20", 2000],
  ])("parses %s", (text, minor) => {
    expect(parseAmountMinor(text)).toBe(minor);
  });

  it.each(["1,234,56", "1.234.56,00"])("rejects the ambiguous amount %s", (text) => {
    expect(parseAmountMinor(text)).toBeNull();
  });

  it.each([
    ["Total €12,50", "EUR", 1250],
    ["Total: 12,50 €", "EUR", 1250],
    ["Total 1.234,56 €", "EUR", 123456],
    ["Total £1,234.56", "GBP", 123456],
    ["Total USD 20.00", "USD", 2000],
    ["Total: 1 234,56 EUR", "EUR", 123456],
    ["Total $20", "USD", 2000],
  ] as const)("reads %s", (label, currency, minor) => {
    expect(observeTotal(observation([label]), "Total", currency)?.minor).toBe(minor);
  });

  it("keeps an unreadable total unobservable", () => {
    expect(observeTotal(observation(["Total: soon"]), "Total", "EUR")).toBeNull();
    expect(observeTotal(observation(["Total €1,234,56"]), "Total", "EUR")).toBeNull();
    expect(observeTotal(observation(["Subtotal €5,00"]), "Total", "EUR")).toBeUndefined();
  });

  it("recognises currency-looking text", () => {
    expect(looksLikeCurrencyAmount("Total $12.50")).toBe(true);
    expect(looksLikeCurrencyAmount("12,50 €")).toBe(true);
    expect(looksLikeCurrencyAmount("Continue")).toBe(false);
  });
});
