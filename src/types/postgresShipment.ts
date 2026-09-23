export interface SupplierRecord {
  id_ncc: string;
  ten_ncc: string;
  email?: string | null;
  quoc_gia?: string | null;
  dia_chi?: string | null;
  so_dien_thoai?: string | null;
}

export interface CarrierRecord {
  id_hang_tau: string;
  ten_hang_tau: string;
  email?: string | null;
}

export interface WarehouseRecord {
  id_kho: string;
  ten_kho: string;
  email?: string | null;
  so_dien_thoai?: string | null;
  dia_chi?: string | null;
}

export interface PurchaseRecord {
  ma_hop_dong: string;
  ngay_hop_dong?: string | null;
  ma_inv?: string | null;
  ngay_inv?: string | null;
  id_ncc: string;
  is_deleted?: boolean;
}

export interface PurchaseDetailRecord {
  id_chi_tiet: string;
  ma_hop_dong: string;
  ten_hang: string;
  net_weight?: number | string | null;
  so_kien?: number | string | null;
  don_vi_kien?: string | null;
  don_gia?: number | string | null;
  tong_gia?: number | string | null;
}

export interface PurchaseItemCodeRecord {
  id_item_code: string;
  id_chi_tiet: string;
  ma_nha_may?: string | null;
  item_code: string;
}

export interface XnkRecord {
  ma_bl: string;
  ma_hop_dong: string;
  id_hang_tau: string;
  cang_di?: string | null;
  cang_den?: string | null;
  etd?: string | null;
  eta?: string | null;
  ata?: string | null;
}

export interface ContainerRecord {
  id_bl_container: string;
  ma_bl: string;
  ma_container: string;
}

export interface ContainerDetailRecord {
  id_chi_tiet_container: string;
  id_bl_container: string;
  id_item_code: string;
  so_kien?: number | string | null;
  don_vi_kien?: string | null;
  net_weight?: number | string | null;
}

export interface ContainerTransportRecord {
  id_van_chuyen: string;
  id_bl_container: string;
  ngay_van_chuyen?: string | null;
  nha_xe?: string | null;
  ten_tai_xe?: string | null;
  bien_so_xe?: string | null;
  noi_di?: string | null;
  noi_tra_container?: string | null;
  id_kho?: string | null;
  ghi_chu?: string | null;
}

export interface DriveDocumentFileRecord {
  fileId?: string | null;
  fileName?: string | null;
  fileUrl: string;
  referenceCode?: string | null;
  idChiTiet?: string | null;
  requestId?: string | null;
  uploadedAt?: string | null;
}

export type DriveDocumentValue = string | Array<DriveDocumentFileRecord | string> | null;

export interface DriveDocumentRecord {
  order_code: string;
  pi?: DriveDocumentValue;
  inv?: DriveDocumentValue;
  pkl?: DriveDocumentValue;
  bl?: DriveDocumentValue;
  co?: DriveDocumentValue;
  hc?: DriveDocumentValue;
  don_kd?: DriveDocumentValue;
  bb_lm?: DriveDocumentValue;
  phi_tk?: DriveDocumentValue;
  thue_nk?: DriveDocumentValue;
  tk?: DriveDocumentValue;
  "15b"?: DriveDocumentValue;
  qdtq?: DriveDocumentValue;
  mv?: DriveDocumentValue;
  tra_cong?: DriveDocumentValue;
  status?: number | string | null;
  date_time?: string | null;
}

export interface NotificationRecord {
  id_thong_bao?: string | number;
  name?: string | null;
  order_code?: string | null;
  type?: string | null;
  mss_docs?: string | null;
  status?: number | string | null;
  update_by?: string | null;
  date_time?: string | null;
}

export interface PostgresShipmentRelations {
  purchase: PurchaseRecord;
  supplier?: SupplierRecord;
  details: Array<PurchaseDetailRecord & { itemCodes: PurchaseItemCodeRecord[] }>;
  bills: Array<XnkRecord & {
    carrier?: CarrierRecord;
    containers: Array<ContainerRecord & {
      details: ContainerDetailRecord[];
      transports: Array<ContainerTransportRecord & { warehouse?: WarehouseRecord }>;
    }>;
  }>;
}

export interface PostgresShipmentSnapshot {
  suppliers: SupplierRecord[];
  carriers: CarrierRecord[];
  warehouses: WarehouseRecord[];
  purchases: PurchaseRecord[];
  purchaseDetails: PurchaseDetailRecord[];
  itemCodes: PurchaseItemCodeRecord[];
  bills: XnkRecord[];
  containers: ContainerRecord[];
  containerDetails: ContainerDetailRecord[];
  transports: ContainerTransportRecord[];
}
