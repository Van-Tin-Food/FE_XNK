import { submitEvergreenTracking } from "@/utils/evergreenTracking";

// Tra cứu hành trình container trên trang của hãng tàu (bấm số B/L / số container ở bảng đơn hàng và chi tiết đơn).
// Chỉ các hãng đã cấu hình bên dưới mới mở được; có thêm link tracking chính thức thì bổ sung tại đây.

export type CarrierTrackingLink = {
  name: string;
  aliases: string[];
  buildUrl: (trackingCode: string) => string;
};

function buildMscTrackingUrl(trackingCode: string): string {
  const params = btoa(`trackingNumber=${trackingCode}&trackingMode=0`);
  return `https://www.msc.com/en/track-a-shipment?params=${encodeURIComponent(params)}`;
}

function buildCmaTrackingUrl(reference: string): string {
  const params = new URLSearchParams({ Reference: reference.trim().toUpperCase(), SearchBy: "Container" });
  return `https://www.cma-cgm.com/ebusiness/tracking?${params.toString()}`;
}

const EVERGREEN = "EVERGREEN";

const CARRIER_TRACKING_LINKS: CarrierTrackingLink[] = [
  {
    name: "Hapag-Lloyd",
    aliases: ["happ", "hapag", "hapag-lloyd", "hapag lloyd"],
    buildUrl: (code) => `https://www.hapag-lloyd.com/en/online-business/track/track-by-container-solution.html?container=${encodeURIComponent(code)}`,
  },
  {
    name: "Maersk",
    aliases: ["maersk", "a.p. moller", "apm"],
    buildUrl: (code) => `https://www.maersk.com/tracking/${encodeURIComponent(code)}`,
  },
  { name: "MSC", aliases: ["msc", "mediterranean shipping"], buildUrl: buildMscTrackingUrl },
  { name: "CMA CGM", aliases: ["cma", "cma cgm"], buildUrl: buildCmaTrackingUrl },
  {
    name: "COSCO",
    aliases: ["cosco", "cosco shipping"],
    buildUrl: (code) => `https://elines.coscoshipping.com/ebusiness/cargoTracking?trackingType=CONTAINER&number=${encodeURIComponent(code)}`,
  },
  {
    name: "HMM",
    aliases: ["hmm", "hyundai merchant marine"],
    buildUrl: (code) => `https://www.hmm21.com/e-service/search/index.do?query=${encodeURIComponent(code)}`,
  },
  {
    name: "FESCO",
    aliases: ["fesco"],
    buildUrl: (code) => `https://my.fesco.com/tracking?tab=${encodeURIComponent(code)}`,
  },
  {
    name: "Yang Ming",
    aliases: ["yang ming", "yangming", "yml"],
    buildUrl: (code) => `https://www.yangming.com/en/esolution/cargo_tracking?service=${encodeURIComponent(code)}`,
  },
  // Trang CK LINE không nhận mã qua URL: mở trang tra cứu, người dùng dán số container.
  { name: "CK LINE", aliases: ["ck line", "ckline", "ck"], buildUrl: () => "https://es.ckline.co.kr/" },
  {
    // Evergreen tra cứu bằng form POST (submitEvergreenTracking), URL này chỉ để dự phòng.
    name: EVERGREEN,
    aliases: ["evergreen", "evergreen marine", "ever", "emc", "shipmentlink"],
    buildUrl: (code) => `https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do?CNTR=${encodeURIComponent(code)}`,
  },
  {
    name: "ONE",
    aliases: ["one", "one cargo"],
    buildUrl: (code) => `https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking?trakNoParam=${encodeURIComponent(code)}&trakNoTpCdParam=C`,
  },
  {
    name: "OOCL",
    aliases: ["oocl", "oocl shipping"],
    buildUrl: (code) => `https://www.oocl.com/Pages/ExpressLink.aspx?eltype=ct&businessType=containerNumber&businessNumber=${encodeURIComponent(code)}&language=en`,
  },
  {
    name: "PIL",
    aliases: ["pil", "pacific international lines"],
    buildUrl: (code) => `https://www.pilship.com/digital-solutions/?tab=customer&id=track-trace&label=containerTandT&module=TrackTraceBL&refNo=${encodeURIComponent(code)}`,
  },
  {
    name: "SINOKOR",
    aliases: ["sinokor", "sinokor shipping"],
    buildUrl: (code) => `https://ebiz.sinokor.co.kr/BLDetail?containerNo=${encodeURIComponent(code)}`,
  },
];

export function findCarrierTrackingLink(carrierName?: string | null): CarrierTrackingLink | null {
  const normalized = String(carrierName || "").toLowerCase().trim();
  if (!normalized) return null;
  return CARRIER_TRACKING_LINKS.find((carrier) => carrier.aliases.some((alias) => normalized.includes(alias))) || null;
}

export type CarrierTrackingResult = "opened" | "unsupported" | "missingContainer" | "blocked" | "failed";

/**
 * Mở trang tracking của hãng tàu cho một số container (popup). Evergreen gửi form POST.
 * showError dùng cho lỗi chi tiết của Evergreen (mã container sai định dạng...).
 */
export async function openCarrierTracking(
  carrierName: string | null | undefined,
  containerCode: string | null | undefined,
  showError: (message: string) => void,
): Promise<CarrierTrackingResult> {
  const carrier = findCarrierTrackingLink(carrierName);
  if (!carrier) return "unsupported";
  const code = String(containerCode || "").trim();
  if (!code) return "missingContainer";
  if (carrier.name === EVERGREEN) {
    return (await submitEvergreenTracking(code, { showError })) ? "opened" : "failed";
  }
  const trackingWindow = window.open(
    carrier.buildUrl(code),
    "carrier_tracking_popup",
    "popup=yes,width=1200,height=800,left=80,top=60,resizable=yes,scrollbars=yes",
  );
  if (!trackingWindow) return "blocked";
  trackingWindow.focus();
  return "opened";
}
