import { useState, type ComponentType } from "react";
import { SearchIcon } from "lucide-react";
import { SegmentedControl } from "../ui/segmented-control";
import "./providers.css";

export interface ProviderDirectoryEntry {
  id: string;
  name: string;
  icon: ComponentType<{ className?: string }>;
  enabled: boolean;
  status: string;
  statusClass: string;
  modelCount: number;
}

export function ProviderDirectory({
  entries,
  selectedId,
  onSelect,
}: {
  entries: readonly ProviderDirectoryEntry[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const visible = entries.filter(
    (entry) =>
      (filter !== "enabled" || entry.enabled) &&
      entry.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <nav className="provider-directory" aria-label="Provider directory">
      <label className="provider-search">
        <SearchIcon size={14} aria-hidden />
        <input
          aria-label="Find a provider"
          placeholder="Find a provider…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <SegmentedControl
        size="sm"
        value={filter}
        onValueChange={setFilter}
        aria-label="Provider filter"
        options={[
          { value: "all", label: `All ${entries.length}` },
          { value: "enabled", label: `Enabled ${entries.filter((entry) => entry.enabled).length}` },
        ]}
      />
      <div className="provider-directory-list">
        {visible.map(({ id, name, icon: Icon, enabled, status, statusClass, modelCount }) => (
          <button
            type="button"
            key={id}
            aria-current={id === selectedId ? "true" : undefined}
            onClick={() => onSelect(id)}
          >
            <span className="provider-directory-icon">
              <Icon className="size-4" />
            </span>
            <span className="provider-directory-name">
              <strong>{name}</strong>
              <span>{enabled ? status : "Disabled"}</span>
            </span>
            <span
              className={`provider-directory-dot ${enabled ? statusClass : "bg-muted-foreground/40"}`}
              aria-hidden
            />
            <span className="provider-directory-count" title={`${modelCount} models`}>
              {modelCount}
            </span>
          </button>
        ))}
        {visible.length === 0 ? (
          <p role="status" className="provider-directory-empty">
            No matching providers.
          </p>
        ) : null}
      </div>
    </nav>
  );
}
