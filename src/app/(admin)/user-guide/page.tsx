"use client";

import { getDriveFolderLinks, type DriveFolderLinks } from "@/services/shipmentApi";
import { useLanguage } from "@/context/LanguageContext";
import { useEffect, useState } from "react";

// Dán URL thư mục Drive tương ứng vào đúng mã chứng từ. Có URL thì tên thư mục sẽ click được.
const DOCUMENT_FOLDERS = [
  ["01. PI Hợp đồng mua", "PI", "guideDrivePi"],
  ["02. INV Hóa đơn", "INV", "guideDriveInv"],
  ["03. BL Vận đơn", "BL", "guideDriveBl"],
  ["04. PKL Bảng kê hàng hóa", "PKL", "guideDrivePkl"],
  ["05. CO Giấy chứng nhận xuất xứ", "CO", "guideDriveCo"],
  ["06. HC Giấy kiểm dịch y tế", "HC", "guideDriveHc"],
  ["07. DON_KD Đơn kiểm dịch động vật", "DON_KD", "guideDriveDonKd"],
  ["08. AN Thông báo hàng đến", "AN", "guideDriveAn"],
  ["09. EDO Lệnh giao hàng điện tử", "EDO", "guideDriveEdo"],
  ["10. CPN Chứng từ CPN quốc tế", "CPN", "guideDriveCpn"],
  ["11. TK Tờ khai hải quan", "TK", "guideDriveTk"],
  ["12. BB_LM Biên bản lấy mẫu kiểm dịch", "BB_LM", "guideDriveBbLm"],
  ["13. INSPECTION Ảnh-video kiểm dịch", "INSPECTION", "guideDriveInspection"],
  ["14. PHI_TK Lệ phí tờ khai", "PHI_TK", "guideDrivePhiTk"],
  ["15. THUE_NK Nộp thuế nhập khẩu", "THUE_NK", "guideDriveThueNk"],
  ["16. CSHT Phí cơ sở hạ tầng", "CSHT", "guideDriveCSHT"],
  ["17. 15B Giấy chứng nhận kiểm dịch", "15B", "guideDrive15b"],
  ["18. QDTQ Quyết định thông quan", "QDTQ", "guideDriveQdtq"],
  ["19. MV Mã vạch hải quan", "MV", "guideDriveMv"],
  ["20. TRA_CONT Trả cont rỗng", "TRA_CONT", "guideDriveTraCong"],
] as const;

const NAMING_EXAMPLES = [
  ["PI", "26009_712836.pdf → 26009_PI_712836.pdf", "guideNamePi"],
  ["INV", "26009_INV.pdf", "guideNameInv"],
  ["BB_LM", "26009_BnTT9172.pdf → 26009_BB_LM_BnTT9172.pdf", "guideNameBbLm"],
  ["PKL", "26009_PKL.pdf", "guideNamePkl"],
  ["TRA_CONT", "26009_TRA_CONT_CONTAINER001/<tên file gốc>", "guideNameTraCong"],
  ["INSPECTION", "26009_INSPECTION_CONTAINER001_lấy 5 thùng mở 2/<tên file gốc>", "guideNameInspection"],
] as const;

