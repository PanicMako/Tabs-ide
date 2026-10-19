import { useId } from "react";
import {
  publisherSealViewBox,
  publisherSealMarkup,
  publisherVerificationLabel,
  publisherVerificationExplanation,
} from "@tabs/shared/publisherVerification";

export function PublisherVerifiedBadge({ showLabel = false }: { showLabel?: boolean }) {
  const id = useId();
  return (
    <span
      className="publisher-identity-seal publisher-verification"
      role="img"
      tabIndex={0}
      aria-label={publisherVerificationLabel}
      aria-description={publisherVerificationExplanation}
    >
      <svg
        className="vb"
        viewBox={publisherSealViewBox}
        width="28"
        height="28"
        aria-hidden="true"
        focusable="false"
        dangerouslySetInnerHTML={{ __html: publisherSealMarkup(id) }}
      />
      {showLabel && <span aria-hidden="true">Verified publisher</span>}
      <span className="vb-tooltip" aria-hidden="true">
        Verified publisher
      </span>
    </span>
  );
}
