import { ImagePlusIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface EditableImage {
  id: string;
  name: string;
  src: string;
}

export interface MessageEdit {
  text: string;
  /** Ids of the images that were there before and are kept, in order. */
  keptImageIds: ReadonlyArray<string>;
  /** Images added while editing. */
  addedImages: ReadonlyArray<File>;
}

/**
 * Edits a saved or waiting message in place: its text and its images. Images can be added with
 * the button, by pasting or by dropping them on the field. ⌘↵ saves, Esc cancels.
 */
export function MessageEditor({
  initialText,
  images,
  label,
  onSave,
  onCancel,
}: {
  initialText: string;
  images: ReadonlyArray<EditableImage>;
  label: string;
  onSave: (edit: MessageEdit) => Promise<boolean> | boolean;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [kept, setKept] = useState<ReadonlyArray<EditableImage>>(images);
  const [added, setAdded] = useState<ReadonlyArray<{ file: File; src: string }>>([]);
  const [saving, setSaving] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const addedRef = useRef(added);
  addedRef.current = added;
  useEffect(() => () => addedRef.current.forEach((image) => URL.revokeObjectURL(image.src)), []);

  const addFiles = (files: Iterable<File>) => {
    const next = [...files].filter((file) => file.type.startsWith("image/"));
    if (next.length)
      setAdded((current) => [
        ...current,
        ...next.map((file) => ({ file, src: URL.createObjectURL(file) })),
      ]);
  };
  const changed =
    text !== initialText ||
    added.length > 0 ||
    kept.length !== images.length ||
    kept.some((image, index) => image.id !== images[index]?.id);
  const save = async () => {
    if (!changed || saving) return;
    setSaving(true);
    try {
      const done = await onSave({
        text,
        keptImageIds: kept.map((image) => image.id),
        addedImages: added.map((image) => image.file),
      });
      if (done) onCancel();
    } finally {
      setSaving(false);
    }
  };
  const thumbs = [
    ...kept.map((image) => ({ key: image.id, src: image.src, name: image.name, kind: "kept" })),
    ...added.map((image, index) => ({
      key: `added-${index}`,
      src: image.src,
      name: image.file.name,
      kind: "added",
    })),
  ];
  return (
    <div
      className="sl-editor"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        addFiles(event.dataTransfer.files);
      }}
    >
      <textarea
        aria-label={label}
        autoFocus
        value={text}
        rows={Math.min(12, Math.max(3, text.split("\n").length + 1))}
        onChange={(event) => setText(event.target.value)}
        onPaste={(event) => {
          if (event.clipboardData.files.length) {
            event.preventDefault();
            addFiles(event.clipboardData.files);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void save();
          }
        }}
      />
      {thumbs.length > 0 && (
        <div className="sl-editor-images">
          {thumbs.map((image) => (
            <span key={image.key} className="sl-editor-image">
              <img src={image.src} alt={image.name} title={image.name} data-shape="tile" />
              <button
                type="button"
                aria-label={`Remove ${image.name}`}
                title="Remove image"
                onClick={() =>
                  image.kind === "kept"
                    ? setKept((current) => current.filter((item) => item.id !== image.key))
                    : setAdded((current) => {
                        const index = Number(image.key.slice("added-".length));
                        const removed = current[index];
                        if (removed) URL.revokeObjectURL(removed.src);
                        return current.filter((_, position) => position !== index);
                      })
                }
              >
                <XIcon aria-hidden="true" size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="sl-editor-actions">
        <button
          type="button"
          className="sl-secondary"
          title="Add images. You can also paste or drop them here."
          onClick={() => picker.current?.click()}
        >
          <ImagePlusIcon aria-hidden="true" size={13} />
          Image
        </button>
        <input
          ref={picker}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <span className="sl-editor-hint">⌘↵ to save · Esc to cancel</span>
        <button type="button" className="sl-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="sl-primary"
          disabled={!changed || saving}
          onClick={() => void save()}
        >
          {saving && <LoaderCircleIcon aria-hidden="true" size={13} className="animate-spin" />}
          Save
        </button>
      </div>
    </div>
  );
}
