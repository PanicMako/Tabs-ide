import {
  publisherSealViewBox,
  publisherSealMarkup,
  publisherVerificationLabel,
  publisherVerificationExplanation,
} from "@tabs/shared/publisherVerification";

let sealInstance = 0;
export function publisherVerifiedBadge(): HTMLSpanElement {
  const badge = document.createElement("span");
  badge.className = "publisher-verified-badge publisher-verification";
  badge.setAttribute("role", "img");
  badge.tabIndex = 0;
  badge.setAttribute("aria-label", publisherVerificationLabel);
  badge.setAttribute("aria-description", publisherVerificationExplanation);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("vb");
  svg.setAttribute("viewBox", publisherSealViewBox);
  svg.setAttribute("width", "28");
  svg.setAttribute("height", "28");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.innerHTML = publisherSealMarkup(`exchange-${++sealInstance}`);
  const tooltip = document.createElement("span");
  tooltip.className = "vb-tooltip";
  tooltip.setAttribute("aria-hidden", "true");
  tooltip.textContent = "Verified publisher";
  badge.append(svg, tooltip);
  return badge;
}
