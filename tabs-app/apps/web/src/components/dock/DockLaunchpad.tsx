import { useState } from "react";
import { ArrowUpRightIcon, ChevronRightIcon, ListOrderedIcon, TerminalIcon } from "lucide-react";
import { DockUfoIcon } from "../DockUfoIcon";

type Props = {
  projectName: string;
  cwd: string;
  onNewTerminal: () => void;
  onAdd: () => void;
};

/** Preview on hover or focus; only an explicit click starts work. */
export function DockLaunchpad({ projectName, cwd, onNewTerminal, onAdd }: Props) {
  const [preview, setPreview] = useState<"terminal" | "preset">("terminal");
  return (
    <section className="dock-setup" aria-label="Set up Dock">
      <div className="dock-launchpad" data-preview={preview}>
        <div className="dock-launchpad-heading">
          <DockUfoIcon className="dock-launchpad-mark" />
          <h2>Start something.</h2>
          <p>A shell for now. A preset for next time.</p>
        </div>
        <div className="dock-launchpad-bench">
          <div className="dock-launchpad-title">
            <span title={cwd}>{projectName}</span>
            <span>Preview</span>
          </div>
          <div className="dock-launchpad-stage" aria-hidden="true">
            <div className="dock-launchpad-scene" data-scene="terminal">
              <div className="dock-launchpad-prompt">
                <span>~/</span>
                <span className="dock-launchpad-directory">
                  {cwd.split(/[\\/]/).filter(Boolean).at(-1) || projectName}
                </span>
                <ChevronRightIcon className="dock-launchpad-chevron" size={16} />
                <span className="dock-launchpad-cursor" />
              </div>
              <p>One terminal. Wherever the work takes you.</p>
            </div>
            <div className="dock-launchpad-scene" data-scene="preset">
              <div className="dock-launchpad-command">
                <span>01</span>
                <code>npm install</code>
              </div>
              <div className="dock-launchpad-command">
                <span>02</span>
                <code>npm run dev</code>
              </div>
              <p>Example commands. Yours run in the order you choose.</p>
            </div>
          </div>
          <div className="dock-launchpad-choices">
            <button
              type="button"
              onPointerEnter={() => setPreview("terminal")}
              onFocus={() => setPreview("terminal")}
              onClick={onNewTerminal}
              aria-label="Open a terminal"
            >
              <TerminalIcon className="dock-launchpad-choice-icon" />
              <span>
                <strong>Open a terminal</strong>
                <small>For a command, or a little exploring.</small>
              </span>
              <ArrowUpRightIcon className="dock-launchpad-arrow" />
            </button>
            <button
              type="button"
              onPointerEnter={() => setPreview("preset")}
              onFocus={() => setPreview("preset")}
              onClick={onAdd}
              aria-label="Create a preset"
            >
              <ListOrderedIcon className="dock-launchpad-choice-icon" />
              <span>
                <strong>Create a preset</strong>
                <small>Save the commands you come back to.</small>
              </span>
              <ArrowUpRightIcon className="dock-launchpad-arrow" />
            </button>
          </div>
        </div>
        <p className="dock-launchpad-note">
          Creating a preset saves it. You choose when to run it.
        </p>
      </div>
    </section>
  );
}
