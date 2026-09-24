export const EVERGREEN_TRACKING_ACTION =
  "https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do";

export interface EvergreenTrackingRequest {
  method: string;
  action: string;
  fields: Record<string, unknown>;
}

export interface EvergreenTrackingLaunchResponse {
  success: boolean;
  carrier?: string;
  containerNo?: string;
  message?: string;
  trackingRequest?: EvergreenTrackingRequest;
}

interface TrackingTab {
  close: () => void;
}

interface EvergreenTrackingDependencies {
  requestLaunch: (containerNo: string) => Promise<EvergreenTrackingLaunchResponse>;
  showError: (message: string) => void;
  openTab?: (url: string, target: string, features?: string) => TrackingTab | null;
  documentRef?: Document;
  now?: () => number;
  onStarted?: () => void;
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const response = "response" in error ? error.response : undefined;
    if (response && typeof response === "object" && "data" in response) {
      const data = response.data;
      if (data && typeof data === "object" && "message" in data && typeof data.message === "string") {
        return data.message;
      }
    }
  }
  return error instanceof Error && error.message
    ? error.message
    : "Không thể mở tracking Evergreen";
}

export async function submitEvergreenTracking(
  containerNo: string,
  dependencies: EvergreenTrackingDependencies,
): Promise<boolean> {
  const targetName = `evergreen_tracking_${(dependencies.now || Date.now)()}`;
  const openTab = dependencies.openTab
    || ((url: string, target: string, features?: string) => window.open(url, target, features));
  const trackingTab = openTab("about:blank", targetName, "popup=yes,width=1200,height=800,left=80,top=60,resizable=yes,scrollbars=yes");

  if (!trackingTab) {
    dependencies.showError("Trình duyệt đang chặn tab tracking. Vui lòng cho phép popup.");
    return false;
  }

  dependencies.onStarted?.();

  try {
    const response = await dependencies.requestLaunch(containerNo);
    const trackingRequest = response.trackingRequest;

    if (response.success !== true || !trackingRequest) {
      throw new Error(response.message || "Backend không trả về cấu hình tracking Evergreen");
    }
    if (trackingRequest.action !== EVERGREEN_TRACKING_ACTION) {
      throw new Error("Tracking URL không hợp lệ");
    }
    if (!trackingRequest.method?.trim()) {
      throw new Error("Tracking method không hợp lệ");
    }
    if (!trackingRequest.fields || typeof trackingRequest.fields !== "object") {
      throw new Error("Tracking fields không hợp lệ");
    }

    const documentRef = dependencies.documentRef || document;
    const form = documentRef.createElement("form");
    form.method = trackingRequest.method;
    form.action = trackingRequest.action;
    form.target = targetName;
    form.style.display = "none";

    Object.entries(trackingRequest.fields).forEach(([name, value]) => {
      const input = documentRef.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = String(value ?? "");
      form.appendChild(input);
    });

    documentRef.body.appendChild(form);
    form.submit();
    form.remove();
    return true;
  } catch (error) {
    trackingTab.close();
    dependencies.showError(getErrorMessage(error));
    return false;
  }
}
