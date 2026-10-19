import {
  publisherSealViewBox,
  publisherSealPath,
  publisherSealCheck,
  publisherVerificationLabel,
  publisherVerificationExplanation,
} from "@tabs/shared/publisherVerification";

export function PublisherVerifiedBadge({ showLabel = false }: { showLabel?: boolean }) {
  return (
    <span
      className="publisher-identity-seal"
      role="img"
      aria-label={publisherVerificationLabel}
      title={publisherVerificationExplanation}
    >
      <svg
        viewBox={publisherSealViewBox}
        width="18"
        height="18"
        aria-hidden="true"
        focusable="false"
      >
        <path d={publisherSealPath} fill="currentColor" />
        <path
          d={publisherSealCheck}
          fill="none"
          stroke="white"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {showLabel && <span aria-hidden="true">Verified publisher</span>}
    </span>
  );
}
