/**
 * imageProcessor.ts — 图像预处理工具
 *
 * calculateROIWithPadding: 根据检测模块对 BBox 扩充 padding，并
 * 约束在图像边界内，保证裁切结果有效。
 *
 * 公式（技术需求方案 §4.1）：
 *   W_new = W × (1 + 2p)
 *   H_new = H × (1 + 2p)
 *   x_new = x - W × p
 *   y_new = y - H × p
 *   结果 clamp 到 [0, imageWidth/imageHeight]
 */

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * 各检测模块的推荐 padding 比例（技术需求方案 §4.1）
 * oral     口腔  25%
 * skin     皮肤  50%
 * ear      耳部  30%
 * eye      眼部  30%
 * excrement 粪便 20%
 * vomit    呕吐物 20%
 */
export const MODULE_PADDING: Record<string, number> = {
  oral:       0.25,
  skin:       0.50,
  ear:        0.30,
  eye:        0.30,
  excrement:  0.20,
  vomit:      0.20,
};

/**
 * 根据 paddingPercent 扩充 BBox 并 clamp 到图像边界。
 *
 * @param bbox            原始检测框 { x, y, width, height }（像素）
 * @param paddingPercent  扩充比例，如 0.25 表示 25%
 * @param imageDimensions 原始图像尺寸 { width, height }（像素）
 * @returns               扩充并 clamp 后的 BBox
 */
export function calculateROIWithPadding(
  bbox: BBox,
  paddingPercent: number,
  imageDimensions: ImageDimensions,
): BBox {
  const p = paddingPercent;

  const xNew = bbox.x - bbox.width * p;
  const yNew = bbox.y - bbox.height * p;
  const wNew = bbox.width  * (1 + 2 * p);
  const hNew = bbox.height * (1 + 2 * p);

  // clamp origin 到图像左上角
  const xClamped = Math.max(0, xNew);
  const yClamped = Math.max(0, yNew);

  // clamp 尺寸，确保右/下边缘不超出图像
  const wClamped = Math.min(wNew, imageDimensions.width  - xClamped);
  const hClamped = Math.min(hNew, imageDimensions.height - yClamped);

  return {
    x:      xClamped,
    y:      yClamped,
    width:  wClamped,
    height: hClamped,
  };
}
