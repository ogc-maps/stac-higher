import { useState } from "react";
import { useImportExtension } from "@/lib/extensions/queries";
import { Button } from "@stac-higher/shared";
import { Input } from "@stac-higher/shared";
import { Label } from "@stac-higher/shared";
import { Badge } from "@stac-higher/shared";
import {
  Card,
  CardContent,
} from "@stac-higher/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { ExternalLink, Hash, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ExtensionPreview {
  name: string;
  prefix: string;
  version: string;
  description: string;
  propertyCount: number;
}

const CURATED_EXTENSIONS = [
  {
    name: "Electro-Optical (EO)",
    prefix: "eo",
    description: "Properties for optical sensors",
    url: "https://stac-extensions.github.io/eo/v1.1.0/schema.json",
  },
  {
    name: "SAR",
    prefix: "sar",
    description: "Synthetic Aperture Radar",
    url: "https://stac-extensions.github.io/sar/v1.0.0/schema.json",
  },
  {
    name: "View Geometry",
    prefix: "view",
    description: "Viewing angles and geometry",
    url: "https://stac-extensions.github.io/view/v1.0.0/schema.json",
  },
  {
    name: "Projection",
    prefix: "proj",
    description: "Coordinate reference system info",
    url: "https://stac-extensions.github.io/projection/v1.1.0/schema.json",
  },
  {
    name: "Timestamps",
    prefix: "ts",
    description: "Additional timestamps for items",
    url: "https://stac-extensions.github.io/timestamps/v1.1.0/schema.json",
  },
] as const;

interface ImportExtensionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportExtensionDialog({
  open,
  onOpenChange,
}: ImportExtensionDialogProps) {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<ExtensionPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const importMutation = useImportExtension();

  const reset = () => {
    setUrl("");
    setPreview(null);
    setPreviewError(null);
    setPreviewing(false);
  };

  const handleClose = (open: boolean) => {
    if (!open) reset();
    onOpenChange(open);
  };

  const handleSelectCurated = (curatedUrl: string) => {
    setUrl(curatedUrl);
    setPreview(null);
    setPreviewError(null);
  };

  const handlePreview = async () => {
    if (!url.trim()) return;
    setPreviewing(true);
    setPreview(null);
    setPreviewError(null);

    try {
      const res = await fetch("/api/extensions/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPreviewError(data.error ?? "Preview failed");
      } else {
        setPreview(data as ExtensionPreview);
      }
    } catch {
      setPreviewError("Network error — could not reach the schema URL");
    } finally {
      setPreviewing(false);
    }
  };

  const handleImport = () => {
    if (!url.trim()) return;
    importMutation.mutate(url.trim(), {
      onSuccess: (ext) => {
        toast.success(`"${ext.name}" imported successfully`);
        reset();
        onOpenChange(false);
      },
      onError: (err) => {
        toast.error(err instanceof Error ? err.message : "Import failed");
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Extension</DialogTitle>
          <DialogDescription>
            Import a STAC extension from a remote JSON Schema URL. Preview the
            schema before confirming.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Quick-import list */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">
              Quick Import
            </Label>
            <div className="grid grid-cols-1 gap-1.5">
              {CURATED_EXTENSIONS.map((ext) => (
                <button
                  key={ext.url}
                  type="button"
                  onClick={() => handleSelectCurated(ext.url)}
                  className={`flex items-center justify-between px-3 py-2 rounded-md border text-left text-sm transition-colors hover:bg-accent/50 ${
                    url === ext.url
                      ? "border-primary bg-accent/30"
                      : "border-border"
                  }`}
                >
                  <div>
                    <span className="font-medium">{ext.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {ext.description}
                    </span>
                  </div>
                  <Badge variant="secondary" className="font-mono text-xs shrink-0 ml-2">
                    {ext.prefix}
                  </Badge>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">or enter URL</span>
            <Separator className="flex-1" />
          </div>

          {/* URL Input */}
          <div className="space-y-2">
            <Label htmlFor="import-url">Schema URL</Label>
            <div className="flex gap-2">
              <Input
                id="import-url"
                placeholder="https://stac-extensions.github.io/..."
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setPreview(null);
                  setPreviewError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handlePreview();
                }}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handlePreview}
                disabled={!url.trim() || previewing}
              >
                {previewing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Preview"
                )}
              </Button>
            </div>
            {previewError && (
              <p className="text-xs text-destructive">{previewError}</p>
            )}
          </div>

          {/* Preview card */}
          {preview && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-sm">{preview.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      prefix: {preview.prefix} · v{preview.version}
                    </p>
                  </div>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                    title="Open schema URL"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
                {preview.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {preview.description}
                  </p>
                )}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Hash className="h-3 w-3" />
                  <span>
                    {preview.propertyCount}{" "}
                    {preview.propertyCount === 1 ? "property" : "properties"}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={!url.trim() || importMutation.isPending || !preview}
          >
            {importMutation.isPending ? "Importing..." : "Import Extension"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
