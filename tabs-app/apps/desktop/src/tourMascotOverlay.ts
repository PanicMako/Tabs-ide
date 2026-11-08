import * as Path from "node:path";
import { WebContentsView, type BrowserWindow, type WebContents } from "electron";
import {
  getTourMascotBounds,
  isTourMascotArtwork,
  moveTourMascot,
  readTourMascotInput,
  tourMascotHtml,
  type TourMascotPosition,
} from "@tabs/shared/tourMascot";
import type { NativeViewStackCoordinator } from "./nativeViewStackCoordinator";

export class TourMascotOverlay {
  private view: WebContentsView | null = null;
  private position: TourMascotPosition | null = null;
  private window: BrowserWindow | null = null;
  private loading: Promise<void> | null = null;
  private reducedMotion = false;
  private dark = false;
  private readonly resize = () => this.updateBounds();

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly coordinator: NativeViewStackCoordinator,
  ) {}

  public async sync(raw: unknown): Promise<boolean> {
    if (raw === null) {
      this.position = null;
      this.view?.setVisible(false);
      return true;
    }
    if (!raw || typeof raw !== "object") return false;
    const state = raw as {
      position?: Partial<TourMascotPosition>;
      reducedMotion?: boolean;
      artwork?: unknown;
      dark?: boolean;
    };
    const { x, y } = state.position ?? {};
    const window = this.getWindow();
    if (
      !window ||
      window.isDestroyed() ||
      typeof x !== "number" ||
      typeof y !== "number" ||
      !(x >= 0 && x <= 1 && y >= 0 && y <= 1)
    )
      return false;

    const artwork = state.artwork;
    if (!isTourMascotArtwork(artwork)) return false;
    const reducedMotion = state.reducedMotion === true;
    const dark = state.dark === true;
    if (
      this.view &&
      (this.window !== window || reducedMotion !== this.reducedMotion || dark !== this.dark)
    )
      this.destroy();
    this.position = { x, y };
    if (!this.view) {
      this.window = window;
      this.reducedMotion = reducedMotion;
      this.dark = dark;
      const view = new WebContentsView({
        webPreferences: {
          preload: Path.join(__dirname, "notificationPreload.js"),
          sandbox: true,
          contextIsolation: true,
        },
      });
      this.view = view;
      view.setBackgroundColor("#00000000");
      view.setVisible(false);
      view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      this.coordinator.setTourMascotView(view);
      window.on("resize", this.resize);
      this.loading = view.webContents.loadURL(
        `data:text/html;base64,${Buffer.from(tourMascotHtml(reducedMotion, artwork, dark)).toString("base64")}`,
      );
    }
    const loading = this.loading;
    try {
      await loading;
    } catch {
      if (this.loading === loading) this.destroy();
      return false;
    }
    if (this.loading !== loading || !this.view || !this.position) return true;
    this.updateBounds();
    this.view.setVisible(true);
    this.coordinator.ensureTopmost();
    return true;
  }

  public input(sender: WebContents, raw: unknown): void {
    const window = this.window;
    const input = readTourMascotInput(raw);
    const view = this.view;
    if (
      !view ||
      sender !== view.webContents ||
      !window ||
      window.isDestroyed() ||
      !this.position ||
      !input
    )
      return;
    if (input.type === "resume") {
      this.position = null;
      view.setVisible(false);
      window.webContents.focus();
      window.webContents.send("desktop:tour-mascot:event", { type: "resume" });
      return;
    }
    const [width, height] = window.getContentSize();
    if (width === undefined || height === undefined) return;
    this.position = moveTourMascot(this.position, input, width, height);
    this.updateBounds();
    if (input.type === "corner" || input.done) {
      window.webContents.send("desktop:tour-mascot:event", {
        type: "move",
        position: this.position,
      });
      this.coordinator.restoreLastFocusedWebContents();
    }
  }

  public destroy(): void {
    this.window?.removeListener("resize", this.resize);
    this.coordinator.setTourMascotView(null);
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.window = null;
    this.view = null;
    this.position = null;
    this.loading = null;
  }

  private updateBounds(): void {
    if (!this.position || !this.window || this.window.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    if (width === undefined || height === undefined || !this.view) return;
    this.view.setBounds(getTourMascotBounds(this.position, width, height));
  }
}
