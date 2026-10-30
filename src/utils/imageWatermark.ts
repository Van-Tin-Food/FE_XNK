// Đóng dấu logo công ty lên ảnh trước khi upload (ảnh hiện trường đưa ra thị trường: bảo vệ bản quyền), gồm 2 lớp:
// logo nhỏ mờ lặp chéo khắp ảnh, ngẫu nhiên theo từng ảnh (chống xoá bằng AI) + logo chính đậm ở giữa sát đáy.
// Chạy trên trình duyệt vì file đi thẳng từ trình duyệt lên Google Drive. Chỉ lưu bản đã đóng dấu (không giữ bản gốc).
// Ảnh được vẽ lại nên mất thông tin EXIF (ngày chụp, GPS, máy chụp); tên file giữ nguyên.

/** Chứng từ có ảnh được đóng dấu trước khi upload. */
export const WATERMARK_DOCUMENT_CODES: ReadonlySet<string> = new Set(["INSPECTION"]);

// Logo rộng 40% ảnh, đậm 75% (nổi đè lên ảnh), căn giữa, cách đáy 4% chiều cao ảnh; bóng đổ nhẹ để rõ trên nền sáng.
const LOGO_WIDTH_RATIO = 0.4;
const LOGO_OPACITY = 0.75;
const LOGO_SHADOW_COLOR = "rgba(0, 0, 0, 0.45)";
const LOGO_SHADOW_BLUR_RATIO = 0.012;
const BOTTOM_MARGIN_RATIO = 0.04;
const OUTPUT_QUALITY = 0.92;

// Lớp chống xoá bằng AI: logo nhỏ lặp lại phủ cả ảnh, xoay chéo. Muốn xoá phải vẽ lại gần hết ảnh (hàng hoá sẽ nhoè).
// Mỗi ảnh ngẫu nhiên góc xoay, vị trí lưới và độ đậm từng logo: công cụ xoá dấu tự động thường "học" dấu cố định từ
// nhiều ảnh giống nhau, dấu thay đổi theo từng ảnh thì không học được.
const TILE_WIDTH_RATIO = 0.16; // chiều rộng mỗi logo nhỏ so với cạnh ngắn của ảnh
const TILE_GAP_RATIO = 0.55; // khoảng trống giữa các logo so với kích thước logo
const TILE_OPACITY_MIN = 0.24;
const TILE_OPACITY_MAX = 0.36;
const TILE_ANGLE_MIN_DEG = -35;
const TILE_ANGLE_MAX_DEG = -20;

export type TileLayout = { x: number; y: number; width: number; height: number; opacity: number };

/**
 * Lưới logo nhỏ (toạ độ trong hệ đã xoay quanh tâm ảnh) phủ kín ảnh ở mọi góc xoay: hàng so le nửa ô, lệch ngẫu nhiên
 * cả lưới, mỗi logo một độ đậm. random() trả [0, 1) (truyền vào để test được).
 */
export function tiledWatermarkLayout(
  imageWidth: number,
  imageHeight: number,
  logoWidth: number,
  logoHeight: number,
  random: () => number = Math.random,
): { angle: number; tiles: TileLayout[] } {
  const angle = ((TILE_ANGLE_MIN_DEG + (TILE_ANGLE_MAX_DEG - TILE_ANGLE_MIN_DEG) * random()) * Math.PI) / 180;
  const width = Math.max(8, Math.min(imageWidth, imageHeight) * TILE_WIDTH_RATIO);
  const height = width * (logoHeight / Math.max(logoWidth, 1));
  const stepX = width * (1 + TILE_GAP_RATIO);
  const stepY = height * (1 + TILE_GAP_RATIO);
  // Đường chéo ảnh: sau khi xoay, lưới vẫn phủ kín các góc.
  const half = Math.hypot(imageWidth, imageHeight) / 2 + Math.max(stepX, stepY);
  const offsetX = random() * stepX;
  const offsetY = random() * stepY;
  const tiles: TileLayout[] = [];
  for (let row = 0, y = -half + offsetY; y < half; row += 1, y += stepY) {
    const shift = row % 2 === 0 ? 0 : stepX / 2;
    for (let x = -half + offsetX + shift; x < half; x += stepX) {
      tiles.push({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
        opacity: TILE_OPACITY_MIN + (TILE_OPACITY_MAX - TILE_OPACITY_MIN) * random(),
      });
    }
  }
  return { angle, tiles };
}

// Định dạng trình duyệt đọc và ghi lại được; HEIC / video upload nguyên bản (không đóng dấu được).
const WATERMARK_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function extensionOf(fileName: string): string {
  return fileName.match(/\.([^.\\/]+)$/)?.[1]?.toLowerCase() || "";
}

