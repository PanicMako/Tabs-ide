import type { CSSProperties } from "react";
import { FilesIcon, GitBranchIcon, SearchIcon } from "lucide-react";
import {
  evaluateThemeTokens,
  ensureMinContrast,
  type CustomThemeConfig,
} from "@tabs/shared/themeDerivation";
import "./theme-collection.css";

/** A non-interactive specimen painted from the same tokens as the real workbench. */
export function ThemeWorkspaceSpecimen({ config }: { config: CustomThemeConfig }) {
  const tokens = evaluateThemeTokens(config);
  const style = {
    "--spec-ground": config.colors.background,
    "--spec-paper": tokens["editor.background"],
    "--spec-ink": tokens["editor.foreground"],
    "--spec-muted": tokens["descriptionForeground"],
    "--spec-edge": config.colors.border,
    "--spec-accent": ensureMinContrast(
      config.colors.primary,
      tokens["editor.background"] ?? config.colors.card,
      4.5,
    ),
    "--spec-on-accent": tokens["button.foreground"],
  } as CSSProperties;
  return (
    <div className="theme-specimen" style={style} aria-hidden="true">
      <div className="theme-specimen-top">
        <span>tabs / studio</span>
        <span>Workspace</span>
        <span>⌘ K</span>
      </div>
      <div className="theme-specimen-body">
        <div className="theme-specimen-rail">
          <FilesIcon />
          <SearchIcon />
          <GitBranchIcon />
        </div>
        <div className="theme-specimen-tree">
          <strong>Explorer</strong>
          <span>⌄ studio</span>
          <span>　app.tsx</span>
          <span>　theme.ts</span>
          <span>　package.json</span>
          <small>main · 2 changes</small>
        </div>
        <div className="theme-specimen-editor">
          <div className="theme-specimen-tab">
            theme.ts <span>×</span>
          </div>
          <div className="theme-specimen-code">
            <div>
              <i>1</i>
              <em>export const</em> workspace = {"{"}
            </div>
            <div>
              <i>2</i>　name: <b>"A space to make"</b>,
            </div>
            <div>
              <i>3</i>　appearance: <b>"intentional"</b>,
            </div>
            <div>
              <i>4</i>　details: <em>true</em>,
            </div>
            <div>
              <i>5</i>
              {"};"}
            </div>
            <div className="theme-specimen-comment">
              <i>6</i>// Make room for your next idea.
            </div>
            <div>
              <i>7</i>
              <span className="theme-specimen-cursor" />
            </div>
          </div>
          <div className="theme-specimen-result">
            <span>
              <i />
              All changes saved
            </span>
            <span>TypeScript</span>
          </div>
        </div>
      </div>
    </div>
  );
}
