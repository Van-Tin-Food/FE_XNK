"use client";

import {
  completePermissions,
  diffFromStandard,
  effectivePermissions,
  isAdminRole,
  levelRank,
  PERMISSION_FUNCTION_KEYS,
  PERMISSION_FUNCTIONS,
  PERMISSION_GROUPS,
  RBAC_ROLES,
  type PermissionFunction,
  type PermissionLevel,
  type PermissionMap,
} from "@/config/shipmentActionPermissions";
import SearchSuggestions from "@/components/common/SearchSuggestions";
import { useAuth } from "@/context/AuthContext";
import { useSystemConfirm } from "@/context/SystemConfirmContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import { useLanguage } from "@/context/LanguageContext";
import { recordActivity } from "@/services/activityLogApi";
import {
  getRoleCatalog,
  getUsers,
  registerUser,
  updateUser,
  updateUserPassword,
  type ManagedUser,
  type RoleStandard,
} from "@/services/authApi";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { paginateItems } from "@/utils/pagination";
import PaginationControls from "@/components/common/PaginationControls";

const DEFAULT_PAGE_SIZE = 15;
type TabKey = "users" | "register" | "password" | "roles";
type Translate = ReturnType<typeof useLanguage>["t"];

const EMPTY_REGISTER = {
  username: "",
  name: "",
  email: "",
  password: "",
  confirmPassword: "",
  role: "van_chuyen",
};

/** Nhãn mức quyền: chức năng chỉ có hai mức hiện Không / Có; ba mức hiện Không / Xem / Sửa. */
function levelLabel(t: Translate, fn: PermissionFunction, level: PermissionLevel): string {
  if (level === "none") return t("permissionLevelNone");
  if (PERMISSION_FUNCTIONS[fn].length === 2) return t("permissionLevelAllowed");
  return t(level === "edit" ? "permissionLevelEdit" : "permissionLevelView");
}

/** "Chỉ xem": hạ mọi chức năng đang ở mức Sửa xuống Xem (chức năng không có mức Xem thì về Không). */
function viewOnlyCustom(standard: PermissionMap, custom: Partial<PermissionMap>): Partial<PermissionMap> {
  const next = { ...custom };
  for (const fn of PERMISSION_FUNCTION_KEYS) {
    if ((custom[fn] ?? standard[fn]) !== "edit") continue;
    const capped: PermissionLevel = (PERMISSION_FUNCTIONS[fn] as readonly PermissionLevel[]).includes("view") ? "view" : "none";
    if (capped === standard[fn]) delete next[fn];
    else next[fn] = capped;
  }
  return next;
}

function samePermissions(left: Partial<PermissionMap>, right: Partial<PermissionMap>): boolean {
  return PERMISSION_FUNCTION_KEYS.every((fn) => left[fn] === right[fn]);
}

function roleOrDefault(role: string): string {
  return (RBAC_ROLES as readonly string[]).includes(role) ? role : "van_chuyen";
}

