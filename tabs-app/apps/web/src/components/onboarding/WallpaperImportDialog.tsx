import { useEffect, useRef, useState, type RefObject } from "react";
import { UploadIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { SegmentedControl } from "../ui/segmented-control";
import { addCustomWallpaper, getCustomWallpapers, type WallpaperOption } from "./wallpapers";

export function WallpaperImportDialog({
  isOpen,
  onClose,
  onImport,
  finalFocus,
  setupTypography,
}: {
  isOpen: boolean;
  onClose: () => void;
  onImport: (wallpaper: WallpaperOption) => void;
  finalFocus: RefObject<HTMLElement | null>;
  setupTypography?: boolean;
}) {
  const [importSource, setImportSource] = useState<"file" | "url">("file");
  const [customUrlInput, setCustomUrlInput] = useState("");
  const [customLabelInput, setCustomLabelInput] = useState("");
  const [importError, setImportError] = useState("");
  const fileReader = useRef<FileReader | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (isOpen) {
      setImportSource("file");
      setImportError("");
    }
    return () => fileReader.current?.abort();
  }, [isOpen]);

  const saveCustomImage = (label: string, url: string, description: string) => {
    const added = addCustomWallpaper({ label, url, description });
    const saved = getCustomWallpapers();
    if (!saved.some((wallpaper) => wallpaper.id === added.id)) {
      setImportError("Tabs couldn’t save this image. Try a smaller file or use an image URL.");
      return;
    }
    onImport(added);
    onClose();
    setCustomUrlInput("");
    setCustomLabelInput("");
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportError("");
    fileReader.current?.abort();
    const reader = new FileReader();
    fileReader.current = reader;
    reader.onload = () => {
      if (typeof reader.result === "string") {
        saveCustomImage(
          file.name.replace(/\.[^/.]+$/, "") || "Custom wallpaper",
          reader.result,
          "Uploaded image",
        );
      }
    };
    reader.onerror = () => setImportError("Tabs couldn’t read this image. Choose another file.");
    reader.readAsDataURL(file);
  };

  const handleAddUrl = () => {
    if (!customUrlInput.trim()) return;
    setImportError("");
    saveCustomImage(
      customLabelInput.trim() || "Custom wallpaper",
      customUrlInput.trim(),
      "Added by URL",
    );
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) fileReader.current?.abort();
        if (!open) onClose();
      }}
    >
      <DialogPopup
        bottomStickOnMobile={false}
        finalFocus={finalFocus}
        backdropClassName="backdrop-blur-none"
        className={cn("overflow-y-auto bg-background", setupTypography && "setup-typography")}
      >
        <DialogHeader>
          <DialogTitle>Add custom wallpaper</DialogTitle>
          <DialogDescription>Choose an image for your agent workspace.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (importSource === "url") handleAddUrl();
          }}
        >
          <div className="space-y-4 px-5 pb-5">
            <SegmentedControl
              size="sm"
              aria-label="Image source"
              value={importSource}
              onValueChange={(source) => {
                fileReader.current?.abort();
                setImportError("");
                setImportSource(source);
              }}
              options={[
                { value: "file", label: "Upload file" },
                { value: "url", label: "From URL" },
              ]}
              className="w-fit"
            />
            {importSource === "file" ? (
              <p className="text-sm text-muted-foreground">
                The image takes its name from the file. Choose a landscape image for the best fit.
              </p>
            ) : null}
            <div hidden={importSource !== "url"} className="space-y-4">
              <label className="block space-y-2 text-sm">
                <span>Image URL</span>
                <Input
                  type="url"
                  value={customUrlInput}
                  onChange={(event) => setCustomUrlInput(event.target.value)}
                  placeholder="https://…"
                  disabled={importSource !== "url"}
                />
              </label>
              <label className="block space-y-2 text-sm">
                <span>Scene name (optional)</span>
                <Input
                  value={customLabelInput}
                  onChange={(event) => setCustomLabelInput(event.target.value)}
                />
              </label>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              hidden
            />
            {importError && (
              <p role="alert" className="text-sm text-destructive">
                {importError}
              </p>
            )}
          </div>
          <DialogFooter className="flex-row flex-wrap justify-end">
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            {importSource === "file" ? (
              <Button type="button" onClick={() => fileInputRef.current?.click()}>
                <UploadIcon aria-hidden="true" /> Choose image
              </Button>
            ) : (
              <Button type="submit" disabled={!customUrlInput.trim()}>
                Add Image
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
