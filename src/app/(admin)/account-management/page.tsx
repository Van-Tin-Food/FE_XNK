"use client";

import { canPerformShipmentAction } from "@/config/shipmentActionPermissions";
import { useAuth } from "@/context/AuthContext";
import { useSystemConfirm } from "@/context/SystemConfirmContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import { useLanguage } from "@/context/LanguageContext";
import { recordActivity } from "@/services/activityLogApi";
import {
  getUserById,
  getUsers,
  registerUser,
  updateUser,
  updateUserPassword,
  type ManagedUser,
} from "@/services/authApi";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { paginateItems } from "@/utils/pagination";
import PaginationControls from "@/components/common/PaginationControls";

const DEFAULT_PAGE_SIZE = 15;
const ROLE_OPTIONS = ["xnk", "mua hàng"];
const SESSION_OPTIONS = ["all", "edit", "view"];
type TabKey = "users" | "register" | "password";

const EMPTY_REGISTER = {
  username: "",
  name: "",
  password: "",
  confirmPassword: "",
  role: "xnk",
  session: "view",
};

export default function AccountManagementPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { confirm } = useSystemConfirm();
  const { notify } = useSystemNotification();
  const { t } = useLanguage();
  const canManage = canPerformShipmentAction(user, "manageUsers");
  const [activeTab, setActiveTab] = useState<TabKey>("users");
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [editRole, setEditRole] = useState("xnk");
  const [editSession, setEditSession] = useState("view");
  const [savingEdit, setSavingEdit] = useState(false);

  const loadUsers = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    setError("");
    try {
      setUsers(await getUsers());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("userListLoadError"));
    } finally {
      setLoading(false);
    }
  }, [canManage, t]);

  useEffect(() => {
    if (!canManage) {
      router.replace("/");
      return;
    }
    void loadUsers();
  }, [canManage, loadUsers, router]);

  const filteredUsers = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("vi");
    if (!keyword) return users;
    return users.filter((item) =>
      [item.username, item.name, item.role, item.session]
        .join(" ")
        .toLocaleLowerCase("vi")
        .includes(keyword),
    );
  }, [query, users]);

  const { totalPages, safePage, items: displayedUsers, from, to } = paginateItems(filteredUsers, page, pageSize);

  const openEdit = async (selected: ManagedUser) => {
    setError("");
    try {
      const latest = await getUserById(selected.id);
      setEditing(latest);
      setEditRole(ROLE_OPTIONS.includes(latest.role.toLocaleLowerCase("vi")) ? latest.role.toLocaleLowerCase("vi") : "xnk");
      setEditSession(SESSION_OPTIONS.includes(latest.session.toLowerCase()) ? latest.session.toLowerCase() : "view");
    } catch (loadError) {
      notify(loadError instanceof Error ? loadError.message : t("userInfoLoadError"), "error");
    }
  };

  const savePermission = async () => {
    if (!editing) return;
    const approved = await confirm({
      title: t("confirmPermissionUpdate"),
      message: t("permissionUpdateMessage", { username: editing.username, role: editRole, session: editSession }),
      confirmText: t("update"),
    });
    if (!approved) return;

    setSavingEdit(true);
    try {
      await updateUser(editing.id, { role: editRole, session: editSession });
      const changes = [
        editing.role !== editRole ? `role: ${editing.role || "trống"} → ${editRole}` : "",
        editing.session !== editSession ? `session: ${editing.session || "trống"} → ${editSession}` : "",
      ].filter(Boolean).join("; ");
      recordActivity(user, {
        action: "UPDATE_USER_PERMISSION",
        location: `/account-management/users/${editing.id}`,
        detail: `Tài khoản ${editing.username}; ${changes || "không thay đổi quyền"}`,
      });
      setUsers((current) => current.map((item) =>
        item.id === editing.id ? { ...item, role: editRole, session: editSession } : item,
      ));
      setEditing(null);
      notify(t("permissionUpdated", { username: editing.username }), "success");
    } catch (saveError) {
      notify(saveError instanceof Error ? saveError.message : t("permissionUpdateError"), "error");
    } finally {
      setSavingEdit(false);
    }
  };

  if (!canManage) {
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

      <div className="flex gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1.5 dark:border-gray-800 dark:bg-white/[0.03]">
        <TabButton active={activeTab === "users"} onClick={() => setActiveTab("users")}>{t("accountList")}</TabButton>
        <TabButton active={activeTab === "register"} onClick={() => setActiveTab("register")}>{t("registerAccount")}</TabButton>
        <TabButton active={activeTab === "password"} onClick={() => setActiveTab("password")}>{t("resetPassword")}</TabButton>
      </div>

      {activeTab === "users" && (
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
          onQueryChange={(value) => { setQuery(value); setPage(1); }}
          onPageChange={setPage}
          onPageSizeChange={(value) => { setPageSize(value); setPage(1); }}
          onReload={() => void loadUsers()}
          onEdit={(selected) => void openEdit(selected)}
        />
      )}
      {activeTab === "register" && <RegisterPanel currentUser={user} onCreated={() => void loadUsers()} />}
      {activeTab === "password" && <PasswordPanel currentUser={user} />}

      {editing && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-gray-950/55 px-4" onMouseDown={() => !savingEdit && setEditing(null)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-700 dark:bg-gray-900" onMouseDown={(event) => event.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t("editAccountPermissions")}</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{editing.name || editing.username} · @{editing.username}</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <SelectField label="Role" value={editRole} options={ROLE_OPTIONS} onChange={setEditRole} />
              <SelectField label="Session" value={editSession} options={SESSION_OPTIONS} onChange={setEditSession} />
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" disabled={savingEdit} onClick={() => setEditing(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 dark:border-gray-700 dark:text-gray-300">{t("cancel")}</button>
              <button type="button" disabled={savingEdit} onClick={() => void savePermission()} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60">{savingEdit ? t("saving") : t("savePermissions")}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function UserList({ users, total, loading, error, query, page, totalPages, pageSize, from, to, onQueryChange, onPageChange, onPageSizeChange, onReload, onEdit }: {
  users: ManagedUser[]; total: number; loading: boolean; error: string; query: string; page: number; totalPages: number; pageSize: number; from: number; to: number;
  onQueryChange: (value: string) => void; onPageChange: (page: number) => void; onPageSizeChange: (pageSize: number) => void; onReload: () => void; onEdit: (user: ManagedUser) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-col gap-3 border-b border-gray-100 p-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="font-semibold text-gray-800 dark:text-white/90">{t("systemUsers")}</h2><p className="text-xs text-gray-400">{t("accountCount", { count: total })}</p></div>
        <div className="flex w-full gap-2 sm:w-auto">
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={t("searchAccounts")} className="h-10 min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white sm:w-72" />
          <button type="button" onClick={onReload} disabled={loading} className="rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-300">{t("refreshData")}</button>
        </div>
      </div>
      {error ? <Feedback message={error} type="error" /> : loading ? <div className="flex min-h-64 items-center justify-center"><Spinner /></div> : users.length === 0 ? <div className="flex min-h-64 items-center justify-center text-sm text-gray-400">{t("noAccounts")}</div> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-900/50 dark:text-gray-400"><tr><th className="px-5 py-3">ID</th><th className="px-5 py-3">{t("username")}</th><th className="px-5 py-3">{t("displayName")}</th><th className="px-5 py-3">Role</th><th className="px-5 py-3">Session</th><th className="px-5 py-3 text-right">{t("actions")}</th></tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {users.map((item) => {
                const isAdmin = item.role.trim().toLowerCase() === "admin";
                return <tr key={item.id} className="hover:bg-gray-50/70 dark:hover:bg-white/[0.02]"><td className="px-5 py-4 text-sm text-gray-500">#{item.id}</td><td className="px-5 py-4 text-sm font-semibold text-gray-800 dark:text-white/90">{item.username || "—"}</td><td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{item.name || "—"}</td><td className="px-5 py-4"><Badge>{item.role || "—"}</Badge></td><td className="px-5 py-4"><Badge>{item.session || "—"}</Badge></td><td className="px-5 py-4 text-right"><button type="button" disabled={isAdmin} title={isAdmin ? t("adminPermissionLocked") : t("editRoleSession")} onClick={() => onEdit(item)} className="rounded-lg border border-brand-200 px-3 py-1.5 text-xs font-semibold text-brand-600 hover:bg-brand-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400 dark:border-brand-500/30 dark:text-brand-400">{t("editPermissions")}</button></td></tr>;
              })}
            </tbody>
          </table>
        </div>
      )}
      {!loading && !error && users.length > 0 && <PaginationControls page={page} totalPages={totalPages} pageSize={pageSize} totalItems={total} from={from} to={to} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />}
    </div>
  );
}