export default function AccountManagementPage() {
  const { user, can, permissions: myPermissions } = useAuth();
  const router = useRouter();
  const { notify } = useSystemNotification();
  const { t } = useLanguage();
  const canViewUsers = can("users");
  const canEditUsers = can("users", "edit");
  const actorIsAdmin = isAdminRole(user?.role);
  const [activeTab, setActiveTab] = useState<TabKey>("users");
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [roles, setRoles] = useState<RoleStandard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  // Tài khoản đang chọn và bản nháp quyền: sửa ngay trên trang, bấm Lưu mới gửi lên BE.
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draftRole, setDraftRole] = useState("van_chuyen");
  const [draftEmail, setDraftEmail] = useState("");
  const [draftCustom, setDraftCustom] = useState<Partial<PermissionMap>>({});
  const [saving, setSaving] = useState(false);

  // Chỉ admin được gán role admin (BE cũng chặn).
  const roleOptions = useMemo(() => RBAC_ROLES.filter((role) => role !== "admin" || actorIsAdmin), [actorIsAdmin]);
  const standardOf = useCallback(
    (role: string) => completePermissions(roles.find((item) => item.code === role)?.permissions),
    [roles],
  );

  const loadUsers = useCallback(async () => {
    if (!canViewUsers) return;
    setLoading(true);
    setError("");
    try {
      const [userRows, catalog] = await Promise.all([getUsers(), getRoleCatalog()]);
      setUsers(userRows);
      setRoles(catalog.roles);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("userListLoadError"));
    } finally {
      setLoading(false);
    }
  }, [canViewUsers, t]);

  useEffect(() => {
    if (!canViewUsers) {
      router.replace("/");
      return;
    }
    void loadUsers();
  }, [canViewUsers, loadUsers, router]);

  const filteredUsers = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("vi");
    if (!keyword) return users;
    return users.filter((item) =>
      [item.username, item.name, item.role]
        .join(" ")
        .toLocaleLowerCase("vi")
        .includes(keyword),
    );
  }, [query, users]);

  const { totalPages, safePage, items: displayedUsers, from, to } = paginateItems(filteredUsers, page, pageSize);
  const selected = users.find((item) => item.id === selectedId) || null;

  /** Không sửa được quyền của chính mình; tài khoản admin chỉ admin sửa được. Rỗng = sửa được. */
  const editBlockReason = (item: ManagedUser): string => {
    if (!canEditUsers) return t("readOnlyPermissions");
    if (item.id === user?.id) return t("cannotEditOwnPermissions");
    if (isAdminRole(item.role) && !actorIsAdmin) return t("adminPermissionLocked");
    return "";
  };

  const resetDraft = (item: ManagedUser) => {
    setDraftRole(roleOrDefault(item.role));
    setDraftEmail(item.email || "");
    setDraftCustom(item.customPermissions);
  };

  const selectUser = (item: ManagedUser) => {
    setSelectedId(item.id);
    resetDraft(item);
  };

  const draftStandard = standardOf(draftRole);
  const draftSavedCustom = isAdminRole(draftRole) ? {} : diffFromStandard(draftStandard, draftCustom);
  const normalizedDraftEmail = draftEmail.trim().toLowerCase();
  const isDirty = Boolean(selected) && (
    roleOrDefault(selected?.role || "") !== draftRole
    || (selected?.email || "").trim().toLowerCase() !== normalizedDraftEmail
    || !samePermissions(selected?.customPermissions || {}, draftSavedCustom)
  );

  const savePermission = async () => {
    if (!selected || !isDirty || saving) return;
    if (normalizedDraftEmail && !/^([^\s@]+@[^\s@]+\.[^\s@]+)$/.test(normalizedDraftEmail)) {
      notify("Email không hợp lệ.", "warning");
      return;
    }
    setSaving(true);
    try {
      await updateUser(selected.id, {
        role: draftRole,
        // Chỉ gửi chức năng khác chuẩn của role; admin luôn toàn quyền nên không có tùy chỉnh.
        customPermissions: draftSavedCustom,
        ...(normalizedDraftEmail !== (selected.email || "").trim().toLowerCase() ? { email: normalizedDraftEmail } : {}),
      });
      const before = effectivePermissions(selected.role, standardOf(selected.role), selected.customPermissions);
      const after = effectivePermissions(draftRole, draftStandard, draftSavedCustom);
      const changes = [
        selected.role !== draftRole ? `role: ${selected.role || "trống"} → ${draftRole}` : "",
        ...PERMISSION_FUNCTION_KEYS
          .filter((fn) => before[fn] !== after[fn])
          .map((fn) => `${fn}: ${before[fn]} → ${after[fn]}`),
        (selected.email || "") !== normalizedDraftEmail ? `email: ${selected.email || "trống"} → ${normalizedDraftEmail || "trống"}` : "",
      ].filter(Boolean).join("; ");
      recordActivity(user, {
        action: "UPDATE_USER_PERMISSION",
        location: `/account-management/users/${selected.id}`,
        detail: `Tài khoản ${selected.username}; ${changes || "không thay đổi quyền"}`,
      });
      setUsers((current) => current.map((item) =>
        item.id === selected.id ? { ...item, role: draftRole, customPermissions: draftSavedCustom, email: normalizedDraftEmail || undefined } : item,
      ));
      setDraftCustom(draftSavedCustom);
      notify(t("permissionUpdated", { username: selected.username }), "success");
    } catch (saveError) {
      notify(saveError instanceof Error ? saveError.message : t("permissionUpdateError"), "error");
    } finally {
      setSaving(false);
    }
  };

  if (!canViewUsers) {
    return <div className="flex min-h-[50vh] items-center justify-center"><Spinner /></div>;
  }

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">{t("accountManagement")}</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t("accountManagementDescription")}
        </p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl border border-gray-200 bg-white p-1.5 dark:border-gray-800 dark:bg-gray-900">
        <TabButton active={activeTab === "users"} onClick={() => setActiveTab("users")}>{t("accountList")}</TabButton>
        {canEditUsers && <TabButton active={activeTab === "register"} onClick={() => setActiveTab("register")}>{t("registerAccount")}</TabButton>}
        {canEditUsers && <TabButton active={activeTab === "password"} onClick={() => setActiveTab("password")}>{t("resetPassword")}</TabButton>}
        <TabButton active={activeTab === "roles"} onClick={() => setActiveTab("roles")}>{t("roleStandardsTab")}</TabButton>
      </div>

      {activeTab === "users" && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:items-start">
          {/* Màn nhỏ: chọn tài khoản thì chỉ hiện phần quyền, có nút quay lại danh sách. */}
          <div className={selected ? "hidden lg:block" : ""}>
            <UserList
              users={displayedUsers}
              total={filteredUsers.length}
              loading={loading}
              error={error}
              query={query}
              page={safePage}
              totalPages={totalPages}
              pageSize={pageSize}
              from={from}
              to={to}
              selectedId={selectedId}
              onQueryChange={(value) => { setQuery(value); setPage(1); }}
              onPageChange={setPage}
              onPageSizeChange={(value) => { setPageSize(value); setPage(1); }}
              onReload={() => void loadUsers()}
              onSelect={selectUser}
            />
          </div>
          <div className={selected ? "" : "hidden lg:block"}>
            {selected ? (
              <UserPermissionPanel
                account={selected}
                roleOptions={[...roleOptions]}
                draftRole={draftRole}
                draftEmail={draftEmail}
                draftCustom={draftCustom}
                standard={draftStandard}
                original={effectivePermissions(selected.role, standardOf(selected.role), selected.customPermissions)}
                blockReason={editBlockReason(selected)}
                actorIsAdmin={actorIsAdmin}
                actorPermissions={myPermissions}
                dirty={isDirty}
                saving={saving}
                onRoleChange={setDraftRole}
                onEmailChange={setDraftEmail}
                onCustomChange={setDraftCustom}
                onBack={() => setSelectedId(null)}
                onDiscard={() => resetDraft(selected)}
                onSave={() => void savePermission()}
              />
            ) : (
              <div className="flex min-h-64 items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
                {t("selectAccountToEdit")}
              </div>
            )}
          </div>
        </div>
      )}
      {activeTab === "register" && canEditUsers && <RegisterPanel currentUser={user} roleOptions={[...roleOptions]} onCreated={() => void loadUsers()} />}
      {activeTab === "password" && canEditUsers && <PasswordPanel currentUser={user} />}
      {activeTab === "roles" && <RoleStandardsPanel roles={roles} loading={loading} error={error} />}
    </section>
  );
}

