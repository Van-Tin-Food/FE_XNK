export const EVERGREEN_TRACKING_ACTION =
  "https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do";

interface TrackingTab {
  close: () => void;
}

interface EvergreenTrackingDependencies {
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
  const normalizedContainerNo = String(containerNo || "").trim().replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z]{4}\d{7}$/.test(normalizedContainerNo)) {
    dependencies.showError("Mã container không hợp lệ.");
    return false;
  }
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
    const documentRef = dependencies.documentRef || document;
    const form = documentRef.createElement("form");
    form.method = "POST";
    form.action = EVERGREEN_TRACKING_ACTION;
    form.target = targetName;
    form.style.display = "none";

    const fields: Record<string, string> = {
      TYPE: "CNTR",
      BL: "",
      CNTR: normalizedContainerNo,
      bkno: "",
      query_bkno: "",
      query_rvs: "",
      query_docno: "",
      query_seq: "",
      PRINT: "",
      SEL: "s_cntr",
      NO: normalizedContainerNo,
    };
    Object.entries(fields).forEach(([name, value]) => {
      const input = documentRef.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
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
