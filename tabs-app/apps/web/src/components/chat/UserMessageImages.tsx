import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { ImageIcon, RotateCwIcon } from "lucide-react";
import { environmentApi } from "../../connection/environmentApiRegistry";
import { buildExpandedImagePreview, type ExpandedImagePreview } from "./ExpandedImagePreview";

type ImageAttachment = {
  id: string;
  name: string;
  mimeType: string;
  previewUrl?: string | undefined;
};

/** Stored attachments need environment-scoped, signed URLs; local drafts retain their blob preview. */
export function UserMessageImages({
  images,
  environmentId,
  onExpand,
}: {
  images: readonly ImageAttachment[];
  environmentId?: string | undefined;
  onExpand: (preview: ExpandedImagePreview) => void;
}) {
  const [failedLocal, setFailedLocal] = useState<ReadonlySet<string>>(new Set());
  const localUrls = images.map((image) =>
    !failedLocal.has(image.id) && /^(blob:|data:)/.test(image.previewUrl ?? "")
      ? image.previewUrl
      : undefined,
  );
  const queries = useQueries({
    queries: images.map((image, index) => ({
      queryKey: ["chat-attachment-image", environmentId, image.id, image.name, image.mimeType],
      enabled: !localUrls[index],
      queryFn: async () =>
        (await environmentApi(environmentId)).assets.createUrl({
          resource: {
            _tag: "attachment",
            attachmentId: image.id,
            fileName: image.name,
            mimeType: image.mimeType,
            disposition: "inline",
          },
        }),
      staleTime: 45 * 60_000,
      refetchInterval: 45 * 60_000,
      retry: 1,
    })),
  });
  const resolved = images.map((image, index) => ({
    ...image,
    previewUrl: localUrls[index] ?? queries[index]?.data?.relativeUrl,
  }));
  return (
    <div
      className={`user-message-images mb-2 ml-auto grid gap-2 ${images.length === 1 ? "max-w-[280px] grid-cols-1" : "max-w-[420px] grid-cols-2"}`}
    >
      {resolved.map((image, index) => (
        <AttachmentThumbnail
          key={image.id}
          image={image}
          loading={queries[index]?.isPending && !localUrls[index]}
          onLocalFailure={() => setFailedLocal((current) => new Set([...current, image.id]))}
          onRetry={() => {
            void queries[index]?.refetch();
          }}
          onExpand={() => {
            const preview = buildExpandedImagePreview(resolved, image.id);
            if (preview) onExpand(preview);
          }}
        />
      ))}
    </div>
  );
}

function AttachmentThumbnail({
  image,
  loading,
  onLocalFailure,
  onRetry,
  onExpand,
}: {
  image: ImageAttachment;
  loading: boolean | undefined;
  onLocalFailure: () => void;
  onRetry: () => void;
  onExpand: () => void;
}) {
  const [failedUrl, setFailedUrl] = useState<string | undefined>();
  const ready = image.previewUrl && image.previewUrl !== failedUrl;
  return (
    <div className="overflow-hidden rounded-lg border border-border/80 bg-background/70">
      {ready ? (
        <button
          type="button"
          className="block w-full cursor-zoom-in"
          aria-label={`Preview ${image.name}`}
          onClick={onExpand}
        >
          <img
            src={image.previewUrl}
            alt={image.name}
            className="block max-h-[220px] w-full object-contain"
            onError={() => {
              setFailedUrl(image.previewUrl);
              if (/^(blob:|data:)/.test(image.previewUrl ?? "")) onLocalFailure();
            }}
          />
        </button>
      ) : (
        <div
          className="flex min-h-[120px] flex-col items-center justify-center gap-2 px-3 py-4 text-xs text-muted-foreground"
          role="status"
        >
          <ImageIcon className="size-5" aria-hidden="true" />
          <span className="max-w-full truncate" title={image.name}>
            {image.name}
          </span>
          {loading ? (
            <span>Loading image…</span>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-foreground"
              onClick={() => {
                setFailedUrl(undefined);
                onRetry();
              }}
            >
              <RotateCwIcon className="size-3" />
              Retry image
            </button>
          )}
        </div>
      )}
    </div>
  );
}
