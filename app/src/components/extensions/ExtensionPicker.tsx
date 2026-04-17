import { useState } from "react";
import { useExtensions } from "@/lib/extensions/queries";
import { Button } from "@stac-higher/shared";
import { Badge } from "@stac-higher/shared";
import { Input } from "@stac-higher/shared";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Check, ChevronDown, Search, Puzzle } from "lucide-react";

function getSchemaUrl(extensionId: string): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/api/extensions/${encodeURIComponent(extensionId)}/schema`;
}

interface ExtensionPickerProps {
  value: string[];
  onChange: (urls: string[]) => void;
  placeholder?: string;
}

export function ExtensionPicker({
  value,
  onChange,
  placeholder = "Select extensions...",
}: ExtensionPickerProps) {
  const { data: extensions, isLoading } = useExtensions();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const allExtensions = extensions ?? [];

  const filtered = search
    ? allExtensions.filter(
        (e) =>
          e.name.toLowerCase().includes(search.toLowerCase()) ||
          e.prefix.toLowerCase().includes(search.toLowerCase()),
      )
    : allExtensions;

  function toggleExtension(extensionId: string) {
    const url = getSchemaUrl(extensionId);
    if (value.includes(url)) {
      onChange(value.filter((u) => u !== url));
    } else {
      onChange([...value, url]);
    }
  }

  function isSelected(extensionId: string): boolean {
    return value.includes(getSchemaUrl(extensionId));
  }

  const selectedCount = allExtensions.filter((e) => isSelected(e.id)).length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="text-muted-foreground">
            {selectedCount > 0
              ? `${selectedCount} extension${selectedCount !== 1 ? "s" : ""} selected`
              : placeholder}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search extensions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
        </div>

        <div className="max-h-60 overflow-y-auto p-1">
          {isLoading ? (
            <p className="text-xs text-muted-foreground text-center py-3">
              Loading extensions...
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">
              {search ? `No extensions match "${search}"` : "No extensions available"}
            </p>
          ) : (
            filtered.map((ext) => {
              const selected = isSelected(ext.id);
              return (
                <button
                  key={ext.id}
                  type="button"
                  onClick={() => toggleExtension(ext.id)}
                  className="flex items-start gap-2 w-full px-2 py-2 rounded-md text-left text-sm hover:bg-accent/50 transition-colors"
                >
                  <div className="flex h-4 w-4 items-center justify-center shrink-0 mt-0.5">
                    {selected ? (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <div className="h-3.5 w-3.5 rounded-sm border border-border" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium truncate">{ext.name}</span>
                      <Badge
                        variant={ext.source === "external" ? "outline" : "secondary"}
                        className="text-[10px] px-1 py-0 h-4"
                      >
                        {ext.prefix}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        v{ext.version}
                      </span>
                    </div>
                    {ext.description && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {ext.description}
                      </p>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {allExtensions.length === 0 && !isLoading && (
          <div className="p-3 border-t border-border">
            <a
              href="/extensions/new"
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              <Puzzle className="h-3 w-3" />
              Create your first extension
            </a>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