export default function UserGuidePage() {
  const { t } = useLanguage();
  const [driveLinks, setDriveLinks] = useState<DriveFolderLinks>({ documents: {} });

  useEffect(() => {
    void getDriveFolderLinks().then(setDriveLinks).catch(() => setDriveLinks({ documents: {} }));
  }, []);

  return (
    <div className="space-y-6 pb-8">
      <header className="rounded-2xl border border-brand-100 bg-brand-50 p-5 dark:border-brand-500/20 dark:bg-brand-500/10 sm:p-7">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-600 dark:text-brand-300">{t("guideDriveLabel")}</p>
        <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{t("guideDriveTitle")}</h1>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-gray-600 dark:text-gray-300">{t("guideDriveSubtitle")}</p>
      </header>

      

      <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900 sm:p-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">{t("guideDriveTreeTitle")}</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("guideDriveTreeDescription")}</p>
        <div className="mt-5 rounded-xl border border-blue-light-200 bg-blue-light-50 p-4 text-sm leading-7 text-gray-800 dark:border-blue-light-500/20 dark:bg-blue-light-500/10 dark:text-gray-200">
          <div>Shared Drive/</div>
          <div className="pl-4">└── 01.XNK_Documents (Tai Lieu XNK)/</div>
          <div className="pl-8">├── XNK_DATA_GOC/</div>
          <div className="pl-12">├── 01. PI Hợp đồng mua/</div>
          <div className="pl-12">├── 02. INV Hóa đơn/</div>
          <div className="pl-12">├── 03. BL Vận đơn/</div>
          <div className="pl-12">├── ... các thư mục chứng từ ...</div>
          <div className="pl-12">└── 20. TRA_CONT Trả cont rỗng/</div>
          <div className="mt-2 border-t border-blue-light-200 pt-2 dark:border-blue-light-500/20">└── XNK_DATA_COMPLETE/</div>
          <div className="pl-8">└── mã hợp đồng/</div>
        </div>
        <p className="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300">{t("guideDriveArchiveDescription")}</p>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900 sm:p-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">{t("guideDriveNameTitle")}</h2>
        <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-300">{t("guideDriveNameRule")}</p>
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/10">
          <span className="text-sm font-bold text-emerald-800 dark:text-emerald-300">mã_hợp_đồng_mã_chứng_từ</span>
          <p className="mt-2 text-sm leading-6 text-emerald-800 dark:text-emerald-200">{t("guideDriveNameParts")}</p>
        </div>
        <div className="mt-5 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
          {NAMING_EXAMPLES.map(([code, fileName, descriptionKey]) => (
            <div key={code} className="grid gap-2 border-b border-gray-100 px-4 py-3 last:border-b-0 dark:border-gray-800 sm:grid-cols-[100px_250px_1fr] sm:items-center sm:gap-4">
              <span className="text-sm font-bold text-gray-800 dark:text-gray-200">{code}</span>
              <span className="break-all text-xs font-semibold text-brand-700 dark:text-brand-300">{fileName}</span>
              <p className="text-sm leading-5 text-gray-600 dark:text-gray-300">{t(descriptionKey)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900 sm:p-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">{t("guideDriveFolderRulesTitle")}</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          {driveLinks.source && <a href={driveLinks.source} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-lg border border-blue-light-200 bg-blue-light-50 px-3 py-2 text-sm font-semibold text-blue-light-700 transition hover:bg-blue-light-100 dark:border-blue-light-500/30 dark:bg-blue-light-500/10 dark:text-blue-light-300 dark:hover:bg-blue-light-500/20">
            {t("guideDriveOpenSource")}
          </a>}
          {driveLinks.complete && <a href={driveLinks.complete} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20">
            {t("guideDriveOpenComplete")}
          </a>}
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {DOCUMENT_FOLDERS.map(([folder, code, descriptionKey]) => (
            <div key={code} className="rounded-xl border border-gray-100 p-4 dark:border-gray-800">
              <div className="flex items-start gap-3">
                <span className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-bold text-gray-700 dark:bg-gray-800 dark:text-gray-300">{code}</span>
                <div className="min-w-0">
                  {driveLinks.documents?.[code] ? (
                    <a href={driveLinks.documents[code]} target="_blank" rel="noreferrer" className="break-words text-sm font-semibold text-brand-600 underline decoration-brand-300 underline-offset-2 hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200">
                      {folder}
                    </a>
                  ) : (
                    <p className="break-words text-sm font-semibold text-gray-900 dark:text-white">{folder}</p>
                  )}
                  <p className="mt-1 text-sm leading-5 text-gray-600 dark:text-gray-300">{t(descriptionKey)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 dark:border-indigo-500/20 dark:bg-indigo-500/10 sm:p-6">
        <h2 className="text-lg font-bold text-indigo-900 dark:text-indigo-300">{t("guideDriveSyncTitle")}</h2>
        <ol className="mt-4 grid gap-3 md:grid-cols-4">
          {["guideDriveSyncOne", "guideDriveSyncTwo", "guideDriveSyncThree", "guideDriveSyncFour"].map((stepKey, index) => (
            <li key={stepKey} className="rounded-xl border border-indigo-200 bg-white/70 p-4 dark:border-indigo-500/20 dark:bg-white/[0.04]">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white">{index + 1}</span>
              <p className="mt-3 text-sm leading-6 text-indigo-900 dark:text-indigo-200">{t(stepKey)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-500/20 dark:bg-amber-500/10 sm:p-6">
        <h2 className="font-semibold text-amber-900 dark:text-amber-300">{t("guideDriveImportantTitle")}</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-amber-800 dark:text-amber-200">
          <li>{t("guideDriveImportantOne")}</li>
          <li>{t("guideDriveImportantTwo")}</li>
          <li>{t("guideDriveImportantThree")}</li>
          <li>{t("guideDriveImportantFour")}</li>
        </ul>
      </section>
    </div>
  );
}
