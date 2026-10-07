const palettes = [
  ["#3259ed", "#e1e8ff"],
  ["#b77150", "#f7dcc8"],
  ["#365877", "#dce8ee"],
  ["#267c70", "#d8eee2"],
  ["#99643e", "#f8dfbd"],
] as const;

function panel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 4);
  ctx.fill();
  ctx.stroke();
}

function line(ctx: CanvasRenderingContext2D, points: number[][]) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.stroke();
}

/** Small editorial illustrations, shared by the boats, catches, and collection shelf. */
export function drawSurfTool(ctx: CanvasRenderingContext2D, index: number, size = 1) {
  const [ink, wash] = palettes[index];
  ctx.save();
  ctx.scale(size, size);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  if (index === 1) {
    ctx.rotate(-0.12);
    ctx.fillStyle = wash;
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.beginPath();
    for (let i = 0; i < 24; i++) {
      const a = (i * Math.PI) / 12;
      const r = i % 2 ? 8 : 19;
      if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#fffaf0";
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
  } else if (index === 3) {
    ctx.rotate(0.1);
    panel(ctx, -19, -24, 38, 46, wash);
    ctx.lineWidth = 2;
    line(ctx, [
      [-7, 11],
      [-7, -13],
    ]);
    ctx.beginPath();
    ctx.moveTo(-7, 5);
    ctx.bezierCurveTo(-7, -1, 8, 2, 8, -10);
    ctx.stroke();
    for (const [x, y] of [
      [-7, 11],
      [-7, -13],
      [8, -12],
    ]) {
      ctx.fillStyle = "#fffefa";
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else {
    ctx.rotate(index === 4 ? 0.09 : -0.08);
    ctx.fillStyle = ink;
    ctx.globalAlpha *= 0.13;
    ctx.beginPath();
    ctx.roundRect(-20, -15, 47, 36, 4);
    ctx.fill();
    ctx.globalAlpha /= 0.13;
    panel(ctx, -24, -20, 47, 36, index === 2 ? "#263e55" : "#fffefa");
    ctx.strokeStyle = index === 2 ? "#9bb9cd" : ink;
    ctx.lineWidth = 0.8;
    line(ctx, [
      [-24, -10],
      [23, -10],
    ]);
    ctx.fillStyle = index === 2 ? "#a5cfb2" : ink;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(-18 + i * 5, -15, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineWidth = 1.8;
    if (index === 0) {
      line(ctx, [
        [-10, -3],
        [-16, 3],
        [-10, 9],
      ]);
      line(ctx, [
        [10, -3],
        [16, 3],
        [10, 9],
      ]);
      line(ctx, [
        [4, -5],
        [-2, 11],
      ]);
    } else if (index === 2) {
      ctx.strokeStyle = "#d8eee2";
      line(ctx, [
        [-14, -2],
        [-8, 3],
        [-14, 8],
      ]);
      line(ctx, [
        [-3, 8],
        [6, 8],
      ]);
    } else {
      ctx.fillStyle = wash;
      ctx.fillRect(-18, -5, 18, 15);
      ctx.fillStyle = "#edbf78";
      ctx.beginPath();
      ctx.arc(-8, 0, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(-17, 9);
      ctx.lineTo(-9, 2);
      ctx.lineTo(-1, 9);
      ctx.fill();
      ctx.lineWidth = 1;
      line(ctx, [
        [5, -2],
        [17, -2],
      ]);
      line(ctx, [
        [5, 3],
        [14, 3],
      ]);
      line(ctx, [
        [5, 8],
        [17, 8],
      ]);
    }
  }
  ctx.restore();
}

/** A folded paper hull and quiet wake make pickups part of the sea. */
export function drawToolBoat(ctx: CanvasRenderingContext2D, index: number) {
  ctx.save();
  ctx.strokeStyle = "#ffffffb0";
  ctx.lineWidth = 1.4;
  line(ctx, [
    [-35, 23],
    [-16, 21],
    [3, 23],
  ]);
  line(ctx, [
    [10, 24],
    [24, 22],
    [37, 23],
  ]);
  ctx.fillStyle = "#486e8215";
  ctx.beginPath();
  ctx.ellipse(1, 19, 29, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(0, -9);
  drawSurfTool(ctx, index, 0.8);
  ctx.restore();
  ctx.fillStyle = "#fffaf0";
  ctx.strokeStyle = "#a1b6bd";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-30, 1);
  ctx.lineTo(-17, 18);
  ctx.quadraticCurveTo(0, 22, 17, 18);
  ctx.lineTo(31, 1);
  ctx.lineTo(0, 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#e7e9dc";
  ctx.beginPath();
  ctx.moveTo(-30, 1);
  ctx.lineTo(0, 7);
  ctx.lineTo(-17, 18);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#c5cec1";
  line(ctx, [
    [0, 7],
    [17, 18],
  ]);
  ctx.restore();
}

export function toolkitLayout(width: number) {
  const scale = width < 650 ? 0.8 : 1;
  const step = 50 * scale;
  return { scale, step, left: width - 18 - step * 4 - 20 * scale, top: width < 650 ? 38 : 51 };
}
