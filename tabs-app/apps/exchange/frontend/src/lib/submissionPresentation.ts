import { submissionLifecycle } from "@tabs/shared/extensionSubmission";

type Group = "progress" | "attention" | "published" | "unknown";
interface Presentation {
  label: string;
  group: Group;
  stage: number;
  explanation: string;
  next: string;
}
const states: Record<string, Presentation> = {
  uploaded: {
    label: "Waiting for a scan",
    group: "progress",
    stage: 0,
    explanation: "Your package has been received and is waiting for scanning to begin.",
    next: "Check back for scan results. You don’t need to submit it again.",
  },
  scanning: {
    label: "Scanning",
    group: "progress",
    stage: 1,
    explanation: "Automated checks are running on this exact package.",
    next: "Wait for the checks to finish, then open this version for the results.",
  },
  review: {
    label: "Awaiting review",
    group: "progress",
    stage: 1,
    explanation: "Your package is in the review queue. A reviewer still needs to make a decision.",
    next: "Check this version for reviewer feedback. It isn’t available to install yet.",
  },
  approved: {
    label: "Awaiting signed release",
    group: "progress",
    stage: 2,
    explanation:
      "Review is approved. Signed publication is still pending before this version becomes available.",
    next: "Wait for signed publication. Approval alone doesn’t make it installable.",
  },
  published: {
    label: "Published",
    group: "published",
    stage: 2,
    explanation: "This version is included in the registry’s signed publication metadata.",
    next: "Open its marketplace page to view the published extension.",
  },
  rejected: {
    label: "Changes needed",
    group: "attention",
    stage: 1,
    explanation:
      "This version was rejected. Read the review feedback before choosing your next step.",
    next: "Submit a corrected version, or appeal the decision for this exact package.",
  },
  revoked: {
    label: "Revoked",
    group: "attention",
    stage: 2,
    explanation:
      "This version’s release has been revoked. Read the recorded reason for the decision.",
    next: "Review the feedback, then prepare a new version or appeal the decision.",
  },
};
export function submissionPresentation(value: unknown): Presentation {
  return (
    states[submissionLifecycle(value).code] ?? {
      label: "Status unavailable",
      group: "unknown",
      stage: -1,
      explanation: "The registry returned a state this page cannot display.",
      next: "Refresh or contact the registry operator. Don’t assume this version is published.",
    }
  );
}