/** Có đóng dấu file này không: đúng chứng từ và là ảnh JPG / PNG / WEBP. */
export function shouldWatermark(documentCode: string, file: { name: string }): boolean {
  return WATERMARK_DOCUMENT_CODES.has(String(documentCode || "").toUpperCase()) && Boolean(WATERMARK_TYPES[extensionOf(file.name)]);
}

/** Vị trí và kích thước logo trên ảnh (giữ tỉ lệ logo, không to hơn 90% chiều cao ảnh). */
export function watermarkLayout(imageWidth: number, imageHeight: number, logoWidth: number, logoHeight: number) {
  const ratio = logoHeight / Math.max(logoWidth, 1);
  let width = imageWidth * LOGO_WIDTH_RATIO;
  let height = width * ratio;
  const maxHeight = imageHeight * 0.9;
  if (height > maxHeight) {
    height = maxHeight;
    width = height / ratio;
  }
  const margin = imageHeight * BOTTOM_MARGIN_RATIO;
  return {
    x: Math.round((imageWidth - width) / 2),
    y: Math.round(Math.max(0, imageHeight - margin - height)),
    width: Math.round(width),
    height: Math.round(height),
    opacity: LOGO_OPACITY,
  };
}

let logoPromise: Promise<ImageBitmap> | null = null;

/** Tải logo một lần cho cả phiên; lỗi thì lần sau tải lại. */
function loadLogo(logoUrl: string): Promise<ImageBitmap> {
  logoPromise ??= fetch(logoUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.blob();
    })
    .then((blob) => createImageBitmap(blob))
    .catch((error: unknown) => {
      logoPromise = null;
      throw error;
    });
  return logoPromise;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Trình duyệt không xuất được ảnh"))), type, OUTPUT_QUALITY);
  });
}

/**
 * Trả về file ảnh đã đóng dấu (cùng tên, cùng định dạng). Không đóng dấu được thì báo lỗi để không lỡ upload ảnh
 * không có dấu ra ngoài.
 */
export async function watermarkImageFile(file: File, logoUrl: string): Promise<File> {
  const type = WATERMARK_TYPES[extensionOf(file.name)];
  if (!type) return file;
  let image: ImageBitmap | null = null;
  try {
    const [logo, decoded] = await Promise.all([
      loadLogo(logoUrl),
      // Xoay ảnh theo EXIF (ảnh chụp dọc bằng điện thoại) trước khi vẽ.
      createImageBitmap(file, { imageOrientation: "from-image" }),
    ]);
    image = decoded;
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Trình duyệt không hỗ trợ vẽ ảnh");
    context.drawImage(image, 0, 0);

    // Lớp 1: logo nhỏ lặp chéo khắp ảnh (vẽ logo thu nhỏ sẵn một lần rồi lặp lại, nhanh hơn thu nhỏ logo gốc mỗi ô).
    const tiled = tiledWatermarkLayout(image.width, image.height, logo.width, logo.height);
    const tileSize = tiled.tiles[0];
    if (tileSize) {
      const tileCanvas = document.createElement("canvas");
      tileCanvas.width = tileSize.width;
      tileCanvas.height = tileSize.height;
      tileCanvas.getContext("2d")?.drawImage(logo, 0, 0, tileSize.width, tileSize.height);
      context.save();
      context.translate(image.width / 2, image.height / 2);
      context.rotate(tiled.angle);
      for (const tile of tiled.tiles) {
        context.globalAlpha = tile.opacity;
        context.drawImage(tileCanvas, tile.x, tile.y);
      }
      context.restore();
    }

    // Lớp 2: logo chính đậm ở giữa, sát đáy.
    const layout = watermarkLayout(image.width, image.height, logo.width, logo.height);
    context.globalAlpha = layout.opacity;
    context.shadowColor = LOGO_SHADOW_COLOR;
    context.shadowBlur = Math.max(2, layout.width * LOGO_SHADOW_BLUR_RATIO);
    context.shadowOffsetX = 0;
    context.shadowOffsetY = Math.max(1, layout.width * LOGO_SHADOW_BLUR_RATIO * 0.4);
    context.drawImage(logo, layout.x, layout.y, layout.width, layout.height);
    const blob = await canvasToBlob(canvas, type);
    // Giải phóng bộ nhớ canvas ngay (ảnh lớn ~48 MB mỗi canvas).
    canvas.width = 0;
    canvas.height = 0;
    return new File([blob], file.name, { type, lastModified: file.lastModified });
  } catch (error) {
    throw new Error(`Không đóng dấu được ảnh ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    image?.close();
  }
}
