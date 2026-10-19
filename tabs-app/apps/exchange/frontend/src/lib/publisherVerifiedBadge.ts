import {
  publisherSealViewBox,
  publisherSealPath,
  publisherSealCheck,
  publisherVerificationLabel,
  publisherVerificationExplanation,
} from "@tabs/shared/publisherVerification";

export function publisherVerifiedBadge(): HTMLSpanElement {
  const badge = document.createElement("span");
  badge.className = "publisher-verified-badge";
  badge.setAttribute("role", "img");
  badge.setAttribute("aria-label", publisherVerificationLabel);
  badge.title = publisherVerificationExplanation;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", publisherSealViewBox);
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const body = document.createElementNS(svg.namespaceURI, "path");
  body.setAttribute("d", publisherSealPath);
  body.setAttribute("fill", "currentColor");
  const check = document.createElementNS(svg.namespaceURI, "path");
  check.setAttribute("d", publisherSealCheck);
  check.setAttribute("fill", "none");
  check.setAttribute("stroke", "white");
  check.setAttribute("stroke-width", "1.9");
  check.setAttribute("stroke-linecap", "round");
  check.setAttribute("stroke-linejoin", "round");
  svg.append(body, check);
  badge.append(svg);
  return badge;
}
