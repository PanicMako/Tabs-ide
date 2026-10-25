import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { renderDesktopIcon, type DesktopIconPlatform } from "./lib/desktop-icon.ts";
import {
  TABS_LOGO_VARIANTS,
  TABS_MARK,
  TABS_BRAND_COLORS,
  tabsLogoSvg,
  type TabsLogoVariant,
} from "@tabs/shared/tabsBrand";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function save(path: string, data: string | Buffer) {
  const target = resolve(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data);
}
const rasterMaster = await readFile(resolve(root, "assets/prod/tabs-blue-ink-master.png"));
const rasterDataUrl = `data:image/png;base64,${rasterMaster.toString("base64")}`;
const logoSvg = (id: TabsLogoVariant, format: "icon" | "symbol" | "horizontal" = "icon") =>
  tabsLogoSvg(id, format, rasterDataUrl);
async function png(id: TabsLogoVariant, size: number, platform?: DesktopIconPlatform) {
  if (platform) return renderDesktopIcon(Buffer.from(logoSvg(id)), size, platform);
  return sharp(Buffer.from(logoSvg(id)))
    .resize(size, size)
    .png()
    .toBuffer();
}
async function ico(id: TabsLogoVariant, platform?: DesktopIconPlatform) {
  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
  const images = await Promise.all(sizes.map((size) => png(id, size, platform)));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  images.forEach((image, index) => {
    const entry = 6 + index * 16,
      size = sizes[index]!;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  return Buffer.concat([header, ...images]);
}
async function icns(id: TabsLogoVariant) {
  const sizes = [
    ["icp4", 16],
    ["icp5", 32],
    ["icp6", 64],
    ["ic07", 128],
    ["ic08", 256],
    ["ic09", 512],
    ["ic10", 1024],
  ] as const;
  const chunks = await Promise.all(
    sizes.map(async ([type, size]) => {
      const image = await png(id, size, "mac"),
        header = Buffer.alloc(8);
      header.write(type);
      header.writeUInt32BE(image.length + 8, 4);
      return Buffer.concat([header, image]);
    }),
  );
  const header = Buffer.alloc(8);
  header.write("icns");
  header.writeUInt32BE(8 + chunks.reduce((length, chunk) => length + chunk.length, 0), 4);
  return Buffer.concat([header, ...chunks]);
}
for (const variant of TABS_LOGO_VARIANTS) {
  for (const app of ["web", "marketing", "exchange/frontend"]) {
    for (const format of ["icon", "symbol", "horizontal"] as const) {
      await save(
        `apps/${app}/public/brand/${variant.id}-${format}.svg`,
        logoSvg(variant.id, format),
      );
    }
  }
  await save(
    `apps/desktop/resources/brand/icon-${variant.id}.png`,
    await png(variant.id, 1024, "linux"),
  );
  await save(`apps/desktop/resources/brand/icon-${variant.id}.ico`, await ico(variant.id, "win"));
  await save(`apps/desktop/resources/brand/icon-${variant.id}.icns`, await icns(variant.id));
  await save(
    `apps/desktop/resources/brand/macos/icon-${variant.id}.png`,
    await png(variant.id, 1024, "mac"),
  );
}
for (const [alias, id] of [
  ["icon", "signature"],
  ["icon-dark", "ivory-ink"],
  ["icon-light", "blue-white"],
] as const) {
  await save(`apps/desktop/resources/${alias}.png`, await png(id, 1024, "mac"));
  await save(`apps/desktop/resources/${alias}.ico`, await ico(id, "win"));
  await save(`apps/desktop/resources/${alias}.icns`, await icns(id));
}
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2])
    await save(
      `apps/desktop/resources/icon.iconset/icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`,
      await png("signature", size * scale, "mac"),
    );
}
for (const app of ["web", "marketing", "exchange/frontend"]) {
  await save(`apps/${app}/public/brand/blue-ink-master.png`, rasterMaster);
  await save(`apps/${app}/public/tabs.svg`, tabsLogoSvg("blue-white", "symbol"));
  await save(`apps/${app}/public/favicon.ico`, await ico("signature"));
  await save(`apps/${app}/public/favicon.svg`, tabsLogoSvg("signature"));
  for (const size of [16, 32])
    await save(`apps/${app}/public/favicon-${size}x${size}.png`, await png("signature", size));
  await save(`apps/${app}/public/apple-touch-icon.png`, await png("signature", 180));
  await save(`apps/${app}/public/icon.png`, await png("signature", 1024));
}
await save("apps/web/public/tabs-icon.png", await png("signature", 1024));
for (const [mode, id] of [
  ["system", "signature"],
  ["light", "blue-white"],
  ["dark", "ivory-ink"],
] as const)
  await save(`apps/web/public/onboarding/app-icon-${mode}.png`, await png(id, 512));
console.log(
  "Generated five canonical logo treatments, browser icons and platform icon containers.",
);

for (const [name, id] of [
  ["signature", "signature"],
  ["light", "blue-white"],
  ["dark", "ivory-ink"],
] as const) {
  await save(`assets/prod/tabs-${name}.svg`, tabsLogoSvg(id));
  for (const app of ["web", "marketing", "exchange/frontend"])
    await save(`apps/${app}/public/icon-${name}.svg`, tabsLogoSvg(id));
}
const installer = await readFile(resolve(root, "apps/desktop/resources/dmg/background.svg"));
for (const scale of [1, 2])
  await save(
    `apps/desktop/resources/dmg/background${scale === 2 ? "@2x" : ""}.png`,
    await sharp(installer)
      .resize(480 * scale, 560 * scale)
      .png()
      .toBuffer(),
  );

// One share image for website metadata and the GitHub repository social preview.
const socialCard = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="${TABS_BRAND_COLORS.cobalt}"/><g fill="${TABS_BRAND_COLORS.ivory}"><g transform="translate(100 110) scale(1.05)"><path fill-rule="evenodd" d="${TABS_MARK.main}"/><path d="${TABS_MARK.detached}"/></g><path fill-rule="evenodd" transform="translate(594 235) scale(1.25)" d="${TABS_MARK.wordmark}"/></g></svg>`;
const socialPng = await sharp(Buffer.from(socialCard)).png().toBuffer();
await save("assets/prod/tabs-social-card.png", socialPng);
await save("apps/marketing/public/brand/social-card.png", socialPng);