/** Quyền của một tài khoản, sửa ngay trên trang (không mở popup). */
function UserPermissionPanel({ account, roleOptions, draftRole, draftEmail, draftCustom, standard, original, blockReason, actorIsAdmin, actorPermissions, dirty, saving, onRoleChange, onEmailChange, onCustomChange, onBack, onDiscard, onSave }: {
  account: ManagedUser;
  roleOptions: string[];
  draftRole: string;
  draftEmail: string;
  draftCustom: Partial<PermissionMap>;
  standard: PermissionMap;
  original: PermissionMap;
  blockReason: string;
  actorIsAdmin: boolean;
  actorPermissions: PermissionMap;
  dirty: boolean;
  saving: boolean;
  onRoleChange: (role: string) => void;
  onEmailChange: (email: string) => void;
  onCustomChange: (custom: Partial<PermissionMap>) => void;
  onBack: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const { t } = useLanguage();
  const readOnly = Boolean(blockReason);
  // Role admin chỉ hiện trong danh sách chọn khi đang là role của tài khoản (người sửa không phải admin).
  const options = roleOptions.includes(draftRole) ? roleOptions : [draftRole, ...roleOptions];
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row sm:items-start sm:justify-between dark:border-gray-800">
        <div className="min-w-0">
          <button type="button" onClick={onBack} className="mb-2 min-h-9 text-sm font-medium text-brand-600 hover:text-brand-700 lg:hidden dark:text-brand-400">← {t("accountList")}</button>
          <h2 className="break-words font-semibold text-gray-800 dark:text-white/90">{account.name || account.username}</h2>
          <p className="break-all text-xs text-gray-500 dark:text-gray-400">@{account.username} · #{account.id}</p>
        </div>
        {!readOnly && dirty && <span className="self-start rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">{t("unsavedChanges")}</span>}
      </div>

      <div className="space-y-5 p-4">
        {readOnly && <p className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:bg-white/[0.04] dark:text-gray-300">{blockReason}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Role
            <select value={draftRole} disabled={readOnly || saving} onChange={(event) => onRoleChange(event.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-70 dark:border-gray-700 dark:bg-gray-900 dark:text-white">
              {options.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Email Google (xác thực 2 bước)
            <input type="email" value={draftEmail} disabled={readOnly || saving} onChange={(event) => onEmailChange(event.target.value)} placeholder="ten@vantinfood.vn" className="mt-1.5 h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-70 dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
          </label>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-white/90">{t("permissionsByFunction")}</h3>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t("permissionsByFunctionHint")}</p>
          </div>
          {!readOnly && !isAdminRole(draftRole) && (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={saving} onClick={() => onCustomChange({})} className="min-h-9 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.04]">{t("resetToRoleStandard")}</button>
              <button type="button" disabled={saving} onClick={() => onCustomChange(viewOnlyCustom(standard, draftCustom))} className="min-h-9 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.04]">{t("presetViewOnly")}</button>
            </div>
          )}
        </div>

        <PermissionEditor
          role={draftRole}
          standard={standard}
          custom={draftCustom}
          original={original}
          actorIsAdmin={actorIsAdmin}
          actorPermissions={actorPermissions}
          disabled={readOnly || saving}
          onChange={onCustomChange}
        />
      </div>

      {!readOnly && (
        <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-gray-100 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <button type="button" disabled={!dirty || saving} onClick={onDiscard} className="min-h-10 rounded-lg border border-gray-200 px-4 text-sm font-semibold text-gray-600 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300">{t("discardChanges")}</button>
          <button type="button" disabled={!dirty || saving} onClick={onSave} className="min-h-10 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50">{saving ? t("saving") : t("savePermissions")}</button>
        </div>
      )}
    </div>
  );
}

/** Danh sách chức năng theo nhóm, mỗi chức năng chọn một mức. Người sửa không phải admin không nâng quá quyền của mình. */
function PermissionEditor({ role, standard, custom, original, actorIsAdmin, actorPermissions, disabled, onChange }: {
  role: string;
  standard: PermissionMap;
  custom: Partial<PermissionMap>;
  original: PermissionMap;
  actorIsAdmin: boolean;
  actorPermissions: PermissionMap;
  disabled: boolean;
  onChange: (custom: Partial<PermissionMap>) => void;
}) {
  const { t } = useLanguage();
  if (isAdminRole(role)) {
    return <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">{t("adminFullAccess")}</p>;
  }
  const setLevel = (fn: PermissionFunction, level: PermissionLevel) => {
    const next = { ...custom };
    if (level === standard[fn]) delete next[fn];
    else next[fn] = level;
    onChange(next);
  };
  // Giữ nguyên hoặc hạ quyền luôn được; nâng quyền chỉ tới mức của chính người sửa (BE cũng kiểm tra).
  const maxRank = (fn: PermissionFunction) => (actorIsAdmin ? levelRank("edit") : Math.max(levelRank(actorPermissions[fn]), levelRank(original[fn])));

  return (
    <div className="space-y-4">
      {PERMISSION_GROUPS.map((group) => (
        <section key={group.key} className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
          <h4 className="border-b border-gray-100 bg-gray-50 px-3 py-2 text-xs font-semibold uppercase text-gray-500 sm:px-4 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400">{t(group.key)}</h4>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {group.functions.map((fn) => {
              const current = custom[fn] ?? standard[fn];
              const isCustom = current !== standard[fn];
              return (
                <li key={fn} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-gray-800 dark:text-white/90">{t(`permissionFn_${fn}`)}</span>
                      {isCustom && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">{t("customPermissionBadge")}</span>}
                    </div>
                    <p className="mt-0.5 break-words text-xs text-gray-500 dark:text-gray-400">{t(`permissionFnDesc_${fn}`)}</p>
                    {isCustom && <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{t("roleStandardHint", { level: levelLabel(t, fn, standard[fn]) })}</p>}
                  </div>
                  <LevelPicker fn={fn} value={current} maxRank={maxRank(fn)} disabled={disabled} onChange={(level) => setLevel(fn, level)} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function LevelPicker({ fn, value, maxRank, disabled, onChange }: {
  fn: PermissionFunction;
  value: PermissionLevel;
  maxRank: number;
  disabled: boolean;
  onChange: (level: PermissionLevel) => void;
}) {
  const { t } = useLanguage();
  return (
    <div role="radiogroup" aria-label={t(`permissionFn_${fn}`)} className="flex w-full shrink-0 rounded-lg border border-gray-200 bg-gray-50 p-0.5 sm:w-auto dark:border-gray-700 dark:bg-gray-800">
      {PERMISSION_FUNCTIONS[fn].map((level) => {
        const selected = value === level;
        const blocked = levelRank(level) > maxRank;
        return (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled || blocked}
            title={blocked ? t("permissionAboveYours") : undefined}
            onClick={() => onChange(level)}
            className={`min-h-9 flex-1 whitespace-nowrap rounded-md px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none ${
              selected
                ? level === "none"
                  ? "bg-white text-gray-700 shadow-sm dark:bg-gray-900 dark:text-gray-200"
                  : "bg-brand-500 text-white shadow-sm"
                : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            {levelLabel(t, fn, level)}
          </button>
        );
      })}
    </div>
  );
}

function UserList({ users, total, loading, error, query, page, totalPages, pageSize, from, to, selectedId, onQueryChange, onPageChange, onPageSizeChange, onReload, onSelect }: {
  users: ManagedUser[]; total: number; loading: boolean; error: string; query: string; page: number; totalPages: number; pageSize: number; from: number; to: number;
  selectedId: number | null;
  onQueryChange: (value: string) => void; onPageChange: (page: number) => void; onPageSizeChange: (pageSize: number) => void; onReload: () => void;
  onSelect: (user: ManagedUser) => void;
}) {
  const { t } = useLanguage();
  const permissionSummary = (item: ManagedUser) => {
    if (isAdminRole(item.role)) return <Badge>{t("adminFullAccessShort")}</Badge>;
    const count = Object.keys(item.customPermissions).length;
    return count > 0
      ? <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">{t("customPermissionCount", { count })}</span>
      : <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600 dark:bg-white/[0.06] dark:text-gray-300">{t("followsRoleStandard")}</span>;
  };
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="space-y-3 border-b border-gray-100 p-4 dark:border-gray-800">
        <div><h2 className="font-semibold text-gray-800 dark:text-white/90">{t("systemUsers")}</h2><p className="text-xs text-gray-400">{t("accountCount", { count: total })}</p></div>
        <div className="flex w-full gap-2">
          <SearchSuggestions
            value={query}
            onChange={onQueryChange}
            suggestions={users.flatMap((item) => [item.username, item.name, item.role])}
            placeholder={t("searchAccounts")}
            ariaLabel={t("searchAccounts")}
            className="h-10 min-w-0 w-full flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
          <button type="button" onClick={onReload} disabled={loading} className="shrink-0 whitespace-nowrap rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-300">{t("refreshData")}</button>
        </div>
      </div>
      {error ? <Feedback message={error} type="error" /> : loading ? <div className="flex min-h-64 items-center justify-center"><Spinner /></div> : users.length === 0 ? <div className="flex min-h-64 items-center justify-center text-sm text-gray-400">{t("noAccounts")}</div> : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {users.map((item) => {
            const active = item.id === selectedId;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  aria-current={active ? "true" : undefined}
                  className={`flex w-full min-w-0 flex-col items-start gap-1.5 px-4 py-3 text-left transition ${active ? "bg-brand-50 dark:bg-brand-500/10" : "hover:bg-gray-50 dark:hover:bg-white/[0.03]"}`}
                >
                  <span className="w-full break-words text-sm font-semibold text-gray-800 dark:text-white/90">{item.name || item.username || "—"}</span>
                  <span className="w-full break-all text-xs text-gray-500 dark:text-gray-400">@{item.username} · #{item.id}</span>
                  <span className="flex flex-wrap gap-1.5"><Badge>{item.role || "—"}</Badge>{permissionSummary(item)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!loading && !error && users.length > 0 && <PaginationControls page={page} totalPages={totalPages} pageSize={pageSize} totalItems={total} from={from} to={to} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />}
    </div>
  );
}

/** Quyền chuẩn của từng role (chỉ xem): màn nhỏ là danh sách theo chức năng, từ lg là bảng chức năng × role. */
function RoleStandardsPanel({ roles, loading, error }: { roles: RoleStandard[]; loading: boolean; error: string }) {
  const { t } = useLanguage();
  const ordered = RBAC_ROLES
    .map((code) => roles.find((role) => role.code === code))
    .filter((role): role is RoleStandard => Boolean(role));
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="border-b border-gray-100 p-4 dark:border-gray-800">
        <h2 className="font-semibold text-gray-800 dark:text-white/90">{t("roleStandardsTab")}</h2>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t("roleStandardsDescription")}</p>
      </div>
      {error ? <Feedback message={error} type="error" /> : loading ? <div className="flex min-h-64 items-center justify-center"><Spinner /></div> : (
        <>
          <ul className="divide-y divide-gray-100 lg:hidden dark:divide-gray-800">
            {PERMISSION_FUNCTION_KEYS.map((fn) => (
              <li key={fn} className="p-4">
                <p className="text-sm font-medium text-gray-800 dark:text-white/90">{t(`permissionFn_${fn}`)}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {ordered.map((role) => (
                    <span key={role.code} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">
                      <span className="font-semibold">{role.code}:</span>
                      <LevelBadge fn={fn} level={role.permissions[fn]} />
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto custom-scrollbar lg:block">
            <table className="w-full min-w-[720px]">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
                <tr>
                  <th className="px-5 py-3">{t("permissionFunctionColumn")}</th>
                  {ordered.map((role) => (
                    <th key={role.code} className="px-4 py-3">
                      <span className="block">{role.code}</span>
                      <span className="block text-[11px] font-normal normal-case text-gray-400">{t("accountCount", { count: role.userCount })}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {PERMISSION_GROUPS.flatMap((group) => [
                  <tr key={group.key} className="bg-gray-50/60 dark:bg-white/[0.02]">
                    <td colSpan={ordered.length + 1} className="px-5 py-2 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">{t(group.key)}</td>
                  </tr>,
                  ...group.functions.map((fn) => (
                    <tr key={fn}>
                      <td className="px-5 py-3">
                        <p className="text-sm font-medium text-gray-800 dark:text-white/90">{t(`permissionFn_${fn}`)}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{t(`permissionFnDesc_${fn}`)}</p>
                      </td>
                      {ordered.map((role) => <td key={role.code} className="px-4 py-3"><LevelBadge fn={fn} level={role.permissions[fn]} /></td>)}
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function LevelBadge({ fn, level }: { fn: PermissionFunction; level: PermissionLevel }) {
  const { t } = useLanguage();
  const tone = level === "edit"
    ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
    : level === "view"
      ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
      : "bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{levelLabel(t, fn, level)}</span>;
}

function RegisterPanel({ currentUser, roleOptions, onCreated }: { currentUser: ReturnType<typeof useAuth>["user"]; roleOptions: string[]; onCreated: () => void }) {
  const { notify } = useSystemNotification();
  const { t } = useLanguage();
  const [form, setForm] = useState(EMPTY_REGISTER);
  const [submitting, setSubmitting] = useState(false);
  const update = (field: keyof typeof form, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = { ...form, username: form.username.trim(), name: form.name.trim() };
    if (!values.username || !values.name || !values.password || !values.confirmPassword) return notify(t("requiredAccountFields"), "warning");
    const normalizedEmail = values.email.trim().toLowerCase();
    if (normalizedEmail && !/^([^\s@]+@[^\s@]+\.[^\s@]+)$/.test(normalizedEmail)) return notify("Email không hợp lệ.", "warning");
    if (values.password.length < 6) return notify(t("passwordMinLength"), "warning");
    if (values.password !== values.confirmPassword) return notify(t("passwordMismatch"), "warning");
    setSubmitting(true);
    try {
      const result = await registerUser({ username: values.username, name: values.name, email: normalizedEmail, password: values.password, role: values.role });
      recordActivity(currentUser, { action: "REGISTER_USER", location: "/account-management", detail: `Tạo tài khoản ${values.username}; role ${values.role}${normalizedEmail ? `; email ${normalizedEmail}` : ""}` });
      notify(result.message || t("accountCreated", { username: values.username }), "success");
      setForm(EMPTY_REGISTER);
      onCreated();
    } catch (submitError) { notify(submitError instanceof Error ? submitError.message : t("accountCreateError"), "error"); }
    finally { setSubmitting(false); }
  };
  return <FormCard title={t("registerAccount")} description={t("registerAccountDescription")}><form onSubmit={submit} autoComplete="off" className="grid gap-4 sm:grid-cols-2"><TextField label={t("username")} value={form.username} onChange={(value) => update("username", value)} /><TextField label={t("displayName")} value={form.name} onChange={(value) => update("name", value)} /><div className="sm:col-span-2"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Email Google (xác thực 2 bước)<input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} placeholder="ten@vantinfood.vn" className="mt-1.5 h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-gray-700 dark:bg-gray-900 dark:text-white" /></label></div><div className="sm:col-span-2"><SelectField label="Role" value={form.role} options={roleOptions} onChange={(value) => update("role", value)} /><p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{t("registerRoleHint")}</p></div><TextField label={t("password")} type="password" value={form.password} onChange={(value) => update("password", value)} /><TextField label={t("confirmPassword")} type="password" value={form.confirmPassword} onChange={(value) => update("confirmPassword", value)} /><div className="sm:col-span-2 flex justify-end"><SubmitButton loading={submitting} text={t("createAccount")} /></div></form></FormCard>;
}

function PasswordPanel({ currentUser }: { currentUser: ReturnType<typeof useAuth>["user"] }) {
  const { notify } = useSystemNotification();
  const { confirm } = useSystemConfirm();
  const { t } = useLanguage();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const account = username.trim();
    if (!account || !password || !confirmation) return notify(t("completeAllFields"), "warning");
    if (password.length < 6) return notify(t("passwordMinLength"), "warning");
    if (password !== confirmation) return notify(t("passwordMismatch"), "warning");
    if (!await confirm({ title: t("confirmPasswordReset"), message: t("passwordResetMessage", { username: account }), confirmText: t("update") })) return;
    setSubmitting(true);
    try {
      const result = await updateUserPassword(account, password);
      recordActivity(currentUser, { action: "UPDATE_USER_PASSWORD", location: "/account-management", detail: `Cập nhật mật khẩu tài khoản ${account}` });
      notify(result.message || t("passwordUpdated", { username: account }), "success");
      setUsername(""); setPassword(""); setConfirmation("");
    } catch (submitError) { notify(submitError instanceof Error ? submitError.message : t("passwordUpdateError"), "error"); }
    finally { setSubmitting(false); }
  };
  return <FormCard title={t("resetPassword")} description={t("resetPasswordDescription")}><form onSubmit={submit} autoComplete="off" className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><TextField label={t("username")} value={username} onChange={setUsername} /></div><TextField label={t("newPassword")} type="password" value={password} onChange={setPassword} /><TextField label={t("confirmPassword")} type="password" value={confirmation} onChange={setConfirmation} /><div className="sm:col-span-2 flex justify-end"><SubmitButton loading={submitting} text={t("updatePassword")} /></div></form></FormCard>;
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={`flex-1 basis-[calc(50%-0.25rem)] rounded-lg px-3 py-2.5 text-sm font-semibold sm:flex-none sm:basis-auto sm:px-4 transition ${active ? "bg-brand-500 text-white shadow-sm" : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"}`}>{children}</button>; }
function FormCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <div className="sticky top-4 z-20 rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900 sm:p-6"><h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">{title}</h2><p className="mb-6 mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p><div className="max-w-2xl">{children}</div></div>; }
function TextField({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) { return <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{label}<span className="text-error-500"> *</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={type === "password" ? "new-password" : "off"} className="mt-1.5 h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-gray-700 dark:bg-gray-900 dark:text-white" /></label>; }
function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) { return <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{label}<span className="text-error-500"> *</span><select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-gray-700 dark:bg-gray-900 dark:text-white">{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>; }
function SubmitButton({ loading, text }: { loading: boolean; text: string }) { const { t } = useLanguage(); return <button type="submit" disabled={loading} className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60">{loading ? t("processing") : text}</button>; }
function Badge({ children }: { children: React.ReactNode }) { return <span className="inline-flex rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-400">{children}</span>; }
function Spinner() { return <div className="h-9 w-9 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />; }
function Feedback({ message }: { message: string; type: "error" }) { return <div className="m-4 rounded-xl border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400">{message}</div>; }