function RegisterPanel({ currentUser, onCreated }: { currentUser: ReturnType<typeof useAuth>["user"]; onCreated: () => void }) {
  const { notify } = useSystemNotification();
  const { t } = useLanguage();
  const [form, setForm] = useState(EMPTY_REGISTER);
  const [submitting, setSubmitting] = useState(false);
  const update = (field: keyof typeof form, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = { ...form, username: form.username.trim(), name: form.name.trim() };
    if (!values.username || !values.name || !values.password || !values.confirmPassword) return notify(t("requiredAccountFields"), "warning");
    if (values.password.length < 6) return notify(t("passwordMinLength"), "warning");
    if (values.password !== values.confirmPassword) return notify(t("passwordMismatch"), "warning");
    setSubmitting(true);
    try {
      const result = await registerUser({ username: values.username, name: values.name, password: values.password, role: values.role, session: values.session });
      recordActivity(currentUser, { action: "REGISTER_USER", location: "/account-management", detail: `Tạo tài khoản ${values.username}; role ${values.role}; session ${values.session}` });
      notify(result.message || t("accountCreated", { username: values.username }), "success");
      setForm(EMPTY_REGISTER);
      onCreated();
    } catch (submitError) { notify(submitError instanceof Error ? submitError.message : t("accountCreateError"), "error"); }
    finally { setSubmitting(false); }
  };
  return <FormCard title={t("registerAccount")} description={t("registerAccountDescription")}><form onSubmit={submit} autoComplete="off" className="grid gap-4 sm:grid-cols-2"><TextField label={t("username")} value={form.username} onChange={(value) => update("username", value)} /><TextField label={t("displayName")} value={form.name} onChange={(value) => update("name", value)} /><SelectField label="Role" value={form.role} options={ROLE_OPTIONS} onChange={(value) => update("role", value)} /><SelectField label="Session" value={form.session} options={SESSION_OPTIONS} onChange={(value) => update("session", value)} /><TextField label={t("password")} type="password" value={form.password} onChange={(value) => update("password", value)} /><TextField label={t("confirmPassword")} type="password" value={form.confirmPassword} onChange={(value) => update("confirmPassword", value)} /><div className="sm:col-span-2 flex justify-end"><SubmitButton loading={submitting} text={t("createAccount")} /></div></form></FormCard>;
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

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={`shrink-0 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${active ? "bg-brand-500 text-white shadow-sm" : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"}`}>{children}</button>; }
function FormCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6"><h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">{title}</h2><p className="mb-6 mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p><div className="max-w-2xl">{children}</div></div>; }
function TextField({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) { return <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{label}<span className="text-error-500"> *</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={type === "password" ? "new-password" : "off"} className="mt-1.5 h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-gray-700 dark:bg-gray-900 dark:text-white" /></label>; }
function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) { return <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{label}<span className="text-error-500"> *</span><select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-gray-700 dark:bg-gray-900 dark:text-white">{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>; }
function SubmitButton({ loading, text }: { loading: boolean; text: string }) { const { t } = useLanguage(); return <button type="submit" disabled={loading} className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60">{loading ? t("processing") : text}</button>; }
function Badge({ children }: { children: React.ReactNode }) { return <span className="inline-flex rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-400">{children}</span>; }
function Spinner() { return <div className="h-9 w-9 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />; }
function Feedback({ message }: { message: string; type: "error" }) { return <div className="m-4 rounded-xl border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400">{message}</div>; }
